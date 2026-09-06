# diff.ps1
# 对比 workspace/ 与 original/，生成修改差异报告
# 用法: .\diff.ps1 [-Package <name>] [-Output <path>]
# 输出: 文本差异报告 + 每个变更文件的列表

param(
    [string]$Package = "",
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

$packages = Get-TargetPackages
$paths = Get-Paths
if ($Package) {
    $packages = $packages | Where-Object { $_.name -eq $Package }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportFile = if ($Output) { $Output } else { Join-Path $paths.patches_dir "diff-report-$timestamp.txt" }

$report = @()
$report += "=== DSH Client Mod 差异报告 ==="
$report += "生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$report += ""

$totalChanged = 0

foreach ($pkg in $packages) {
    $origPath = Get-PackageOriginalPath $pkg.name
    $wsPath = Get-PackageWorkspacePath $pkg.name

    $report += "--- 包: $($pkg.name) ---"

    if (-not (Test-Path $origPath)) {
        $report += "  [跳过] original/ 中不存在"
        $report += ""
        continue
    }
    if (-not (Test-Path $wsPath)) {
        $report += "  [跳过] workspace/ 中不存在"
        $report += ""
        continue
    }

    # 对比文件
    $origFiles = Get-ChildItem $origPath -Recurse -File
    $wsFiles = Get-ChildItem $wsPath -Recurse -File

    $changed = @()
    $added = @()
    $removed = @()

    foreach ($f in $wsFiles) {
        $rel = $f.FullName.Substring($wsPath.Length).TrimStart('\')
        $origFile = Join-Path $origPath $rel
        if (-not (Test-Path $origFile)) {
            $added += $rel
        } else {
            $origHash = (Get-FileHash $origFile -Algorithm MD5).Hash
            $wsHash = (Get-FileHash $f.FullName -Algorithm MD5).Hash
            if ($origHash -ne $wsHash) {
                $changed += $rel
            }
        }
    }

    foreach ($f in $origFiles) {
        $rel = $f.FullName.Substring($origPath.Length).TrimStart('\')
        $wsFile = Join-Path $wsPath $rel
        if (-not (Test-Path $wsFile)) {
            $removed += $rel
        }
    }

    if ($changed.Count -gt 0) {
        $report += "  修改的文件 ($($changed.Count)):"
        $changed | ForEach-Object { $report += "    - $_" }
        $totalChanged += $changed.Count
    }
    if ($added.Count -gt 0) {
        $report += "  新增的文件 ($($added.Count)):"
        $added | ForEach-Object { $report += "    + $_" }
    }
    if ($removed.Count -gt 0) {
        $report += "  删除的文件 ($($removed.Count)):"
        $removed | ForEach-Object { $report += "    - $_" }
    }
    if ($changed.Count -eq 0 -and $added.Count -eq 0 -and $removed.Count -eq 0) {
        $report += "  (无变化)"
    }
    $report += ""
}

$report += "=== 汇总: $totalChanged 个文件被修改 ==="

# 写入文件
$report | Out-File -FilePath $reportFile -Encoding UTF8
Write-Host ($report -join "`n")
Write-Host ""
Write-Host "差异报告已保存: $reportFile"
