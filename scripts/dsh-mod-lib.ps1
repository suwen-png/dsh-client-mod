# dsh-mod-lib.ps1
# DeepSeek Harness 客户端修改工作区 — 核心函数库
# 被各脚本 dot-source 引用

$ErrorActionPreference = "Stop"

# 加载配置
$Script:ConfigPath = Join-Path $PSScriptRoot "..\config.json"
if (-not (Test-Path $Script:ConfigPath)) {
    throw "配置文件不存在: $Script:ConfigPath"
}
$Script:Config = Get-Content $Script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-Config { return $Script:Config }
function Get-Paths { return $Script:Config.paths }
function Get-TargetPackages { return $Script:Config.target_packages }

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "[$timestamp] [$Level] $Message"
    Write-Host $logLine
    $logsDir = $Script:Config.paths.logs_dir
    if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
    $logFile = Join-Path $logsDir ("dsh-mod-" + (Get-Date -Format "yyyyMMdd") + ".log")
    Add-Content -Path $logFile -Value $logLine -Encoding UTF8
}

function Test-IsJunction {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item $Path -Force
    return ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
}

function Get-JunctionTarget {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $item = Get-Item $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { return $null }
    return $item.Target
}

function New-JunctionLink {
    param([string]$LinkPath, [string]$TargetPath)
    if (Test-Path $LinkPath) {
        throw "链接路径已存在，无法创建: $LinkPath（请先移除）"
    }
    if (-not (Test-Path $TargetPath)) {
        throw "目标路径不存在: $TargetPath"
    }
    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath -Force | Out-Null
    Write-Log "创建 Junction: $LinkPath -> $TargetPath"
}

function Remove-JunctionLink {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Log "路径不存在，跳过移除: $Path" "WARN"
        return
    }
    if (Test-IsJunction $Path) {
        # 使用 .NET 方法安全删除 Junction（只删链接，不删目标目录内容）
        # Remove-Item 在 NonInteractive 模式下可能触发确认或递归删除目标内容
        [System.IO.Directory]::Delete($Path, $false)
        Write-Log "移除 Junction: $Path"
    } else {
        throw "路径不是 Junction，拒绝删除（可能是真实目录）: $Path"
    }
}

function Copy-PackageTree {
    param([string]$Source, [string]$Destination)
    if (Test-Path $Destination) {
        Remove-Item $Destination -Recurse -Force
    }
    Copy-Item -Path $Source -Destination $Destination -Recurse -Force
    Write-Log "复制包: $Source -> $Destination"
}

function Get-PackageSourcePath {
    param([string]$PackageName)
    return Join-Path $Script:Config.paths.harness_install_root $PackageName
}

function Get-PackageOriginalPath {
    param([string]$PackageName)
    return Join-Path $Script:Config.paths.original_dir $PackageName
}

function Get-PackageWorkspacePath {
    param([string]$PackageName)
    return Join-Path $Script:Config.paths.workspace_dir $PackageName
}

function New-Snapshot {
    param([string]$Label = "")
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $name = if ($Label) { "snapshot-$timestamp-$Label" } else { "snapshot-$timestamp" }
    $snapDir = Join-Path $Script:Config.paths.snapshots_dir $name
    New-Item -ItemType Directory -Path $snapDir -Force | Out-Null

    foreach ($pkg in $Script:Config.target_packages) {
        $wsPath = Get-PackageWorkspacePath $pkg.name
        if (Test-Path $wsPath) {
            $dest = Join-Path $snapDir $pkg.name
            Copy-Item -Path $wsPath -Destination $dest -Recurse -Force
        }
    }
    Write-Log "创建快照: $snapDir"
    return $snapDir
}

function Get-PackageStatus {
    param([string]$PackageName)
    $srcPath = Get-PackageSourcePath $PackageName
    $origPath = Get-PackageOriginalPath $PackageName
    $wsPath = Get-PackageWorkspacePath $PackageName

    $isJunction = Test-IsJunction $srcPath
    $junctionTarget = if ($isJunction) { Get-JunctionTarget $srcPath } else { $null }
    $origExists = Test-Path $origPath
    $wsExists = Test-Path $wsPath

    $state = "UNKNOWN"
    if (-not $isJunction) {
        $state = "ORIGINAL"  # 原安装目录是真实目录，未被替换
    } elseif ($junctionTarget -eq $wsPath) {
        $state = "MODIFIED"  # 已通过 junction 指向工作区
    } else {
        $state = "JUNCTION_OTHER"  # junction 指向其他位置
    }

    return [PSCustomObject]@{
        Package = $PackageName
        SourcePath = $srcPath
        IsJunction = $isJunction
        JunctionTarget = $junctionTarget
        OriginalExists = $origExists
        WorkspaceExists = $wsExists
        State = $state
    }
}
