# restore.ps1
# 从 original/ 复原原客户端文件到安装目录（文件级恢复，不改变包目录位置）
# 用法: .\restore.ps1 [-Package <name>]
# 默认复原所有包；-Package 可指定单个包

param(
    [string]$Package = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

Write-Log "=== 开始复原原客户端文件（文件级恢复） ==="

$packages = Get-TargetPackages
$paths = Get-Paths
if ($Package) {
    $packages = $packages | Where-Object { $_.name -eq $Package }
    if (-not $packages) {
        Write-Log "未找到目标包: $Package" "ERROR"
        exit 1
    }
}

$totalRestored = 0

foreach ($pkg in $packages) {
    $srcPath = Get-PackageSourcePath $pkg.name
    $origPath = Get-PackageOriginalPath $pkg.name

    if (-not (Test-Path $origPath)) {
        Write-Log "original/ 中无备份，无法复原: $($pkg.name)" "ERROR"
        continue
    }

    # 如果原安装目录是Junction，先移除
    if (Test-IsJunction $srcPath) {
        Write-Log "原安装目录是Junction，先移除: $srcPath"
        Remove-JunctionLink -Path $srcPath
    }

    # 从original复制所有文件到原安装目录
    $origFiles = Get-ChildItem $origPath -Recurse -File
    $restored = 0

    foreach ($f in $origFiles) {
        $rel = $f.FullName.Substring($origPath.Length).TrimStart('\')
        $dstFile = Join-Path $srcPath $rel
        $dstDir = Split-Path $dstFile -Parent
        if (-not (Test-Path $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }
        Copy-Item -Path $f.FullName -Destination $dstFile -Force
        $restored++
    }

    Write-Log "复原完成: $($pkg.name) ($restored 个文件)"
    $totalRestored += $restored
}

Write-Log "=== 复原完成（共 $totalRestored 个文件） ==="
Write-Host ""
Write-Host "当前状态:"
& (Join-Path $PSScriptRoot "status.ps1")
Write-Host ""
Write-Host "提示: 完全退出 Harness 后重启，复原生效"
