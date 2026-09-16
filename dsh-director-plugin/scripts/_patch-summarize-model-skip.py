#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch-summarize-model-skip.py —— 落地「Ollama 不可用时整轮跳过模型调用」

依据：03 号文 §4.3 原文「Ollama 未启动 → 提示并跳过」。
实测（2026-09-16 第十六轮）：本机无 Ollama 时 fetch("http://localhost:11434/api/tags") 失败需 2371 ms
（scripts/_probe-sum-node-cost.mjs：saveNode 1ms / dshLog 0ms），而 summarizeNode 对每个节点试一次模型
⇒ 116 节点实测 140.3 s（scripts/_probe-sum-tree-timeline.mjs 收敛于 t=140264ms）。
修法：本轮第一次失败即锁定「模型不可用」，其后节点直接 forceGrade=G0；结论不变（grades 全 G0），140s → ~3s。

行尾：两个文件都是 CRLF 主导（summarize.js 202 CRLF/8 bare-LF；DirectorHierarchy.js 369/8）
      ⇒ 本脚本显式写 CRLF，且只做精确替换，不改动区域外的任何字节。
"""
import io
import sys

ROOT = "D:/hermes-data/dsh-client-mod/dsh-director-plugin/"

OLD_TREE = """export async function summarizeTree(root, opts = {}) {
\tconst stats = { count: 0, grades: { G0: 0, G1: 0, G2: 0 }, degraded: 0 };
\tif (!root) return stats;

\t// 后序遍历：先子后父，保证父级能拿到子级最新 summary
\tconst walk = async (node) => {
\t\tfor (const c of node.childNodes || []) await walk(c);
\t\tconst res = await summarizeNode(node, node.childNodes || [], opts);
\t\tnode.summary = res.text;
\t\tnode.summaryGrade = res.grade;
\t\tnode.summaryAt = res.at;
\t\tconst { childNodes, ...flat } = node;
\t\tawait saveNode(flat);
\t\tstats.count++;
\t\tstats.grades[res.grade] = (stats.grades[res.grade] || 0) + 1;
\t\tif (res.degraded) stats.degraded++;
\t};
\tawait walk(root);
\temitHierarchyChange();
\treturn stats;
}"""

NEW_TREE = """export async function summarizeTree(root, opts = {}) {
\tconst stats = { count: 0, grades: { G0: 0, G1: 0, G2: 0 }, degraded: 0, modelSkipped: 0, modelSkipReason: "" };
\tif (!root) return stats;

\t/* 🔴 03 号文 §4.3「Ollama 未启动 → 提示并跳过」落到实处（2026-09-16 第十六轮）
\t *   真机实测：本机无 Ollama 时 fetch("http://localhost:11434/api/tags") 失败要 **2371 ms**
\t *   （_probe-sum-node-cost.mjs：saveNode 1ms / dshLog 0ms），而 summarizeNode 会对**每个**节点试一次模型
\t *   ⇒ 116 节点整树实测 **140.3 s**（_probe-sum-tree-timeline.mjs 逐 500ms 采样，收敛于 t=140264ms）。
\t *   ⇒ 本轮第一次失败即**锁定**「模型不可用」，其后节点直接 forceGrade=G0：
\t *     仍是文档规定的降级链，只是把「每个节点重试」改成「每轮跳过一次」，**结论完全一致**（grades 仍全 G0）。
\t *   不设全局状态、不改 endpoint 配置 —— 锁定只属于本次 summarizeTree 调用。 */
\tlet modelLocked = null;

\t// 后序遍历：先子后父，保证父级能拿到子级最新 summary
\tconst walk = async (node) => {
\t\tfor (const c of node.childNodes || []) await walk(c);
\t\tconst nodeOpts = modelLocked ? { ...opts, forceGrade: GRADE.RULE } : opts;
\t\tconst res = await summarizeNode(node, node.childNodes || [], nodeOpts);
\t\tnode.summary = res.text;
\t\tnode.summaryGrade = res.grade;
\t\tnode.summaryAt = res.at;
\t\tconst { childNodes, ...flat } = node;
\t\tawait saveNode(flat);
\t\tstats.count++;
\t\tstats.grades[res.grade] = (stats.grades[res.grade] || 0) + 1;
\t\tif (res.degraded) {
\t\t\tstats.degraded++;
\t\t\tif (!modelLocked) modelLocked = res.reason || "本地模型不可用";
\t\t}
\t\tif (modelLocked && res.grade === GRADE.RULE) stats.modelSkipped++;
\t};
\tawait walk(root);
\tif (modelLocked) stats.modelSkipReason = modelLocked;
\temitHierarchyChange();
\treturn stats;
}"""

OLD_JSDOC = """ * @param {object} [opts] { forceGrade }
 * @returns {Promise<{count:number, grades:Record<string,number>, degraded:number}>}"""

NEW_JSDOC = """ * ⚠ 模型不可用时本轮**自动跳过模型调用**（03号文 §4.3「提示并跳过」）：失败一次即锁定，其后节点走 G0。
 * @param {object} [opts] { forceGrade }
 * @returns {Promise<{count:number, grades:Record<string,number>, degraded:number, modelSkipped:number, modelSkipReason:string}>}"""

OLD_TOAST = """\t\tconst stats = await summarizeTree(await refresh(), {});
\t\tsetMsg("整树总结完成：" + stats.count + " 个节点，G0=" + stats.grades.G0 + " / G1=" + stats.grades.G1 + " / G2=" + stats.grades.G2 + "，降级 " + stats.degraded + " 个");"""

NEW_TOAST = """\t\tconst stats = await summarizeTree(await refresh(), {});
\t\t/* 🔴 降级必须**说出来**（纪律 19「降级可以，无声不行」）：模型不可用时按 03号文 §4.3 整轮跳过，
\t\t *   否则用户只看到「降级 N 个」而不知道后面 100+ 个节点根本没试过模型。 */
\t\tsetMsg("整树总结完成：" + stats.count + " 个节点，G0=" + stats.grades.G0 + " / G1=" + stats.grades.G1 + " / G2=" + stats.grades.G2 + "，降级 " + stats.degraded + " 个"
\t\t\t+ (stats.modelSkipped ? "；本地模型不可用已按 03号文 §4.3 跳过模型调用 " + stats.modelSkipped + " 个（" + (stats.modelSkipReason || "未知原因") + "）" : ""));"""

PATCHES = [
    ("src/logic/summarize.js", OLD_JSDOC, NEW_JSDOC),
    ("src/logic/summarize.js", OLD_TREE, NEW_TREE),
    ("src/components/DirectorHierarchy.js", OLD_TOAST, NEW_TOAST),
]


def to_crlf(s: str) -> bytes:
    return s.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")


def main() -> int:
    ok = True
    for rel, old, new in PATCHES:
        path = ROOT + rel
        raw = io.open(path, "rb").read()
        old_b = to_crlf(old)
        new_b = to_crlf(new)
        cnt = raw.count(old_b)
        if cnt != 1:
            print("[FAIL] %s : 待替换块命中 %d 次（必须恰好 1 次）" % (rel, cnt))
            ok = False
            continue
        out = raw.replace(old_b, new_b)
        io.open(path, "wb").write(out)
        print("[OK]   %s : %d -> %d 字节（%+d）" % (rel, len(raw), len(out), len(out) - len(raw)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
