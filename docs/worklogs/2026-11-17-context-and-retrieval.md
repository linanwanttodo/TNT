# 上下文与检索优化功能记录（2026-11-17）

本文件记录 TNT CLI 在上下文成本、缓存稳定性、检索编排与用量可观测性上的功能现状。每一项列出功能、涉及文件与状态，供后续核验。状态为「已实现」或「未实现」，未实现项写明边界。

涉及仓库目录：`packages/cli/src/`、`packages/config-yaml/src/`、`core/`。

## CI 门禁记录（本日）

- `packages/config-yaml/src/schemas/models.ts` 新增 `search` 用途后，`core/config/load.ts`、`core/config/yaml/loadYaml.ts`、`core/config/yaml/models.vitest.ts` 的 role map 同步补齐该键。共享枚举改动必须同时跑 `core` 的 `tsc -p ./ --noEmit` 与 `npm run build`；cli 的 tsc 不覆盖 core。
- `packages/cli/src/startup/ProviderSetupScreen.test.tsx` 的裸换行用例改为使用带重发的交付循环：Windows runner 会吞掉单次 stdin 写入，原用例单次写 + 单次等待在 Windows 上表现为超时而不是功能失败。`packages/cli/vitest.config.ts` 的 worker 上限、超时余量与 CI 重试保留。

## 1. 旧工具输出清理的冷热闸门（已实现）

- 功能：旧工具结果的占位符替换只在缓存冷窗（TTL 过期、会话恢复）或没有缓存折扣的 provider 上执行增长；暖窗仅在「省下的字节 × 折扣率 > 尾部重付字节 × (1 − 折扣率)」时执行。已应用的集合保持稳定，不会反向撤销造成二次前缀分叉。判据与结果写日志。
- 文件：`packages/cli/src/stream/toolOutputEviction.ts`、`packages/cli/src/stream/requestPreparation.ts`、`core/llm/utils/calculateRequestCost.ts`（折扣率取自价目表）、`packages/cli/src/compaction/microCompact.ts`（复用冷窗判定）。
- 测试：`packages/cli/src/stream/toolOutputEviction.test.ts`、`requestPreparation.eviction.test.ts`。

## 2. 缓存断点归因（已实现）

- 功能：工具结果集合增长时把 `tool_eviction` 折进前缀判定（state 为 invalidated），缓存命中率为零时归因到 prefix 而不是 provider；集合稳定时不加标记，属于真实 full hit。cache-break 报告与命中率日志因此与实际字节一致。
- 文件：`packages/cli/src/stream/requestPreparation.ts`、`packages/cli/src/stream/usageTelemetry.ts`、`packages/cli/src/cache/prefixState.ts`、`packages/cli/src/cache/cacheBreakReport.ts`。

## 3. 子代理工具列表与系统提示的两层缓存修复（已实现）

- 功能：委派运行按「家族视角」下发与父请求字节一致的完整工具列表，权限限制仍在执行期拦截；请求字节不再因受限子代理的工具子集而在首个缺失工具处分叉。客户端前缀判定支持 systemMessage 的后缀扩展：旧串是新串字节前缀时判 passthrough，理由为 `extended:systemMessage`。判定记忆按发送方分键，父与子不互相覆盖；provider 路由键不变。
- 文件：`packages/cli/src/permissions/types.ts`、`packages/cli/src/subagent/runContext.ts`、`packages/cli/src/subagent/executor.ts`、`packages/cli/src/stream/streamChatResponse.types.ts`、`packages/cli/src/stream/streamChatResponse.ts`、`packages/cli/src/tools/selection/requestTools.ts`、`packages/cli/src/cache/prefixState.ts`。
- 测试：`packages/cli/src/cache/prefixState.test.ts` 与 4 个 subagent 夹具测试。

## 4. 摘要无收益改为放弃语义（已实现）

- 功能：摘要没有减少历史时不再按失败抛出、不再消耗熔断额度，而是「放弃并保留原文」的正常结果。摘要与标题类调用可路由到按用途标记的轻量模型；无该配置时回退主模型，行为不变。压缩率按分桶记入会话账。
- 文件：`packages/cli/src/compaction/index.ts`、`packages/cli/src/stream/summarizeWithEngine.ts`、`packages/cli/src/stream/streamChatResponse.autoCompaction.ts`、`packages/cli/src/stream/streamChatResponse.compactionHelpers.ts`、`packages/cli/src/services/ModelService.ts`、`packages/cli/src/session/index.ts`、`packages/cli/src/stream/usageTelemetry.ts`。

## 5. 用量台账的 agent 维度与 rewrite 入账（已实现）

- 功能：用量按派发 agent 与 session 分行，并行成员不再合并到同一行；进程级总量仍可聚合。系统提示 rewrite 事件进入 turn 台账与 cache-break 报告，不再只写日志。
- 文件：`packages/cli/src/stream/usageTelemetry.ts`、`packages/cli/src/stream/systemPromptRound.ts`、`packages/cli/src/session/index.ts`。

## 6. MCP 工具两阶段披露（已实现）

- 功能：内置工具与 MCP 工具的 schema 可按上下文占比自动隐藏，只保留名称与一句话的目录；需要时经 `ToolSearch` 拉全量 schema。`TNT_DEFER_MCP_TOOLS` 可强制开关。
- 文件：`packages/cli/src/tools/selection/deferral.ts`、`packages/cli/src/tools/selection/requestTools.ts`。

## 7. 只读探索子代理与便宜模型路由（已实现）

- 功能：`explore` 内置子代理只读、拒绝 `AskQuestion` 与 `Exit`，系统提示要求只返回 Answer / Path / Flow / Unknowns 的精炼结构，不返回原始搜索输出与死路；全部证据来自本地文件，不使用远程代码索引。配置 `roles: ["search"]` 的模型时，探索子代理使用该模型而不是会话模型；无配置时行为不变。大工作区（本地文件数达到 200）在会话首轮注入一次探索上下文，说明探索型问题应先派 `explore`，并附本地仓库地图。小工作区不注入，不付 token。
- 文件：`packages/cli/src/subagent/builtInAgents.ts`、`packages/config-yaml/src/schemas/models.ts`（`search` 用途）、`packages/cli/src/services/ModelService.ts`、`packages/cli/src/agent/repoMap.ts`、`packages/cli/src/agent/explorationNote.ts`、`packages/cli/src/commands/chat.ts`、`packages/cli/src/ui/hooks/useChat.ts`、`packages/cli/src/commands/serve.helpers.ts`、`docs/cli/subagents.mdx`、`docs/zh/cli/subagents.mdx`。
- 测试：`packages/cli/src/agent/repoMap.test.ts`、`packages/cli/src/agent/explorationNote.test.ts`、`packages/cli/src/services/ModelService.subagents.test.ts`、`packages/cli/src/subagent/builtInAgents.test.ts`。

## 8. 本地仓库地图（已实现）

- 功能：纯本地的深度受限目录清单，输出入口文件、目录形状与文件数；不含文件内容、不含远程请求。清单按「路径 + 大小 + mtime」指纹缓存在 `~/.tnt/repo-map/`，指纹不变时读缓存，变化时重建；state 目录落在工作区内时会从清单中排除，避免缓存文件使指纹永久失效。缓存不可写时本次仍返回地图。

## 9. 请求内容分段计量（已实现）

- 功能：在请求组装处按 system / tools / messages / hookNotes 四段估算输入 token，逐轮累加到 turn 台账与 agent 行。数值是本地估算，不是 provider 的分项账单；用途是看各段占比的趋势，决定下一次优化落在哪一段。
- 文件：`packages/cli/src/stream/contentSections.ts`、`packages/cli/src/stream/usageTelemetry.ts`、`packages/cli/src/stream/processStreamingResponse.ts`。
- 测试：`packages/cli/src/stream/contentSections.test.ts`。

## 10. 请求内容分段的 WebUI 网格（已实现）

- 功能：开发者面板的轮次表新增 Segments 列，用四段堆叠占比条渲染每轮 system/tools/messages/hookNotes 的相对大小；`sections` 缺失或全零时显示 `—`。共享 schema（`packages/zcode-ui/shared/src/session-debug.ts`）补齐 `sections`、`agentType`、`isCompacting`、`calculateOutputTps` 字段，中英文案补齐。
- 文件：`packages/zcode-ui/shared/src/session-debug.ts`、`packages/zcode-ui/ui/src/DeveloperToolsPane.tsx`、`packages/zcode-ui/ui/src/i18n/locales/en-US.ts`、`zh-CN.ts`。

## 11. 开发者面板的调试环（已实现）

- 功能：`session/debug` 有了 TNT 侧实现。`telemetry/debugRings.ts` 是进程内有界存储（每会话 200 轮、100 条网络事实、16 个会话），`recordRoundAccounting` 逐轮写入轮次（含分段、agent 维度、isCompacting、首 token 时延、TPS），退避层通过 `onTransportEvent` 回调上报 retry/stalled/failed 供 `stream/processStreamingResponse.ts` 落环（头保持空、计数为 0——适配层拿不到原始 HTTP 交换，如实展示）。`appServer/session.ts` 的 `debug()` 按 promptCacheKey 读环并汇总只含上报轮的缓存命中率，protocol 注册 `sessionDebug` 处理器。
- 文件：`packages/cli/src/telemetry/debugRings.ts`、`packages/cli/src/utils/exponentialBackoff.ts`、`packages/cli/src/stream/processStreamingResponse.ts`、`packages/cli/src/stream/usageTelemetry.ts`、`packages/cli/src/appServer/session.ts`、`packages/cli/src/appServer/protocol.ts`。
- 测试：`packages/cli/src/telemetry/debugRings.test.ts`（10 例）、`packages/cli/src/appServer/session.test.ts`（+3）。

## 12. AstSearch：本地结构化检索（已实现）

- 功能：ast-grep 等价能力，全部本地。core 侧 `core/util/structuralSearch.ts` 把 `$NAME`/`$$$NAME` 元变量预处理器替换为各语法都合法的占位标识符再按目标语法解析，结构匹配比较语法节点类型与子序列（含匿名记号，注释剔除；`expression_statement` 内的单个 splat 折叠，使 `{ $$$BODY }` 覆盖整段语句）；重复元变量要求文本一致。cli 侧 `packages/cli/src/tools/astSearch.ts` 用 ripgrep `--files`（尊重 .gitignore 与权限 deny globs）枚举 15 种语言的候选文件，按语言惰性编译 pattern，另支持 `kind` 模式直接列出节点种类；上限（默认 4000 文件、1.5MB/文件、40 匹配可调）与中止都如实入答。与 Search/Glob 同属 `BUILTIN_SEARCH_TOOLS`（需要 ripgrep），三条权限表 allow，ACP kind=search，不进 AUTO_SAFE_TOOLS（目标路径可离开工作区，同 Search 走 acceptEdits 快通道）。
- 文件：`core/util/structuralSearch.ts`、`packages/cli/src/tools/astSearch.ts`。
- 测试：`packages/cli/src/tools/astSearch.test.ts`（12 例）。

## 13. 本地声明索引：知识层短路（已实现）

- 功能：检索下沉的层。`retrieval/symbolIndex.ts` 用 tree-sitter 按语法 `name` 字段抽取声明（函数/类/方法/变量/类型/接口/枚举/结构体），深度限 3（文件作用域与类成员，函数局部绑定不算），上限 600 文件、256KB/文件、200 符号/文件，按「路径+大小+mtime」指纹缓存到 `~/.tnt/symbol-index.json`，`TNT_SYMBOL_INDEX=0` 可关。`FindSymbol` 先查层：无语言服务器时层即答案（带来源与启发式声明），有服务器时层是服务器未命中后的第二机会；未命中才回落到更重的路径。
- 文件：`packages/cli/src/retrieval/symbolIndex.ts`、`packages/cli/src/tools/findSymbol.ts`。
- 测试：`packages/cli/src/retrieval/symbolIndex.test.ts`（6 例）、`packages/cli/src/tools/findSymbol.test.ts`（+2）。

## 未实现项与边界

- eviction 与 microCompact 的双轨状态机合并、替换决策持久化：冷窗闸门与归因已覆盖主要成本问题；合并会改动已稳定的热路径，留待观察期后处理。
- 远程代码索引与远程 MCP：不引入，检索能力全部本地（AstSearch 与声明索引都只读工作区文件与 vendored 语法）。
- 声明索引为精确名匹配（大小写不敏感），不做前缀/子串；跨语言启发式抽取覆盖语法 `name` 字段能命中的声明形态，未见过的语法形态可能漏。

## 本轮其他改动记录

- 全面体检修复 31 项：worktree 列表与删除、自动化立即运行、派发幂等、团队运行结算、终端进程收尾、压缩绕过、取消后空提交、主题跟随、文档与实现对齐、CI 输入校验等；涉及 `packages/cli/src/webuiZcode/services/`、`core/util/`、`packages/cli/src/session/`、`packages/cli/src/ui/`、`docs/`。
- ZCode workflow 相关文件同步到 v3.18.2、team 运行页签增强（五态筛选、resumable 入口、本地化时间）；涉及 `packages/zcode-ui/`、`packages/cli/src/appServer/`、`packages/zcode-ui/UPSTREAM-DIVERGENCES.md`。
- CI 测试饥饿超时的结构性修复：worker 上限、超时余量、CI 单次重试、慢测自带工具超时；涉及 `packages/cli/vitest.config.ts`、`.github/workflows/cli-pr-checks.yml`。
- 工具面登记：`AstSearch` 加入注册表（42→43 工具），`FindSymbol` 描述更新；前缀指纹 `40dd3dbe369d1946`/37635/43，`packages/cli/src/tools/toolPrefixFingerprint.test.ts` 与 `packages/cli/ARCHITECTURE-tnt.md` 同步更新。
