# restart-harness.ps1 - Restart DeepSeek Harness (Electron) in an automation-friendly way.
#
# Why this script is required (root-cause found 2026-09-13, do not remove):
#   On Windows, Chromium ships native-window occlusion detection
#   (CalculateNativeWinOcclusion). Whenever the Harness window is covered by another
#   window or loses focus, document.visibilityState becomes "hidden" and the input
#   pipeline is heavily throttled: a single Input.dispatchMouseEvent then takes
#   ~4.6s instead of ~15ms (CDP response ~5s), and a lone mouseMoved lags one event
#   behind / drops the first event. This caused flaky hover/context-menu/minimap
#   checks in verify-mindmap, F8/F10/F11 flakes and CDP_TIMEOUT false-INVALID in
#   verify-flow, and broke the 2.5s double-confirm delete in verify-design-studio.
#   The three flags below keep the renderer visible/unthrottled even when covered,
#   bringing input handling back to ~15ms.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\restart-harness.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\restart-harness.ps1 -Port 9222
# Run it before every verify-* / cdp-* real-machine pass.

param(
    [int]$Port = 9222,
    [string]$ExePath = "D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe",
    [string]$WorkDir = "D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness",
    [int]$ReadyTimeoutSec = 40
)

$ErrorActionPreference = "Stop"

# 1) Stop existing instances
Get-Process | Where-Object { $_.ProcessName -like "*Harness*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4

# 2) Clear env vars that would make Electron run as plain Node
$env:ELECTRON_RUN_AS_NODE = $null
$env:NODE_OPTIONS = $null

# 3) Key flags: disable occlusion detection / backgrounding / renderer throttling
$harnessArgs = @(
    "--remote-debugging-port=$Port",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
)
Start-Process -FilePath $ExePath -ArgumentList $harnessArgs -WorkingDirectory $WorkDir

# 4) Poll until CDP /json/list is reachable
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    try {
        $list = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
        if ($list) { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    Write-Error "Harness CDP not ready within $ReadyTimeoutSec s (port $Port)"
    exit 2
}
Start-Sleep -Seconds 3
Write-Host "Harness restarted. CDP=http://127.0.0.1:$Port (occlusion throttling disabled)" -ForegroundColor Green
exit 0
