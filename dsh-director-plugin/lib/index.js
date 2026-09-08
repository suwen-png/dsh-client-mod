/**
 * @deepseek-ai/dsh-director-plugin — host face（cordis 插件，P0 骨架）
 *
 * client 侧 bundle 由 dsh-client-modules 依据本包 package.json 的
 * dsh.client 声明自动接入 boot graph（勘察记录见
 * docs/50-信息中心/插件加载通道勘察-20260907.md）。
 *
 * T-PLUG-003 spike：验证本包被 host Loader 加载、被增量扫描进
 * __DSH_BOOT__、/plugins/<id>/client.js 可取。
 */
export const name = 'dsh-director-plugin';
export const inject = [];

export function apply(ctx) {
  // host 侧暂不提供服务（P0 骨架）。
  // P1 迁移后如需 host 侧能力（如前端静态资源之外的注册），在此扩展。
}
