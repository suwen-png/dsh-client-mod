# init-workspace.ps1
# 从 original/ 复制包到 workspace/，作为修改工作区
# 用法: .\init-workspace.ps1 [-Force]

param([switch]$Force)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

Write-Log "=== 开始初始化工作区 ==="

$packages = Get-TargetPackages
$paths = Get-Paths

# 检查 original 是否存在
$allOrigExist = $true
foreach ($pkg in $packages) {
    if (-not (Test-Path (Get-PackageOriginalPath $pkg.name))) {
        $allOrigExist = $false
        break
    }
}
if (-not $allOrigExist) {
    Write-Log "original/ 中缺少包，请先运行 backup.ps1" "ERROR"
    exit 1
}

foreach ($pkg in $packages) {
    $src = Get-PackageOriginalPath $pkg.name
    $dst = Get-PackageWorkspacePath $pkg.name

    if ((Test-Path $dst) -and -not $Force) {
        Write-Log "工作区已存在，跳过（使用 -Force 覆盖，会丢失当前修改）: $dst" "WARN"
        continue
    }

    Copy-PackageTree -Source $src -Destination $dst
    Write-Log "工作区初始化完成: $($pkg.name)"
}

Write-Log "=== 工作区初始化完成 ==="
Write-Host ""
Write-Host "工作区目录: $($paths.workspace_dir)"
Write-Host "在此目录下修改包文件，修改完成后运行 apply.ps1 应用"
Get-ChildItem $paths.workspace_dir -Directory | Select-Object Name
