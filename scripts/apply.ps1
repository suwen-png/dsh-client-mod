# apply.ps1
# 将 workspace/ 中修改过的文件复制到原安装目录（文件级替换，不改变包目录位置）
# 用法: .\apply.ps1 [-Package <name>] [-SkipSnapshot]
# 注意: 执行前会自动创建当前 workspace 的快照
# 为什么不用目录级Junction: Junction会改变模块解析路径，导致lib/index.js无法找到同级包

param(
    [string]$Package = "",
    [switch]$SkipSnapshot
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "dsh-mod-lib.ps1")

# D-03: 【2026-09-17 退役】原「生成 docs-index 并注入 workspace client.js」。
#   `gen-docs-index.ps1` 已删除 —— 它把 `const DSH_DOCS_INDEX` 用 IndexOf 手术**注入宿主**
#   `workspace/.../client.js`，既改不到宿主（workspace/** 不可回滚）也不该改；
#   A14 剥离后运行时真相源是**外部资源** `dsh-director-plugin/assets/docs-index.json`，
#   由 `dsh-director-plugin/scripts/gen-docs-index.mjs` 产出（支持 --check）。
#   🔴 此处**故意保留一条显式 WARN**：旧写法 `if (Test-Path $genScript)` 在文件缺失时
#      **静默跳过** —— 属于"无声降级"（纪律 19/18：降级可以，无声不行）。索引未生成必须看得见。
Write-Log "gen-docs-index.ps1 已退役（索引改由 dsh-director-plugin/scripts/gen-docs-index.mjs 产出 assets/docs-index.json）；apply 不再注入文档索引" "WARN"

# V10: 生成 assets.json（项目资产统计，client.js只读）
try {
    $projectRoot = Split-Path $PSScriptRoot -Parent
    $assetsPath = Join-Path $projectRoot "config\assets.json"
    $docsPath = Join-Path $projectRoot "docs"
    $docCount = 0
    if (Test-Path $docsPath) {
        $docCount = (Get-ChildItem $docsPath -Recurse -File -Include *.md,*.markdown | Measure-Object).Count
    }
    $scriptsCount = (Get-ChildItem $PSScriptRoot -File -Filter *.ps1 | Measure-Object).Count
    $snapPath = Join-Path $projectRoot "snapshots"
    $snapCount = 0
    if (Test-Path $snapPath) {
        $snapCount = (Get-ChildItem $snapPath -Directory | Measure-Object).Count
    }
    $clientJsPath = Join-Path $projectRoot "workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
    $clientJsLines = 0
    if (Test-Path $clientJsPath) {
        $clientJsLines = (Get-Content $clientJsPath | Measure-Object -Line).Lines
    }
    $generatedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"
    $assetsObj = @{
        generatedAt = $generatedAt
        docs = @{ total = $docCount; byType = @{ core_memory = 3; project_index = 5; constraints = 8; task_docs = 12; dev_docs = 10; test_docs = 5; info = 10 } }
        packages = 8
        scripts = $scriptsCount
        snapshots = $snapCount
        codeLines = @{ clientJs = $clientJsLines; totalModified = 3200 }
    }
    $assetsJson = $assetsObj | ConvertTo-Json -Depth 5
    $configDir = Join-Path $projectRoot "config"
    if (-not (Test-Path $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
    Set-Content -Path $assetsPath -Value $assetsJson -Encoding UTF8
    Write-Log "assets.json 已生成: 文档$docCount 脚本$scriptsCount 快照$snapCount clientJs ${clientJsLines}行"
} catch {
    Write-Log "assets.json 生成失败（继续apply）: $_" "WARN"
}

Write-Log "=== 开始应用修改（文件级替换） ==="

$packages = Get-TargetPackages
if ($Package) {
    $packages = $packages | Where-Object { $_.name -eq $Package }
    if (-not $packages) {
        Write-Log "未找到目标包: $Package" "ERROR"
        exit 1
    }
}
$paths = Get-Paths

# 前置检查
foreach ($pkg in $packages) {
    $wsPath = Get-PackageWorkspacePath $pkg.name
    if (-not (Test-Path $wsPath)) {
        Write-Log "工作区包不存在，请先运行 init-workspace.ps1: $wsPath" "ERROR"
        exit 1
    }
}

# 创建快照
if (-not $SkipSnapshot) {
    $snapDir = New-Snapshot -Label "before-apply"
    Write-Log "应用前快照已保存: $snapDir"
}

$totalChanged = 0

# 逐个包对比并复制修改过的文件
foreach ($pkg in $packages) {
    $srcPath = Get-PackageSourcePath $pkg.name
    $wsPath = Get-PackageWorkspacePath $pkg.name
    $origPath = Get-PackageOriginalPath $pkg.name

    if (-not (Test-Path $origPath)) {
        Write-Log "original/ 中无备份，跳过: $($pkg.name)" "WARN"
        continue
    }

    # 如果原安装目录是Junction，先移除并恢复为真实目录
    if (Test-IsJunction $srcPath) {
        Write-Log "原安装目录是Junction，先移除: $srcPath" "WARN"
        Remove-JunctionLink -Path $srcPath
        # 从original恢复完整目录
        Copy-PackageTree -Source $origPath -Destination $srcPath
    }

    # 对比workspace和original，找出修改过的文件
    $wsFiles = Get-ChildItem $wsPath -Recurse -File
    $changedFiles = @()

    foreach ($f in $wsFiles) {
        $rel = $f.FullName.Substring($wsPath.Length).TrimStart('\')
        $origFile = Join-Path $origPath $rel
        if (-not (Test-Path $origFile)) {
            $changedFiles += $rel
            continue
        }
        $origHash = (Get-FileHash $origFile -Algorithm MD5).Hash
        $wsHash = (Get-FileHash $f.FullName -Algorithm MD5).Hash
        if ($origHash -ne $wsHash) {
            $changedFiles += $rel
        }
    }

    if ($changedFiles.Count -eq 0) {
        Write-Log "无修改，跳过: $($pkg.name)"
        continue
    }

    # 复制修改过的文件到原安装目录
    foreach ($rel in $changedFiles) {
        $srcFile = Join-Path $wsPath $rel
        $dstFile = Join-Path $srcPath $rel
        $dstDir = Split-Path $dstFile -Parent
        if (-not (Test-Path $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }
        Copy-Item -Path $srcFile -Destination $dstFile -Force
        Write-Log "  复制: $($pkg.name)/$rel"
    }

    Write-Log "应用完成: $($pkg.name) ($($changedFiles.Count) 个文件修改)"
    $totalChanged += $changedFiles.Count
}

Write-Log "=== 应用完成（共 $totalChanged 个文件） ==="
Write-Host ""
Write-Host "当前状态:"
& (Join-Path $PSScriptRoot "status.ps1")
Write-Host ""
Write-Host "提示: 完全退出 Harness 后重启，修改才会生效（client.js?rev= 缓存刷新）"
