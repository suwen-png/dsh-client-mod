# snapshot.ps1
# 手动创建当前 workspace 的快照
# 用法: .\snapshot.ps1 [-Label <name>]

param([string]$Label = "")

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

$snapDir = New-Snapshot -Label $Label
Write-Host ""
Write-Host "快照已创建: $snapDir"
Write-Host "包含包:"
Get-ChildItem $snapDir -Directory | Select-Object Name
