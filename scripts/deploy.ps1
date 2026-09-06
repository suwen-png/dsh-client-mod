param([switch]$NoRestart, [switch]$NoCacheClear)
$ErrorActionPreference = "Stop"
$startTime = Get-Date
$PluginDir = "C:\Users\15142\.dsh\profiles\web\node_modules\dsh-director\lib"
$SourceDir = "D:\hermes-data\dsh-director"
$HarnessExe = "D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe"
Write-Host "=== V10一键部署 ===" -ForegroundColor Cyan
Write-Host "[1/5] 编译..." -ForegroundColor Yellow
Set-Location $SourceDir
node build.mjs
$compiledFile = Join-Path $SourceDir "lib\client.js"
$compiledSize = (Get-Item $compiledFile).Length
Write-Host "编译成功: $([math]::Round($compiledSize/1024, 1))KB" -ForegroundColor Green
if (-not $NoRestart) {
    Write-Host "[2/5] 关闭Harness..." -ForegroundColor Yellow
    Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Write-Host "已关闭" -ForegroundColor Green
}
Write-Host "[3/5] 复制..." -ForegroundColor Yellow
$destFile = Join-Path $PluginDir "client.js"
$bytes = [System.IO.File]::ReadAllBytes($compiledFile)
[System.IO.File]::WriteAllBytes($destFile, $bytes)
Write-Host "复制成功" -ForegroundColor Green
if (-not $NoCacheClear) {
    Write-Host "[4/5] 清缓存..." -ForegroundColor Yellow
    $cacheDir = "$env:APPDATA\@deepseek-ai\dsh-desktop"
    @("Cache", "Code Cache", "GPUCache", "blob_storage", "Network") | ForEach-Object {
        $p = Join-Path $cacheDir $_
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
    }
    Write-Host "缓存已清" -ForegroundColor Green
}
if (-not $NoRestart) {
    Write-Host "[5/5] 启动Harness..." -ForegroundColor Yellow
    Start-Process $HarnessExe
    Start-Sleep -Seconds 10
    Write-Host "已启动" -ForegroundColor Green
}
$duration = ((Get-Date) - $startTime).TotalSeconds
Write-Host "=== 完成，耗时$([math]::Round($duration,1))秒 ===" -ForegroundColor Cyan
