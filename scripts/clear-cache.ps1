# dsh-client-mod 缓存清理脚本
# 用途：杀掉Harness进程 + 清除客户端缓存（保留IndexedDB持久化数据）
# 使用：.\scripts\clear-cache.ps1
# 创建日期：2026-08-27

$ErrorActionPreference = "SilentlyContinue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  dsh-client-mod 缓存清理" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ========== 第一步：杀掉Harness进程 ==========
Write-Host "[1/2] 查找并杀掉Harness进程..." -ForegroundColor Yellow

$harnessProcesses = @()
# 多种匹配方式：进程名、窗口标题、路径
$harnessProcesses += Get-Process | Where-Object {
    $_.ProcessName -match "harness|dsh|deepseek" -or
    $_.MainWindowTitle -match "Harness|DeepSeek|dsh" -or
    $_.Path -match "deepseek|harness|dsh"
}

# 去重
$harnessProcesses = $harnessProcesses | Sort-Object Id -Unique

if ($harnessProcesses.Count -gt 0) {
    Write-Host "  找到 $($harnessProcesses.Count) 个进程：" -ForegroundColor Red
    foreach ($p in $harnessProcesses) {
        Write-Host "    - PID:$($p.Id) $($p.ProcessName) $($p.MainWindowTitle)" -ForegroundColor Red
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    # 等待进程退出
    Start-Sleep -Seconds 2
    Write-Host "  进程已终止" -ForegroundColor Green
} else {
    Write-Host "  未找到Harness进程（可能已关闭）" -ForegroundColor Gray
}

Write-Host ""

# ========== 第二步：清除缓存 ==========
Write-Host "[2/2] 清除客户端缓存（保留IndexedDB）..." -ForegroundColor Yellow

$cacheDir = "$env:APPDATA\@deepseek-ai\dsh-desktop"

if (-not (Test-Path $cacheDir)) {
    Write-Host "  缓存目录不存在: $cacheDir" -ForegroundColor Red
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  完成（缓存目录不存在）" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    exit 0
}

# 需要删除的缓存目录
$dirsToDelete = @(
    "Cache",
    "Code Cache",
    "GPUCache",
    "blob_storage",
    "Network",
    "DawnGraphiteCache",
    "DawnWebGPUCache"
)

# 保留的目录（不删除）
$dirsToKeep = @(
    "IndexedDB",        # 总监持久化数据
    "Local Storage",
    "Session Storage",
    "plugin-center",
    "Shared Dictionary",
    "WebStorage"
)

$deletedCount = 0
$failedCount = 0

foreach ($d in $dirsToDelete) {
    $path = Join-Path $cacheDir $d
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $path) {
            Write-Host "  [失败] $d（可能被进程占用）" -ForegroundColor Red
            $failedCount++
        } else {
            Write-Host "  [已删] $d" -ForegroundColor Green
            $deletedCount++
        }
    } else {
        Write-Host "  [跳过] $d（不存在）" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "  保留目录：" -ForegroundColor Cyan
foreach ($d in $dirsToKeep) {
    $path = Join-Path $cacheDir $d
    if (Test-Path $path) {
        Write-Host "    [保留] $d" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  完成：已删除 $deletedCount 个，失败 $failedCount 个" -ForegroundColor Green
if ($failedCount -gt 0) {
    Write-Host "  提示：失败的目录可能被Harness进程占用，请先完全退出Harness后重试" -ForegroundColor Yellow
}
Write-Host "  现在可以启动Harness验证修改" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
