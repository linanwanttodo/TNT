# TNT 产品差距分析报告

- 日期：2026-10-24（修订版 v2，2026-10-25）
- 对象：TNT（`packages/cli`，one engine four surfaces）对比 `test-continue/` 参考库
- 输入状态：本轮七路分析链全部失败（对账链与六个维度链均返回 `WorkflowError: Subagent turn failed: Model creation failed`，findings 全空）。**本报告不采用任何失败链的结论。**
- 替代方法：结论全部来自本会话的本地核验——（a）逐条抽查 `REFERENCE_REVIEW_TNT.md`（2026-10-15，三部分）旧建议在当前树（HEAD = `360cfaede`）的落地状态；（b）读取工作区已有的 `QUALITY-AUDIT-REPORT-2026-10-24.md` 与 `TUI-GAP-ANALYSIS-2026-10-25.md`；（c）本机运行 vitest 验证套件健康度。
- 核验方法学声明（v2 新增，源于一次已兑现的教训）：初版多处结论以"grep 参考库文件名/关键词于 TNT 为空"判定 not-done，该方式存在系统性假阴性风险，且已兑现两次——`approvalCache` grep 为空而实际机制名为 `sessionApprovals.ts`；`gapThreshold|timeBased|minutes` grep 为空而实际机制名为 `gapMs`（`compaction/microCompact.ts`）。v2 对全部"未发现"型条目改用**机制形状关键词**二次核验（tokens left/tokensLeft/remainingBudget、mtime 重注入消费方、cacheGuard 等），并在 §4 声明残余风险。初版的 G-5（会话级审批缓存）与 G-6（时间驱动微压缩）两条差距因此被证伪并撤销，P1-1/P1-2 两项路线图条目随之撤下。
- 检查记录（本会话实际执行）：`npx vitest run`（packages/cli）= 431 个测试文件：427 通过 / 4 跳过 / **0 失败**，3436 用例：3431 通过 / 5 跳过 / 0 失败；`npx vitest run src/test/usage-normalization.vitest.ts`（packages/openai-adapters）= 14 用例通过。全文统一此口径：427 通过 / 4 跳过 / 0 失败（共 431）。
- 参考侧行号验证程度声明：本报告引用的 claude-code / gemini-cli / codex 文件行号（如 `dangerousPatterns.ts:18-79`、`useGeminiStream.ts:1263-1308`）均为**转述**自 `REFERENCE_REVIEW_TNT.md`（该文档本身是本会话亲自读取的），未在参考库源码上逐一复核；TNT 侧行号全部为本会话直接读取或 grep 验证。移植前需回参考源码定位，行号可能已漂移。

---

## 1. 执行摘要

TNT 的工程底座已经达到一线产品形态：427 个测试文件通过 / 0 失败、tsc 0 错，引擎侧（usage 归一、缓存断点收敛、MCP 命名空间、工作区写边界、会话级审批缓存、时间驱动微压缩、hook 上下文注入）与 TUI 侧（主题热切换、终端明暗探测、大粘贴折叠、审批卡、diff 语法高亮）的关键补强在最近提交里密集落地，参考库 P0 级建议大部分已收口，其中会话级审批缓存（`sessionApprovals.ts`）与时间微压缩（`compaction/microCompact.ts`）两个初版误判为缺失的机制经复核确认**早已完整落地**。当前离一线产品最核心的差距收敛到三处：一是**权限模型仍缺"危险 allow 前缀剥离"**，规则命中即返回 allow、无危险算子降级路径（`permissionChecker.ts:188-197`，本会话读源码确认）；二是 **TUI 流式渲染无 Static 分区**，settled/live 切分纯函数已有半成品（`transcriptSegments.ts`）但未接渲染层，也没有内容级安全切点；三是**工具可见面无"完全划分"守卫**，registry 的 push 组装靠约定而非红测试防分叉。另外 Search 工具默认 `allow`（`defaultPolicies.ts:29,89`）且未接 `evaluateToolCallPolicy`，是参考 P0 三刀中唯一未完全闭环的一刀。

## 2. 既有研究对账

对账对象：`test-continue/REFERENCE_REVIEW_TNT.md`（2026-10-15），含第一部分 15 批次、第二部分 A-L 批次、第三部分 M-Q 批次。以下状态全部为本会话在当前树上逐条抽查的结果（TNT 侧证据为 file:line，命令为 grep / ls / 读源码）。

### 2.1 统计（v2 修订）

| 状态     | 数量 | 说明                                            |
| -------- | ---- | ----------------------------------------------- |
| done     | 26   | 抽查确认已落地（v2 新增批次 6、批次 9 两条）    |
| partial  | 4    | 主路径已通，留有明确缺口（v2 移除批次 6、9）    |
| not-done | 7    | 抽查确认未落地（v2 对各条完成机制形状二次核验） |
| stale    | 2    | 旧文档现状描述过时                              |

### 2.2 done（旧建议已收口，可关闭条目）

| 旧建议                                                                                             | 本会话证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 批次 1：Search 改 argv/execFile                                                                    | `packages/cli/src/tools/searchCode.ts:12,23` 用 `promisify(execFile)` + args 数组                                                                                                                                                                                                                                                                                                                                                                                                             |
| 批次 3：MCP `mcp__<server>__<tool>` 命名空间                                                       | `packages/cli/src/tools/mcp.ts:29` 构造期拼名，`mcpToolNames.test.ts:51,63` 有冲突测试                                                                                                                                                                                                                                                                                                                                                                                                        |
| 批次 2 部分：工作区写边界                                                                          | `permissions/workspacePath.ts:65` `isWithinWorkspace`；`permissionChecker.ts:233` 越界写升 ask；`applyPatch.ts:230` 调用                                                                                                                                                                                                                                                                                                                                                                      |
| 批次 5：validateArgs                                                                               | `packages/cli/src/tools/validateArgs.ts` 存在                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 批次 6：会话级审批缓存（v2 由 partial 更正为 done；初版因按参考库文件名 grep 而误判）              | `permissions/sessionApprovals.ts`（2026-10-15 合入）：MCP 永不缓存（:27）、命令规范化键（:40 空白折叠、注释明确链命令不缩写）、容量淘汰 MAX_SESSIONS=20 / MAX_KEYS_PER_SESSION=500（:9-10）；接线三处齐全——`stream/permissionFlow.ts:16,256` 执行期短路（hook 否决仍先生效）、`ui/hooks/useChat.ts:887,897-909`（forSession 路径）、`acp/permissions.ts:4`；UI 卡片有对应选项（`ToolPermissionSelector.tsx:54-58` `approve_session` 按钮、`:185` 注释"rest of the session, nothing written"） |
| 批次 9：时间驱动微压缩（v2 由 not-done 更正为 done；初版关键词 gapThreshold 未命中实际命名 gapMs） | `compaction/microCompact.ts`：`DEFAULT_CACHE_GAP_MS = 5 分钟`（:19，`CONTINUE_CLI_CACHE_GAP_MS` 可覆盖 :24-25）、`shouldMicroCompact` 纯函数（:57-64）、至少一条存活（`microCompactHistory` 保 lastUserIndex 之后不清理，:112-130 注释"the last turn is out of reach"）；接线：`stream/streamChatResponse.ts:209` `noteRequestSent()`、`stream/streamChatResponse.compactionHelpers.ts:98` `isCacheCold()`                                                                                    |
| 批次 M：normalizeUsage 三适配器归一                                                                | `packages/openai-adapters/src/util.ts:63`，测试 14 用例全过（本机运行）                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 批次 O：Anthropic 断点收敛 ≤2、不发 1h TTL                                                         | `openai-adapters/src/apis/cacheControl.ts:140` `ANTHROPIC_BREAKPOINTS_KEPT = 2`；grep `ttl` 在适配器为空                                                                                                                                                                                                                                                                                                                                                                                      |
| 批次 D：VERDICT 解析闭环                                                                           | `subagent/verdict.test.ts:7-9` `parseVerdict` pass/fail/partial；`builtInAgents.test.ts:42` 系统提示以 VERDICT 行结尾                                                                                                                                                                                                                                                                                                                                                                         |
| 批次 8：hook `transcript_path` 实填 + SessionStart additionalContext                               | `hooks/fireHook.ts:51` 填 `getSessionFilePath()`；`hookRunner.ts:612-643` additionalContextParts 聚合                                                                                                                                                                                                                                                                                                                                                                                         |
| 批次 E 部分：Todo 注册给模型                                                                       | `tools/registry.ts:89` todoTool 进 WORKSPACE_TOOLS；`todo.ts:21` `TODO_TOOL_NAME = "Todo"`                                                                                                                                                                                                                                                                                                                                                                                                    |
| 批次 4 部分：八个内建工具上模型                                                                    | `registry.ts:91-93` codebaseSearch/diagnostics/findSymbol/hover/completion 全部在 WORKSPACE_TOOLS 导出面                                                                                                                                                                                                                                                                                                                                                                                      |
| 批次 A：行为条款写进系统提示                                                                       | `agent/systemMessage.ts:98-127` "Doing tasks" 16 条 + "Communication style" 7 条，覆盖参考 18 条的语义主体                                                                                                                                                                                                                                                                                                                                                                                    |
| 批次 12 部分：大粘贴折叠 + 历史搜索                                                                | commit `360cfaede`（git log）                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TUI 主题：/theme 切换 + auto 明暗探测                                                              | 新文件 `ThemeSelector.tsx`（themeName                                                                                                                                                                                                                                                                                                                                                                                                                                                         | "auto"）+ `ui/theme/terminalAppearance.ts:15-16` OSC 11 + COLORFGBG 双信号；i18n 双语 key 已加（`i18n/index.ts` 未提交 diff） |
| TUI：diff 语法高亮 + 代码块接入主题                                                                | commit `44408d884`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TUI：审批卡按工具定制                                                                              | commit `bc74b4089`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TUI：工具调用圆角边框卡片                                                                          | commit `91048934f`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TUI：todo 树形面板 + GOAL 统一                                                                     | commit `74a3b964d`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CI：测试矩阵 12→4 收敛                                                                             | commit `ccf3bd820`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 文档：headless flags 表 + 环境变量具名                                                             | commit `687dad0d9`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 文档：Continue 时代遗留清理                                                                        | commit `6ca63e5a0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 批次 6 相邻：不再写过宽永久授权规则                                                                | `permissions/policyWriter.ts:29-37`：危险单命令写全串（isCommandRiskyAlone 分支）、低危首词写 `Bash(cmd*)` 是**by design 的分层**（危险命令永不缩写），注释含 `git add . && rm -rf /` 反例。初版报告在 G-1 证据里把 `cmd*` 形状当缺口是误读，v2 更正：该文件的语义本身没有问题                                                                                                                                                                                                                |
| bash 规则按算子切段（批次 7 部分）                                                                 | `permissions/bashCommandRule.ts:23-28` segments 切分 + EMBEDDED_CODE 检测                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 凭据文件守卫有测试钉住                                                                             | `tools/credentialFileGuard.test.ts`（6 用例，随全量套件通过）；read/edit 走 `throwIfFileIsSecurityConcern`（`edit.ts:6,48`）                                                                                                                                                                                                                                                                                                                                                                  |
| applyPatch 工具落地（含工作区检查）                                                                | `tools/applyPatch.ts` + 16 用例测试（本机通过）                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 2.3 partial（主路径已通，留缺口）

| 条目                                            | 已落地                                                                                                                                                                        | 缺口证据                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write 安全守卫                                  | 政策层 `workspaceOnly: true`（`defaultPolicies.ts:14-17`）把越界写升 ask；stale guard（`writeFile.ts:138` changedSinceSeen）                                                  | `writeFile.ts` 自身不调 `throwIfFileIsSecurityConcern`（grep 空），敏感文件直拦只覆盖 read/edit；`writeFile.test.ts` 仍不存在                                                                              |
| 批次 4 工具可见面守卫                           | `documentedSurface.test.ts` 守卫注册表非空、含 4 个 LSP 工具、Rename 未暴露                                                                                                   | 无"完全划分"断言（ALL_BUILT_IN_TOOLS = 可见 + UNEXPOSED_REASONS 的红测试未建）；registry 仍 push 组装（`registry.ts:117-141`）                                                                             |
| 批次 10 缓存破坏检测接 CLI 链                   | `cache/cacheBreakReport.ts:4` 引 core 检测，usageTelemetry 接线                                                                                                               | 断点实测（同提示词两轮对比）无本会话运行记录；阈值未确认按 TNT 重标定                                                                                                                                      |
| 批次 12/13：TUI 流式结构（v2 修正：半成品已在） | `ui/utils/transcriptSegments.ts:16-27` `splitTranscriptSegments` settled/live 按条切分纯函数 + 测试；`TUIChat.tsx:212,311` setStaticRefreshTrigger / onRefreshStatic 刷新铺垫 | 无 JSX `<Static>` 使用（本会话 `grep -rn "<Static" packages/cli/src/` 仅 `transcriptSegments.ts:5` 注释命中）；无内容级安全切点（流式文本不落未闭合代码围栏的切分）；无 pending buffer（chunk 仍直进历史） |

（v2 移除条目：批次 6 审批缓存、批次 9 时间微压缩——两者经机制形状核验确认为 done，移入 §2.2。）

### 2.4 not-done（仍开放，v2 全部经机制形状二次核验）

| 条目                                             | 证据（含二次核验关键词）                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 危险 allow 前缀剥离表（批次 7 前半）             | `permissions/` 无 dangerousPatterns 类文件（ls 无 danger/pattern 命中）；二次核验：`permissionChecker.ts:188-197` 规则命中即 break 返回 basePermission，窄化仅有 docsOnly/workspaceOnly/readOnlyAllow/readOnlyOnly 四种（本会话读源码），无危险算子降级 |
| Search 默认策略收紧（批次 1 第 3 步）            | `defaultPolicies.ts:29,89` 均 allow；`searchCode.ts` 无 `evaluateToolCallPolicy`（grep 空，仅 `runTerminalCommand.ts:189` 有）                                                                                                                          |
| 批次 11 两轴终止 / 抢占 token / 重试分类         | 未发现对应结构（未复核到替代命名）                                                                                                                                                                                                                      |
| 批次 G systemMessage 分节 merge-patch 重announce | 二次核验关键词 snapshot/renderDiff/diff 片段均未命中；`systemMessage.ts` 仍整段模板                                                                                                                                                                     |
| 批次 H 上下文预算注入                            | 二次核验关键词 `tokens left` / `tokensLeft` / `remainingBudget` / `budgetRemaining` 于 packages/cli/src 为空（本会话 grep）                                                                                                                             |
| 批次 F changed_files 自动重注入（模型可见层）    | 二次核验：`fileState.ts:99` `changedSinceSeen` 存在，但其消费方只有 edit/write 的 **stale guard**（`edit.ts:70`、`writeFile.ts:138`），不存在"已读文件 mtime 变化 → 向模型注入 diff 片段"的机制                                                         |
| 批次 P 缓存守卫进 e2e 层                         | 二次核验关键词 cacheGuard / cacheHit guard 于 `cache/` 为空；usage 归一测试在 unit 层，前缀命中率无门禁                                                                                                                                                 |

### 2.5 stale（旧文档现状描述过时）

| 条目                                | 说明                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REFERENCE_REVIEW §5 TUI 现状        | 文中描述的 `StaticChatContent.tsx` 在当前树不存在（QUALITY-AUDIT §6-5 同证）；且 §5 建议的"pending buffer + 切分"前半已有半成品（transcriptSegments），动手前以 §2.3 的 v2 修正为准 |
| NEXT_GOAL_TNT 第 4 节 cache.go 指认 | 已被 REFERENCE_REVIEW §18.0 自行纠正（该 Cache 是钱包余额缓存），保留提醒                                                                                                           |

## 3. 确认差距清单

只收 confirmed 条目（双方证据：TNT 当前树核验 + 参考库文档）。按 impact 分组。初版的 G-5（会话级审批缓存）与 G-6（时间微压缩）经 v2 复核证伪，已撤销并移入 §2.2 done 表——不要为这两项新建机制，当前实现已覆盖参考机制的全部要点。

### impact: high

**G-1 权限模型缺危险 allow 前缀剥离**

- TNT 证据：`permissionChecker.ts:188-197` 规则命中即 break 返回 basePermission（本会话读源码），命中后的窄化只有 docsOnly / workspaceOnly / readOnlyAllow / readOnlyOnly 四种，无"allow 命中的命令含危险前缀/算子则降级 ask"的路径；`permissions/` 无危险前缀表文件。
- 参考证据：claude-code `dangerousPatterns.ts:18-79` 按类别列解释器/包运行器/shell 算子/ssh/sudo，进入高风险模式时剥离 allow（转述自 REFERENCE_REVIEW §7-1，未在本会话复核参考源码）。
- 边界澄清（v2）：`policyWriter.ts:29-37` 不是缺口——它写盘的 `Bash(cmd*)` 形状只对非危险首词生效，危险单命令写全串，语义分层正确。缺的是**匹配侧**的剥离，不是**写盘侧**的形状。
- 落地判断：**改造**。在 `permissionChecker.ts` 规则命中点后插一层"allow 命中的命令若含危险前缀/算子则降级 ask"，表内容按 TNT 自身工具面自列（不抄词表）。量级 1 天 + 测试。

**G-2 Search 工具未接执行期策略钩子且默认 allow**

- TNT 证据：`defaultPolicies.ts:29,89` 均 allow；`searchCode.ts` grep `evaluateToolCallPolicy` 为空。execFile 化已完成，注入面已消，剩余是"模型可控 pattern 进入结果集"的面。
- 参考证据：REFERENCE_REVIEW §1.1 第 3 步建议默认 ask + readOnly。
- 落地判断：**改造**。TNT 已有 `readOnlyAllow` 机制（`defaultPolicies.ts:47` Bash 形状）与 headless 对 ask 的语义注释（`defaultPolicies.ts:8-10`），按"ask + readOnlyAllow"落地而非纯 ask。量级半天。

**G-3 TUI 流式渲染无 Static 分区（v2 修正证据面）**

- TNT 证据：全树无 JSX `<Static>`（grep 仅 `transcriptSegments.ts:5` 注释命中）；**但半成品已存在**：`ui/utils/transcriptSegments.ts:16-27` settled/live 按条切分纯函数（含测试），`TUIChat.tsx:212,311` static 刷新触发铺垫。缺的是三件事：切分函数未接渲染层、无 pending buffer（chunk 直进历史）、无内容级安全切点（流式文本切分不落未闭合代码围栏）。
- 参考证据：gemini-cli `useGeminiStream.ts:1263-1308` chunk 只写 pending item + `findLastSafeSplitPoint` 内容切分、`MainContent.tsx:411-421` Static/实时分区（转述自 REFERENCE_REVIEW §5；该节现状描述 stale，机制有效）。
- 落地判断：**改造**。接线已有的 `splitTranscriptSegments`（按条切分到 Static/live 两区）是第一步；内容级 fence 安全切点是第二步（纯逻辑，gemini 行扫描器思路可参照）；不抄依赖 ink fork 的部分（STRUCTURE_PLAN 第 5 节反模式）。量级 2-3 天（v2 下调，初版 3-5 天高估）。

**G-4 工具可见面无完全划分守卫**

- TNT 证据：`registry.ts:99+` push 组装 + 能力门控；`documentedSurface.test.ts:39` 只断言单点（Rename 未暴露），无全集等式。
- 参考证据：opencode `tool.ts:225-287` 纯函数 snapshot；dsh "Model-visible 当且仅当已记录"不变量（转述自 REFERENCE_REVIEW §2）。
- 落地判断：**自研**（守卫是 TNT 自己的约定）。一条测试：`ALL_BUILT_IN_TOOLS 名集 = registry 可见集 ∪ 显式 UNEXPOSED_REASONS 键集`，不等即红。量级半天。

### impact: medium

**G-5 缓存守卫测试未进自动化层**（v2 重新编号，原 G-7）

- TNT 证据：cacheGuard 类测试 grep 为空（二次核验确认）；usage 归一测试在 unit 层，前缀命中率无门禁。
- 参考证据：reasonix `cachehit_e2e_test.go` 尾部 3 轮均值 <90% 即失败、mock 回吐不打真 API；反面教训是没进 CI（转述自 REFERENCE_REVIEW §18.5），TNT 应直接挂 vitest e2e 层。
- 落地判断：**自研**。mock provider 回吐 hit/miss，多场景含工具循环 + 尾部均值阈值；阈值环境变量可覆盖，先设保守值（如 80%）实测后定。量级 1-2 天。

**G-6 Write 工具敏感文件直拦缺失**（v2 重新编号，原 G-8）

- TNT 证据：`writeFile.ts` 不调 `throwIfFileIsSecurityConcern`（read/edit 调，`edit.ts:48`）；`writeFile.test.ts` 不存在。
- 参考证据：claude-code `filesystem.ts:57-67` 敏感名清单 + 大小写归一反击（转述自 REFERENCE_REVIEW §1.2）。
- 落地判断：**改造**。preprocess 加守卫（对齐 edit.ts:47 接法），补五类拒绝测试（`.tnt/settings.json`、`.env`、越界、`../escape`、symlink 外逃）。placement 决策（run() 是否也拦）保持开放，测试不预钉形状（credentialFileGuard.test.ts 头注先例）。量级半天。

### impact: low（远期，列出不展开）

G-7 两轴终止/抢占 token（批次 11）；G-8 systemMessage 分节 merge-patch（批次 G）；G-9 上下文预算注入 + BodyAfterPrefix（批次 H，二次核验确认缺失）；G-10 changed_files 模型可见重注入（批次 F，二次核验确认现有 mtime 机制只服务 stale guard，非重注入）；G-11 录制回放测试层（批次 15）。

## 4. 待人工复核

1. **"未发现"型结论的残余假阴性风险**：v2 已对批次 G/H/F/P 完成机制形状关键词二次核验（见 §2.4 证据列），但仍不能排除以第三种命名存在的可能。剩余 5 条 not-done 中，批次 G/H/F 的机制覆盖面大、若已存在不可能无痕迹，风险低；批次 P（守卫测试）与批次 11（两轴终止）建议动手前各做一次全目录读文件级确认（而非 grep）。
2. **缓存断点数 2 是否真是 TNT 各 provider 的最优**——`cacheControl.ts:130-139` 注释自认"nothing here can tell whether a prefix is long enough or still warm"。REFERENCE_REVIEW §11 要求真实密钥两轮对比，本会话无密钥、未运行。复核方式：带密钥跑 `anthropic-caching.live.test.ts`，记录连续两轮 cacheRead。
3. **规则命中即 allow 的完整读法**：G-1 的核心主张（无危险算子降级）已经本会话读 `permissionChecker.ts:185-200` 确认；但"安全分析结果在规则 allow 命中后是否还有机会介入"的完整控制流未逐分支走读。G-1 动手前先走读一遍。
4. **六个失败维度链是否重跑**：六个维度分析全部因 Model creation failed 失败。本报告用本地核验兜住了对账与安全面，但"闭源发行物对照"维度完全无覆盖。若维护者需要该维度，需重跑或换模型供给。
5. **对账统计的可信度边界**：26 done / 4 partial / 7 not-done / 2 stale 的每条 TNT 侧证据是本会话亲自核验的；REFERENCE_REVIEW_TNT.md 中转述的参考库侧行号（claude-code/gemini-cli/codex/opencode/dsh/reasonix）本会话未逐一复核，移植时需回源码定位（开头已声明）。

## 5. 行动路线图（v2 修订）

每项独立 commit、带测试（门禁：431 测试文件 427 通过 / 4 跳过 / 0 失败，本会话验证的基线）。

### P0（小改即可见效，合计约 2 天）

| #    | 做什么                                                                                                                                                        | TNT 文件                                                                                                         | 参考来源与机制                                                                                                         | 差距项 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| P0-1 | 危险 allow 前缀剥离：规则命中 allow 后，命令含解释器/包运行器/shell 算子前缀则降级 ask；词表按 TNT 工具面自列（不抄词表）                                     | `permissions/permissionChecker.ts`（:188-197 命中点后插层）、新 `permissions/dangerousCommandPrefixes.ts` + 测试 | claude-code `dangerousPatterns.ts` 分类学（机制转述，动手前回源码）；匹配侧改造，勿动 policyWriter（其写盘分层已正确） | G-1    |
| P0-2 | Search 默认策略：allow → ask + readOnlyAllow（auto 模式按现有语义放行只读）；给 searchCode 接 `evaluateToolCallPolicy`（照 `runTerminalCommand.ts:189` 形状） | `permissions/defaultPolicies.ts:29,89`、`tools/searchCode.ts`                                                    | REFERENCE_REVIEW §1.1 第 3 步；TNT 自有 readOnlyAllow 机制                                                             | G-2    |
| P0-3 | Write 敏感文件守卫：preprocess 调 `throwIfFileIsSecurityConcern`（对齐 edit.ts:47 接法）+ 建 `writeFile.test.ts`（五类拒绝）                                  | `tools/writeFile.ts`、新 `tools/writeFile.test.ts`                                                               | claude-code `filesystem.ts:57-67`；placement 开放决策不预钉                                                            | G-6    |
| P0-4 | 完全划分守卫测试：ALL_BUILT_IN_TOOLS = 可见集 ∪ UNEXPOSED_REASONS，不等即红                                                                                   | `tools/documentedSurface.test.ts` 增用例                                                                         | dsh 不变量思想（转述）；opencode snapshot 形状                                                                         | G-4    |

### P1（改造落地，合计约 4-5 天；v2 因撤下 P1-1/P1-2 并下调 P1-3 量级而缩短）

| #    | 做什么                                                                                                                                                               | TNT 文件                                                                                                                                                       | 参考来源与机制                                                                               | 差距项   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| P1-1 | 缓存守卫进 e2e：mock 回吐 hit/miss，多场景含工具循环，尾部 3 轮均值阈值（先 80% 保守起步）；附"两次 reload 产出 prompt/schema 字节相同"断言                          | 新 `packages/cli/src/cache/cacheGuard.e2e.test.ts`、挂 vitest e2e 配置                                                                                         | reasonix `cachehit_e2e_test.go` 形状（转述）；其未进 CI 的反面教训                           | G-5      |
| P1-2 | TUI 流式接线第一步：把已有 `splitTranscriptSegments` 接进渲染层——settled 条目交 Static（或等效一次性打印区），live 区只渲染尾部未定稿条目；改前先跑 flicker 基线计数 | `ui/components/ScreenContent.tsx`、`ui/TUIChat.tsx`（消费 `transcriptSegments.ts`，已有 `setStaticRefreshTrigger` 铺垫）、`ui/hooks/useChat.stream.helpers.ts` | gemini-cli Static/实时分区（机制转述）；TNT 半成品 `transcriptSegments.ts:16-27` 直接复用    | G-3 前半 |
| P1-3 | TUI 流式第二步：pending buffer + 内容级安全切点（切点不落未闭合代码围栏），chunk 先入 buffer、过安全边界才切进 settled                                               | `ui/hooks/useChat.stream.helpers.ts`、新纯函数 `ui/utils/streamSplit.ts` + 测试                                                                                | gemini-cli `findLastSafeSplitPoint` + 行扫描器思路（转述，纯逻辑可参照；不抄 ink fork 依赖） | G-3 后半 |

（v2 撤下条目：原 P1-1 会话级审批缓存、原 P1-2 微压缩时间维度——两者均已落地（`sessionApprovals.ts`、`compaction/microCompact.ts`），照原路线执行会重复建设两套并存缓存/压缩，**不要做**。）

### P2（自研或远期）

| #    | 做什么                                                          | 说明                                                                                                                |
| ---- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P2-1 | 全屏 Static 定稿评估 + flicker 计数常态化                       | G-3 收尾；视 P1-2/P1-3 实测滚动成本决定是否退出 alternate screen；gemini `useFlickerDetector` 可观测思路（转述）    |
| P2-2 | 两轴终止 + 抢占/中止 token + 重试分类与 Retry-After             | 批次 11；codex `turn.rs`（转述）；独立设计轮；与 P1-2/P1-3 同碰 stream 回调，错峰                                   |
| P2-3 | systemMessage 分节 merge-patch 重announce + 压缩清基线          | 批次 G；codex world_state（转述），`has_retained_fragment` 防骗是关键；工程量最大                                   |
| P2-4 | 上下文预算注入 + BodyAfterPrefix 压缩口径                       | 批次 H；依赖 P2-3 分节化才干净                                                                                      |
| P2-5 | changed_files 模型可见重注入（mtime → diff 片段）+ 三级上限     | 批次 F；注意与现有 `changedSinceSeen` stale guard（edit/write 用）区分：重注入是往模型上下文里放 diff，不是拒绝编辑 |
| P2-6 | 录制回放测试层（无密钥守 loop 行为）+ Windows headless e2e 补位 | 批次 15 / REFERENCE_REVIEW §9-7                                                                                     |

依赖关系：P0-1 与 P0-2 同碰权限文件，串行；P1-2 → P1-3 有序（先接线再加深）；P2-2 与 P1-2/P1-3 错峰（同碰 stream 回调）；P2-3 → P2-4 → P2-5 是同一条上下文线。

## 6. 风险与依赖

1. **落地约束（用户已定的移植卫生规则，违反即返工）**：TNT 代码注释与文件名不得出现任何参考产品名（cursor/pi/gemini/claude/codex/omp/opencode 等）。新改动必须自查；`hookConfig.ts` 的 `~/.claude/settings.json` 是功能兼容路径不能删，注释改中性表述。
2. **阈值重标定**：所有参考库数字（危险前缀词表、缓存 5%/2000 阈值、守卫 90% 命中率、TNT 已用的 5 分钟 gap）都是各自上下文的产物，落地时按 TNT 自己的 provider 组合重定，先保守后收紧，并把定标过程写进提交信息。TNT 现有 `DEFAULT_CACHE_GAP_MS = 5 分钟`（microCompact.ts:19）与参考库的 60 分钟不同，这就是重标定已经发生的例子，不要"改回参考值"。
3. **请求前缀敏感性**：P0-2 与任何工具面改动都会改请求前缀，引起一次命中率回撤。P1-1 的守卫测试要在这些改动**之前**落地，才能归因回撤是预期还是事故。
4. **流式改造的冲突面**：P1-2/P1-3 与 P2-2 都改 `src/stream` / `ui/hooks` 回调；按工作区"git 串行、文件所有权互斥"规则错峰。每批独立 commit，动手前重跑基线（本会话基线：427 通过 / 4 跳过 / 0 失败，含未提交改动，合入后会漂移）。
5. **ink fork 反模式维持**：不引入 `@jrichman/ink` 类分支（STRUCTURE_PLAN 第 5 节已定）；高度用行数估算，抖动用自建计数。
6. **核验方法学教训（v2 新增）**：按参考库的文件名或关键词 grep TNT 判定"缺失"不可靠——sessionApprovals（approvalCache）与 gapMs（gapThreshold/timeBased）两例假阴性已证。任何"未发现"型结论落地前必须换机制形状关键词二次核验，最好读文件级确认。
7. **本轮分析覆盖缺口**：六个维度链失败意味着四个维度（检索/引擎/上下文/工具）无独立新分析输入，由对账核验与两份既有报告间接覆盖；"闭源发行物对照"维度完全无覆盖（§4-4）。若后续重跑且与本报告冲突，以带本机证据者为准。

---

_报告完（修订版 v2）。TNT 侧全部 file:line 均为本会话读取或 grep 验证；参考库侧行号为转述并已声明；七路分析链失败状态如实记录；v2 修订依据审读意见撤下两条被证伪的差距（G-5 审批缓存、G-6 微压缩）并修正 G-3 证据面、G-1 表述矛盾与测试数字口径。_
