/**
 * 项目全资源索引生成器
 * 扫描所有源码/脚本/文档，提取结构化信息，生成确定索引
 * 用法: node scripts/gen-project-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(ROOT, 'docs', '00-统筹入口', '项目全资源确定索引.md');

// 排除目录
const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', 'original', 'workspace', 'patches', 'snapshots',
  '.idea', '.workbuddy', 'backups'
]);

// 源码目录
const SRC_DIR = path.join(ROOT, 'dsh-director-plugin', 'src');
const SCRIPT_DIRS = [
  path.join(ROOT, 'dsh-director-plugin', 'scripts'),
  path.join(ROOT, 'scripts'),
];
const DOC_DIR = path.join(ROOT, 'docs');
const PLUGIN_DOC_DIR = path.join(ROOT, 'dsh-director-plugin', 'docs');

function walkDir(dir, callback, baseDir = dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        walkDir(fullPath, callback, baseDir);
      }
    } else if (entry.isFile()) {
      callback(fullPath, relPath);
    }
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function extractHeaderComment(content) {
  // 提取文件顶部的块注释或连续行注释
  const lines = content.split('\n');
  const commentLines = [];
  let inBlock = false;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim();
    if (line.startsWith('/*')) {
      inBlock = true;
      commentLines.push(line.replace(/^\/\*\s*/, ''));
      if (line.includes('*/')) {
        inBlock = false;
        break;
      }
    } else if (inBlock) {
      if (line.includes('*/')) {
        commentLines.push(line.replace(/\*\/\s*$/, ''));
        inBlock = false;
        break;
      }
      commentLines.push(line.replace(/^\*\s?/, ''));
    } else if (line.startsWith('//') || line.startsWith('#')) {
      commentLines.push(line.replace(/^\/\/\s?/, '').replace(/^#\s?/, ''));
    } else if (line === '') {
      if (commentLines.length > 0) break;
    } else {
      if (commentLines.length > 0) break;
    }
  }
  return commentLines.filter(l => l.trim()).join(' ').trim();
}

function extractExports(content) {
  const exports = [];
  // export function name
  const fnRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let m;
  while ((m = fnRegex.exec(content)) !== null) {
    exports.push({ name: m[1], type: 'function' });
  }
  // export const name =
  const constRegex = /export\s+const\s+(\w+)/g;
  while ((m = constRegex.exec(content)) !== null) {
    exports.push({ name: m[1], type: 'const' });
  }
  // export class name
  const classRegex = /export\s+class\s+(\w+)/g;
  while ((m = classRegex.exec(content)) !== null) {
    exports.push({ name: m[1], type: 'class' });
  }
  return exports;
}

function extractImports(content) {
  const imports = [];
  const importRegex = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function getLineCount(content) {
  return content.split('\n').length;
}

function getByteSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// ========== 1. 源码文件索引 ==========
function buildSourceIndex() {
  const files = [];
  walkDir(SRC_DIR, (fullPath, relPath) => {
    if (!relPath.endsWith('.js')) return;
    const content = readFileSafe(fullPath);
    const header = extractHeaderComment(content);
    const exports = extractExports(content);
    const imports = extractImports(content);
    files.push({
      path: `src/${relPath}`,
      lines: getLineCount(content),
      bytes: getByteSize(fullPath),
      header: header.substring(0, 200),
      exportCount: exports.length,
      exports: exports.map(e => e.name).join(', '),
      importCount: imports.length,
    });
  }, SRC_DIR);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// ========== 2. 脚本文件索引 ==========
function buildScriptIndex() {
  const files = [];
  for (const dir of SCRIPT_DIRS) {
    const baseName = dir.includes('dsh-director-plugin') ? 'dsh-director-plugin/scripts' : 'scripts';
    walkDir(dir, (fullPath, relPath) => {
      if (!/\.(mjs|js|ps1|py)$/.test(relPath)) return;
      const content = readFileSafe(fullPath);
      const header = extractHeaderComment(content);
      const lines = getLineCount(content);
      // 判断脚本类型
      let type = '辅助';
      if (/verify|test|lint|prove|audit/.test(relPath)) type = '闸门/验证';
      else if (/build|gen|strip|restore|crop/.test(relPath)) type = '构建/工具';
      else if (/install|deploy|apply|restore|backup|snapshot|init/.test(relPath)) type = '部署/安装';
      else if (/cdp|shot|mouse|eval|click/.test(relPath)) type = '真机/CDP';
      else if (/platform|stub|module|osm/.test(relPath)) type = '平台桩/依赖';
      else if (/baseline/.test(relPath)) type = '基线管理';
      files.push({
        path: `${baseName}/${relPath}`,
        type,
        lines,
        bytes: getByteSize(fullPath),
        header: header.substring(0, 200),
      });
    }, dir);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// ========== 3. 文档索引 ==========
function buildDocIndex() {
  const docs = [];
  const docDirs = [
    { dir: DOC_DIR, prefix: 'docs' },
    { dir: PLUGIN_DOC_DIR, prefix: 'dsh-director-plugin/docs' },
  ];
  for (const { dir, prefix } of docDirs) {
    walkDir(dir, (fullPath, relPath) => {
      if (!/\.(md|html)$/.test(relPath)) return;
      const content = readFileSafe(fullPath);
      const lines = content.split('\n');
      // 提取第一个标题
      let title = '';
      for (const line of lines) {
        const t = line.match(/^#\s+(.+)/);
        if (t) { title = t[1].trim(); break; }
      }
      if (!title) {
        const t = lines[0]?.match(/<title>(.+)<\/title>/);
        title = t ? t[1] : path.basename(relPath);
      }
      // 提取摘要（标题后第一段非空非标题文本）
      let summary = '';
      for (let i = 1; i < Math.min(lines.length, 20); i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|') && !line.startsWith('---')) {
          summary = line.substring(0, 150);
          break;
        }
      }
      // 判断文档类型
      let type = '其他';
      if (/规范|约束|标准|机制|框架/.test(title)) type = '规范';
      else if (/方案|设计|架构|规划/.test(title)) type = '方案/设计';
      else if (/记录|日志|快照|台账|历史/.test(title)) type = '记录';
      else if (/索引|目录|清单|地图/.test(title)) type = '索引';
      else if (/审核|审查|报告|验收/.test(title)) type = '审核/报告';
      else if (/测试|验证|闸门|质量/.test(title)) type = '测试/质量';
      else if (/设计稿|高保真|交互|界面/.test(title) || relPath.endsWith('.html')) type = '设计稿';
      else if (/需求|诉求|目标/.test(title)) type = '需求';
      else if (/踩坑|问题|诊断|修复/.test(title)) type = '问题/修复';
      docs.push({
        path: `${prefix}/${relPath}`,
        type,
        title: title.substring(0, 80),
        summary,
        lines: lines.length,
        bytes: getByteSize(fullPath),
      });
    }, dir);
  }
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

// ========== 生成 Markdown ==========
function generateMarkdown(sources, scripts, docs) {
  const now = new Date().toISOString();
  let md = `# 项目全资源确定索引\n\n`;
  md += `> **生成时间**: ${now}\n`;
  md += `> **生成器**: \`scripts/gen-project-index.mjs\`（重跑即刷新）\n`;
  md += `> **范围**: 源码 / 脚本 / 文档（排除 .git/node_modules/original/workspace/patches/snapshots）\n\n`;
  md += `---\n\n`;

  // 统计总览
  const totalLines = sources.reduce((s, f) => s + f.lines, 0) + scripts.reduce((s, f) => s + f.lines, 0);
  const totalBytes = sources.reduce((s, f) => s + f.bytes, 0) + scripts.reduce((s, f) => s + f.bytes, 0);
  md += `## 〇、统计总览\n\n`;
  md += `| 类别 | 数量 | 行数 | 字节数 |\n|:-----|-----:|-----:|-------:|\n`;
  md += `| 源码文件 | ${sources.length} | ${sources.reduce((s,f)=>s+f.lines,0).toLocaleString()} | ${(sources.reduce((s,f)=>s+f.bytes,0)/1024).toFixed(1)} KB |\n`;
  md += `| 脚本文件 | ${scripts.length} | ${scripts.reduce((s,f)=>s+f.lines,0).toLocaleString()} | ${(scripts.reduce((s,f)=>s+f.bytes,0)/1024).toFixed(1)} KB |\n`;
  md += `| 文档文件 | ${docs.length} | ${docs.reduce((s,f)=>s+f.lines,0).toLocaleString()} | ${(docs.reduce((s,f)=>s+f.bytes,0)/1024).toFixed(1)} KB |\n`;
  md += `| **合计** | **${sources.length + scripts.length + docs.length}** | **${totalLines.toLocaleString()}** | **${(totalBytes/1024/1024).toFixed(2)} MB** |\n\n`;

  // 脚本类型统计
  const scriptTypes = {};
  for (const s of scripts) {
    scriptTypes[s.type] = (scriptTypes[s.type] || 0) + 1;
  }
  md += `### 脚本类型分布\n\n`;
  md += `| 类型 | 数量 |\n|:-----|-----:|\n`;
  for (const [type, count] of Object.entries(scriptTypes).sort((a,b) => b[1]-a[1])) {
    md += `| ${type} | ${count} |\n`;
  }
  md += `\n`;

  // 文档类型统计
  const docTypes = {};
  for (const d of docs) {
    docTypes[d.type] = (docTypes[d.type] || 0) + 1;
  }
  md += `### 文档类型分布\n\n`;
  md += `| 类型 | 数量 |\n|:-----|-----:|\n`;
  for (const [type, count] of Object.entries(docTypes).sort((a,b) => b[1]-a[1])) {
    md += `| ${type} | ${count} |\n`;
  }
  md += `\n---\n\n`;

  // 一、源码文件索引
  md += `## 一、源码文件索引（${sources.length} 个）\n\n`;
  md += `| # | 文件 | 行 | 导出 | 职责摘要 |\n|:-:|:-----|--:|-----:|:---------|\n`;
  sources.forEach((f, i) => {
    md += `| ${i+1} | \`${f.path}\` | ${f.lines} | ${f.exportCount} | ${f.header || '—'} |\n`;
  });
  md += `\n`;

  // 源码导出详情
  md += `### 1.1 导出函数/常量详情\n\n`;
  for (const f of sources) {
    if (f.exportCount === 0) continue;
    md += `**\`${f.path}\`**（${f.exportCount} 个导出）\n\n`;
    // 重新读取获取详细导出
    const content = readFileSafe(path.join(ROOT, 'dsh-director-plugin', f.path));
    const exports = extractExports(content);
    md += `| 名称 | 类型 |\n|:-----|:-----|\n`;
    for (const e of exports) {
      md += `| \`${e.name}\` | ${e.type} |\n`;
    }
    md += `\n`;
  }

  // 二、脚本文件索引
  md += `---\n\n## 二、脚本文件索引（${scripts.length} 个）\n\n`;
  md += `| # | 文件 | 类型 | 行 | 职责摘要 |\n|:-:|:-----|:-----|--:|:---------|\n`;
  scripts.forEach((s, i) => {
    md += `| ${i+1} | \`${s.path}\` | ${s.type} | ${s.lines} | ${s.header || '—'} |\n`;
  });
  md += `\n`;

  // 三、文档索引
  md += `---\n\n## 三、文档索引（${docs.length} 个）\n\n`;
  md += `| # | 文件 | 类型 | 行 | 标题 | 摘要 |\n|:-:|:-----|:-----|--:|:-----|:-----|\n`;
  docs.forEach((d, i) => {
    md += `| ${i+1} | \`${d.path}\` | ${d.type} | ${d.lines} | ${d.title} | ${d.summary || '—'} |\n`;
  });
  md += `\n`;

  // 四、关键路径速查
  md += `---\n\n## 四、关键路径速查\n\n`;
  md += `### 4.1 入口与构建\n`;
  md += `- 插件入口: \`dsh-director-plugin/src/client-entry.js\`\n`;
  md += `- 挂载层: \`dsh-director-plugin/src/mount.js\`\n`;
  md += `- 构建器: \`dsh-director-plugin/build/build.mjs\`\n`;
  md += `- 构建产物: \`dsh-director-plugin/lib/client.js\`\n`;
  md += `- 安装器: \`dsh-director-plugin/scripts/plugin-install.mjs\`\n\n`;
  md += `### 4.2 核心组件\n`;
  md += `- 总监页: \`src/components/DirectorPage.js\`\n`;
  md += `- 总监弹窗: \`src/components/DirectorDialog.js\`\n`;
  md += `- 设计图工作室: \`src/components/DesignStudio.js\`\n`;
  md += `- 思维导图: \`src/components/MindMap.js\`\n`;
  md += `- 浮动按钮组: \`src/components/FloatDock.js\`\n`;
  md += `- 总监工作台: \`src/components/DirectorWorkbench.js\`\n\n`;
  md += `### 4.3 核心数据层\n`;
  md += `- 设计图数据: \`src/store/design.js\` + \`src/store/design-schema.js\`\n`;
  md += `- 导图数据: \`src/store/mindmap-schema.js\` + \`src/logic/branch-tree.js\`\n`;
  md += `- 层级结构: \`src/store/hierarchy.js\`\n`;
  md += `- 职责配置: \`src/store/duty-config.js\` + \`src/logic/duties.js\`\n`;
  md += `- 个性化: \`src/store/personalize.js\`\n`;
  md += `- 持久化: \`src/store/persist.js\` + \`src/store/idb.js\` + \`src/store/plugin-db.js\`\n\n`;
  md += `### 4.4 核心逻辑层\n`;
  md += `- 总监执行: \`src/logic/director-run.js\`\n`;
  md += `- 智能路由: \`src/logic/routing.js\`\n`;
  md += `- 四维流转: \`src/logic/flow.js\`\n`;
  md += `- 自动同步: \`src/logic/sync.js\` + \`src/logic/discover.js\`\n`;
  md += `- 分层总结: \`src/logic/summarize.js\`\n`;
  md += `- 统筹编排: \`src/logic/orchestrate.js\`\n\n`;
  md += `### 4.5 闸门与验证\n`;
  md += `- 基线校验: \`scripts/baseline-check.mjs\`\n`;
  md += `- 静态闸门: \`scripts/lint-undefined-symbols.mjs\` + \`scripts/lint-cdp-templates.mjs\` + \`scripts/lint-platform-stub.mjs\`\n`;
  md += `- 离线单元: \`scripts/test-design-logic.mjs\` + \`scripts/test-design-version.mjs\` + \`scripts/test-mindmap-logic.mjs\` + \`scripts/test-personalize.mjs\`\n`;
  md += `- 真机e2e: \`scripts/verify-design-studio.mjs\` + \`scripts/verify-mindmap.mjs\` + \`scripts/verify-flow.mjs\`\n`;
  md += `- 弹窗验证: \`scripts/verify-dialog.mjs\`\n`;
  md += `- 真机点击: \`scripts/cdp-click.mjs\` + \`scripts/cdp-click-dialog.mjs\`\n\n`;
  md += `### 4.6 设计稿与文档\n`;
  md += `- 当前设计稿: \`docs/50-信息中心/V16-设计图·需求图·交互逻辑.html\`\n`;
  md += `- 基线锚点: \`docs/00-统筹入口/10-当前基线-落死锚点-V16.md\`\n`;
  md += `- 源码映射: \`dsh-director-plugin/docs/12-源码映射索引.md\`\n`;
  md += `- 架构总纲: \`dsh-director-plugin/docs/10-总监与对话架构总纲.md\`\n\n`;

  md += `---\n\n*本索引由 \`scripts/gen-project-index.mjs\` 自动生成，重跑即刷新。*\n`;
  return md;
}

// 主流程
console.log('🔍 扫描源码文件...');
const sources = buildSourceIndex();
console.log(`   找到 ${sources.length} 个源码文件`);

console.log('🔍 扫描脚本文件...');
const scripts = buildScriptIndex();
console.log(`   找到 ${scripts.length} 个脚本文件`);

console.log('🔍 扫描文档文件...');
const docs = buildDocIndex();
console.log(`   找到 ${docs.length} 个文档文件`);

console.log('📝 生成索引文档...');
const markdown = generateMarkdown(sources, scripts, docs);
fs.writeFileSync(OUTPUT, markdown, 'utf-8');
console.log(`✅ 索引已生成: ${OUTPUT}`);
console.log(`   源码: ${sources.length} 文件 / ${sources.reduce((s,f)=>s+f.lines,0).toLocaleString()} 行`);
console.log(`   脚本: ${scripts.length} 文件 / ${scripts.reduce((s,f)=>s+f.lines,0).toLocaleString()} 行`);
console.log(`   文档: ${docs.length} 文件 / ${docs.reduce((s,f)=>s+f.lines,0).toLocaleString()} 行`);
