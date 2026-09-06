# backup.ps1
# 从 Harness 原安装目录备份目标包到 original/
# 用法: .\backup.ps1 [-Force]

param([switch]$Force)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

Write-Log "=== 开始备份原客户端包 ==="

$packages = Get-TargetPackages
$paths = Get-Paths

foreach ($pkg in $packages) {
    $src = Get-PackageSourcePath $pkg.name
    $dst = Get-PackageOriginalPath $pkg.name

    if (-not (Test-Path $src)) {
        Write-Log "源包不存在，跳过: $src" "WARN"
        continue
    }

    if ((Test-Path $dst) -and -not $Force) {
        Write-Log "备份已存在，跳过（使用 -Force 覆盖）: $dst" "WARN"
        continue
    }

    Copy-PackageTree -Source $src -Destination $dst
    Write-Log "备份完成: $($pkg.name)"
}

Write-Log "=== 备份完成 ==="
Write-Host ""
Write-Host "备份目录: $($paths.original_dir)"
Get-ChildItem $paths.original_dir -Directory | Select-Object Name, @{N="SizeKB";E={[math]::Round((Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum).Sum/1KB,1)}}
