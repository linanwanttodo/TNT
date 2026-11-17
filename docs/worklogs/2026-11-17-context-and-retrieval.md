# 上下文与检索优化功能记录（2026-11-17）

本文件记录 TNT CLI 在上下文成本、缓存稳定性、检索编排与用量可观测性上的功能现状。每一项列出功能、涉及文件与状态，供后续核验。状态为「已实现」或「未实现」，未实现项写明边界。

涉及仓库目录：`packages/cli/src/`、`packages/config-yaml/src/`、`core/`。

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

## 9. 请求内容分段计量（已实现，后端）

- 功能：在请求组装处按 system / tools / messages / hookNotes 四段估算输入 token，逐轮累加到 turn 台账与 agent 行。数值是本地估算，不是 provider 的分项账单；用途是看各段占比的趋势，决定下一次优化落在哪一段。WebUI 网格展示未实现。
- 文件：`packages/cli/src/stream/contentSections.ts`、`packages/cli/src/stream/usageTelemetry.ts`、`packages/cli/src/stream/processStreamingResponse.ts`。
- 测试：`packages/cli/src/stream/contentSections.test.ts`。

## 未实现项与边界

- 请求内容分段的 WebUI 网格展示：台账已产出数据，界面未接入。
- eviction 与 microCompact 的双轨状态机合并、替换决策持久化：冷窗闸门与归因已覆盖主要成本问题；合并会改动已稳定的热路径，留待观察期后处理。
- 检索下沉的知识层问答短路（先查层、未命中再调工具）：目前地图在会话首轮注入一次，未做按问题类型的自动短路。
- 远程代码索引与远程 MCP：不引入，检索能力全部本地。

## 本轮其他改动记录

- 全面体检修复 31 项：worktree 列表与删除、自动化立即运行、派发幂等、团队运行结算、终端进程收尾、压缩绕过、取消后空提交、主题跟随、文档与实现对齐、CI 输入校验等；涉及 `packages/cli/src/webuiZcode/services/`、`core/util/`、`packages/cli/src/session/`、`packages/cli/src/ui/`、`docs/`。
- ZCode workflow 相关文件同步到 v3.18.2、team 运行页签增强（五态筛选、resumable 入口、本地化时间）；涉及 `packages/zcode-ui/`、`packages/cli/src/appServer/`、`packages/zcode-ui/UPSTREAM-DIVERGENCES.md`。
- CI 测试饥饿超时的结构性修复：worker 上限、超时余量、CI 单次重试、慢测自带工具超时；涉及 `packages/cli/vitest.config.ts`、`.github/workflows/cli-pr-checks.yml`。
- 全部改动已通过本地门禁：cli 5253 用例、config-yaml 287 用例、e2e 131 用例、smoke 10 项、lint、cli build、docs-site build。
