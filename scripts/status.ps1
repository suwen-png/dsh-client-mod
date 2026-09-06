# status.ps1
# 检查所有目标包的当前状态（文件级：对比原安装目录 vs original/）
# 用法: .\status.ps1

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

$packages = Get-TargetPackages

Write-Host ""
Write-Host "=== DSH Client Mod 状态检查（文件级） ===" -ForegroundColor Cyan
Write-Host ""

$results = @()
foreach ($pkg in $packages) {
    $srcPath = Get-PackageSourcePath $pkg.name
    $origPath = Get-PackageOriginalPath $pkg.name
    $wsPath = Get-PackageWorkspacePath $pkg.name

    $isJunction = Test-IsJunction $srcPath
    $origExists = Test-Path $origPath
    $wsExists = Test-Path $wsPath

    # 对比原安装目录和original，找出修改过的文件
    $changedCount = 0
    $changedFiles = @()
    if ($origExists -and (Test-Path $srcPath) -and -not $isJunction) {
        $origFiles = Get-ChildItem $origPath -Recurse -File
        foreach ($f in $origFiles) {
            $rel = $f.FullName.Substring($origPath.Length).TrimStart('\')
            $srcFile = Join-Path $srcPath $rel
            if (-not (Test-Path $srcFile)) {
                $changedCount++
                $changedFiles += $rel
                continue
            }
            $origHash = (Get-FileHash $f.FullName -Algorithm MD5).Hash
            $srcHash = (Get-FileHash $srcFile -Algorithm MD5).Hash
            if ($origHash -ne $srcHash) {
                $changedCount++
                $changedFiles += $rel
            }
        }
    }

    if ($isJunction) {
        $state = "JUNCTION"
    } elseif ($changedCount -gt 0) {
        $state = "MODIFIED"
    } else {
        $state = "ORIGINAL"
    }

    $results += [PSCustomObject]@{
        Package = $pkg.name
        State = $state
        ChangedFiles = $changedCount
        IsJunction = $isJunction
        OriginalExists = $origExists
        WorkspaceExists = $wsExists
        ChangedFileList = $changedFiles
    }
}

$results | Format-Table -AutoSize Package, State, ChangedFiles, IsJunction, OriginalExists, WorkspaceExists

Write-Host ""
Write-Host "状态说明:" -ForegroundColor Yellow
Write-Host "  ORIGINAL  - 原安装目录文件与original/一致（原始状态）"
Write-Host "  MODIFIED  - 原安装目录有文件被修改（修改已应用）"
Write-Host "  JUNCTION  - 原安装目录是Junction符号链接（旧方案，不推荐）"
Write-Host ""

# 显示修改过的文件详情
$modified = $results | Where-Object { $_.State -eq "MODIFIED" }
if ($modified) {
    Write-Host "修改过的文件:" -ForegroundColor Yellow
    foreach ($r in $modified) {
        Write-Host "  [$($r.Package)]"
        foreach ($f in $r.ChangedFileList) {
            Write-Host "    - $f"
        }
    }
    Write-Host ""
}

$modifiedCount = ($results | Where-Object { $_.State -eq "MODIFIED" }).Count
$originalCount = ($results | Where-Object { $_.State -eq "ORIGINAL" }).Count
$totalChanged = ($results | Measure-Object ChangedFiles -Sum).Sum
Write-Host "汇总: $modifiedCount 个包已修改, $originalCount 个为原始状态, 共 $($results.Count) 个包, $totalChanged 个文件被修改"
Write-Host ""
