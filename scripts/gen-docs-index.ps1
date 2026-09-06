# gen-docs-index.ps1
# D-03: 扫描 docs/ 生成文档索引，注入 workspace client.js 的 __DSH_DOCS_INDEX__ 标记
# 由 apply.ps1 自动调用，也可单独运行测试
# 设计依据: 20-任务文档/18-总监驾驶舱UI设计方案.md D3 决策（浏览器端无fs，构建时注入）

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$docsDir = Join-Path $root "docs"
$clientFile = Join-Path $root "workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"

if (-not (Test-Path $docsDir)) { Write-Host "[gen-docs-index] docs/ 不存在，跳过"; exit 0 }
if (-not (Test-Path $clientFile)) { Write-Error "[gen-docs-index] client.js 不存在: $clientFile"; exit 1 }

$maxChars = 8000
$files = Get-ChildItem $docsDir -Recurse -File -Filter *.md

$docs = [ordered]@{}
$tree = [ordered]@{}
foreach ($f in $files) {
    $rel = $f.FullName.Substring($docsDir.Length).TrimStart('\') -replace '\\', '/'
    $dir = Split-Path $rel -Parent
    if ($dir -eq "") { $dir = "." }
    $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    if ($content.Length -gt $maxChars) { $content = $content.Substring(0, $maxChars) + "`n…(截断)" }
    $docs[$rel] = @{ name = $f.Name; dir = $dir; size = $f.Length; content = $content }
    if (-not $tree.Contains($dir)) { $tree[$dir] = @() }
    $tree[$dir] += $f.Name
}

$index = [ordered]@{
    generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    version = 1
    docCount = $files.Count
    tree = $tree
    docs = $docs
}
$json = ConvertTo-Json $index -Depth 6 -Compress

$raw = [System.IO.File]::ReadAllText($clientFile, [System.Text.Encoding]::UTF8)
$startMarker = "// __DSH_DOCS_INDEX_START__"
$endMarker = "// __DSH_DOCS_INDEX_END__"
$startIdx = $raw.IndexOf($startMarker)
$endIdx = $raw.IndexOf($endMarker, $startIdx)
if ($startIdx -lt 0 -or $endIdx -lt 0) {
    Write-Error "[gen-docs-index] client.js 中不存在标记对"
    exit 1
}
$endIdx += $endMarker.Length
$replacement = "// __DSH_DOCS_INDEX_START__`nconst DSH_DOCS_INDEX = $json;`n// __DSH_DOCS_INDEX_END__"
# IndexOf 手术替换：避免正则替换把 JSON 中的 $ 当作组引用（曾导致注入损坏）
$raw = $raw.Substring(0, $startIdx) + $replacement + $raw.Substring($endIdx)

# 无 BOM 写回
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($clientFile, $raw, $utf8NoBom)

$kb = [math]::Round($json.Length / 1024, 1)
Write-Host "[gen-docs-index] 注入完成: $($files.Count) 个文档, JSON ${kb}KB"
