# dsh-client-mod 完整重启脚本
# 用途：杀掉Harness进程 + 清除缓存 + 重启Harness
# 使用：powershell -ExecutionPolicy Bypass -File scripts\restart-harness.ps1
# 创建日期：2026-08-28
# 修改日期：2026-09-01（修复语法解析问题，简化写法）

$ErrorActionPreference = "SilentlyContinue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  dsh-client-mod 完整重启" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ========== 配置 ==========
$harnessExe = "D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe"
$cacheDir = "$env:APPDATA\@deepseek-ai\dsh-desktop"

# ========== 第一步：检查并杀掉Harness进程 ==========
Write-Host "[1/3] 检查Harness进程..." -ForegroundColor Yellow

$procs = Get-Process | Where-Object { $_.ProcessName -match "harness|dsh|deepseek" -or $_.Path -match "deepseek|harness|dsh" }
$procs = $procs | Sort-Object Id -Unique

if ($procs.Count -gt 0) {
    Write-Host "  找到 $($procs.Count) 个运行中的进程，正在终止..." -ForegroundColor Red
    $procs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 3

    # 二次检查
    $remaining = Get-Process | Where-Object { $_.ProcessName -match "harness|dsh|deepseek" -or $_.Path -match "deepseek|harness|dsh" }
    if ($remaining.Count -gt 0) {
        Write-Host "  仍有 $($remaining.Count) 个进程未退出，强制终止..." -ForegroundColor Red
        $remaining | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    }
    Write-Host "  进程已终止" -ForegroundColor Green
} else {
    Write-Host "  未找到Harness进程（已关闭）" -ForegroundColor Gray
}

Write-Host ""

# ========== 第二步：清除缓存 ==========
Write-Host "[2/3] 清除客户端缓存..." -ForegroundColor Yellow

if (-not (Test-Path $cacheDir)) {
    Write-Host "  缓存目录不存在: $cacheDir" -ForegroundColor Gray
} else {
    # 🔴 不得加入 "Network"：Chromium cookie/网络状态存储，内含 dsh_director_* 持久化 cookie（R5 冻结）。
    $dirsToDelete = @("Cache", "Code Cache", "GPUCache", "blob_storage", "DawnGraphiteCache", "DawnWebGPUCache")
    $deletedCount = 0
    $failedCount = 0

    foreach ($d in $dirsToDelete) {
        $path = Join-Path $cacheDir $d
        if (Test-Path $path) {
            Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $path) {
                Write-Host "  [失败] $d（可能被占用）" -ForegroundColor Red
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
    Write-Host "  缓存清理完成：已删除 $deletedCount 个，失败 $failedCount 个" -ForegroundColor Green
}

Write-Host ""

# ========== 第三步：启动Harness ==========
Write-Host "[3/3] 启动Harness..." -ForegroundColor Yellow

if (Test-Path $harnessExe) {
    Start-Process -FilePath $harnessExe
    Write-Host "  已启动: $harnessExe" -ForegroundColor Green
} else {
    Write-Host "  可执行文件不存在: $harnessExe" -ForegroundColor Red
    Write-Host "  请手动启动Harness" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  完成！Harness已重启，可以开始测试" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
