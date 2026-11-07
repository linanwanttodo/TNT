# 借鉴缺口收敛计划（详细执行版，2026-11-06）

来源：`test-continue/REFERENCE_REVIEW_TNT.md`（15+12 批次建议清单）与 2026-11-06
对当前工作区的逐条核验。本文每批给出：现状证据（真实行号，2026-11-06 核验）、
目标行为、逐步改法、边界情况、测试清单、提交切分、验收清单。

执行纪律：

- 验证门三条命令全绿：`npx tsc --noEmit` + `npx vitest run` + `npx prettier --check`。
- 改动行为同步更新守卫测试与本文件状态标记（`[ ]`→`[~]`→`[x]`）。
- 注释与文件名只描述机制；提交信息 Conventional Commits、祈使句、<72 字符、
  署名只有用户本人。

---

## 批次 1：webui standalone 权限链路修复（bug 级，最先做）`[x]`

> 2026-11-06 完成：`buildServedStreamCallbacks` 抽取（serve.helpers.ts）、
> runStandaloneTurn 接线 + pendingPermission 清理（webui.ts）、删 system 预置（方案 A）、
> `webui.standalone.test.ts` 6 例。T1.3/T1.4（reject/timeout 语义）复用
> requestUserPermission 既有行为，由 permissionFlow 既有测试覆盖。
> 顺带修复：`ui/PluginsBrowser.tsx` 字面 `✓` 违反符号表守卫（既有未提交文件的问题），
> 改用 `symbols().check`。验证门全绿（532 文件 / 4243 测试）。

### 1.1 现状证据

- `commands/webui.ts` 的 `runStandaloneTurn`（约 148-171 行）调用 `runAgentTurn`
  只传 `{chatHistory, model, llmApi, abortController}`，**不传任何 StreamCallbacks**。
- `stream/permissionFlow.ts:78-80`：`requestUserPermission` 在
  `!callbacks?.onToolPermissionRequest` 时直接 `return false` → ask 类工具一律静默拒绝，
  HTTP 面的 `POST /permission`（`services/WebUiService.ts:277-296`）永远不会收到请求。
- **应答链路本身是通的**（本次核验确认）：`WebUiService` 的 `/permission` 处理器调
  `interactionBroker.approve/reject(requestId)`，broker 直接应答全局
  `toolPermissionManager`；而 `permissionFlow.ts:95-150` 的
  `permissionManager.requestPermission(toolCallRequest, timeoutMs)` 就是在这个 manager
  上等待。**唯一断点 = standalone 没把权限事件挂到 state 供前端看见。**
- 正确范本：`commands/serve.helpers.ts:138-168` 的 `onToolPermissionRequest`
  回调——把 `{toolName, toolArgs, requestId, toolCallPreview}` 写进
  `state.pendingPermission`，不阻塞（等待发生在 requestPermission 内部）。
- 附带 bug：`webui.ts`（约 259-264 行）把 `constructSystemMessage` 结果预置进历史，
  但 standalone 发流前未像 `serve.helpers.ts:183-190` 那样剔除历史头部 system 项
  → 请求里出现双份 system 语境。

### 1.2 目标行为

standalone 形态下，一个 ask 类工具调用：

1. `/state` 出现 `pendingPermission`（含 requestId、toolName、preview）；
2. 前端 POST `/permission {requestId, approved}` 后工具继续（或拒绝并把原因回给模型）；
3. 前端不响应时走 `DEFAULT_PERMISSION_TIMEOUT_MS` 超时 → 拒绝 + 日志 warn；
4. 请求体里 system 语境只出现一份。

### 1.3 改法步骤

1. **抽出 callbacks 组装**：serve.helpers 里的权限/systemMessage 回调逻辑提为
   `commands/serve.helpers.ts` 导出的 `buildServeStreamCallbacks(state)`（或新建
   `commands/servedCallbacks.ts`），serve 与 standalone 共用。包含：
   `onToolPermissionRequest`（写 `state.pendingPermission`）、`onSystemMessage`
   （serve.helpers.ts:169-180 逻辑：写历史 + 状态）、`onToolResult`/`onToolError`（no-op，
   ChatHistoryService 是真源）。
2. **runStandaloneTurn 接线**：调用 `runAgentTurn({...callbacks})`；abort 语义保持
   现状（drain-loop signal → AbortController，webui.ts:152-158 的注释逻辑不动）。
3. **pendingPermission 清理**：requestPermission 返回后（无论 approve/reject/timeout）
   清掉 `state.pendingPermission`——serve 形态目前靠下一轮覆盖，补一个显式清理点
   （在 callbacks 外层包一层 promise finally，或由 `/permission` 应答处清）。
   两形态共用，一并修。
4. **双份 system 修复（二选一，倾向 A）**：
   - A：删掉 webui.ts 的历史预置（约 259-264 行），只靠引擎内
     `services.systemMessage.getSystemMessage(mode)` 注入（与 serve/ACP 一致）；
   - B：保留预置，发流前照 serve.helpers.ts:183-190 剔除。
     选 A 的理由：少一处特殊分支，历史里不存 system 项也符合"引擎是真源"。
5. **守卫**：`architecture.test.ts` 若对 commands/ 分层有约束，确认新文件位置合规。

### 1.4 边界情况

- 并发多个 ask 工具：`requestId` 各自独立，前端逐个应答；`pendingPermission`
  只保留最新一个（与 serve 现状一致），历史 pending 由应答/超时清理兜底。
- 前端拿到过期 requestId（工具已超时）：`/permission` 现有注释已声明"仍会 resolve
  等待中的 turn；只有缺失 id 才 400"——保持不变，不需要新逻辑。
- `POST /pause` 打断带 pending 权限的回合：requestStop abort turn，
  `requestPermission` 的 finally 清理 requestId 监听（permissionFlow.ts:149-151 已有），
  补清 `state.pendingPermission`。
- headless/`-p` 不受影响：它走 fail-closed（permissionFlow.ts:260,308），
  本批次不动这条。

### 1.5 测试清单

- `commands/webui.standalone.test.ts`（新增）：
  - T1.1 mock LLM 触发 ask 工具 → 断言 `state.pendingPermission` 出现且 requestId 非空；
  - T1.2 POST /permission approve → 工具执行、pending 清空、回合正常结束；
  - T1.3 POST /permission reject → 工具收到 canceled 结果，模型收到拒绝原因；
  - T1.4 不应答 → 超时后拒绝（用 vi.useFakeTimers 控制）；
  - T1.5 发出的请求体里 system 项只出现一份；
  - T1.6 POST /pause 后 pending 清理、abort 正常。
- 回归：现有 WebUiService 测试、serve 权限测试、headless fail-closed 测试全绿。

### 1.6 提交切分与验收

- commit 1：`fix(webui): wire permission callbacks into standalone turns`
  （步骤 1-3）；commit 2：`fix(webui): stop double-injecting the system message`
  （步骤 4）。
- 验收：T1.1-T1.6 全绿；三条验证门绿；手测一次 `tnt webui` 走一遍审批。

---

## 批次 2：审批缓存与 policyWriter 收敛 `[x]`

> 2026-11-06 完成。核验修正：`sessionApprovals.ts` 本身已是审批缓存
> （MCP 不缓存、写按文件、整链不缩水、会话隔离均既有），不另建新文件；
> 本次升级 = Bash 键加 cwd（跨目录相对命令不串）+ permissionFlow 引擎侧统一
> 处理 remember（应答携带 remember → 引擎持有会话审批，四形态语义一致）+
> useChat 委托引擎 + webui /permission 与前端 ApprovalCard 透传 remember +
> ACP allow_always 收敛为纯标记转发 + policyWriter 形状收窄到二级动词
> （git status → `Bash(git status*)`，遇 flag 截断）+ 删除零引用的
> `permissions/runtimeOverrides.ts`。测试：`sessionApprovals.test.ts`（cwd 用例）、
> `permissionFlow.remember.test.ts`（新增 2 例）、`policyWriter.test.ts`
> （二级动词断言）、ACP/WebUiService 测试更新为新契约。
> 验证门全绿（533 文件 / 4248 测试，webui 46 测试）。

### 2.1 现状证据（2026-11-06 核验）

- **TUI 路径其实已经分层**（修正上轮"完全没接"的判断）：
  `ui/hooks/useChat.ts:977-986` —— 用户选"本会话允许"时走
  `rememberSessionApproval(toolName, toolArgs)`，纯内存不写盘；
  `:988-1010` —— 用户显式选"创建策略"才 `generatePolicyRule` + `addPolicyRule` 写盘
  并 `reloadPermissions()`。引擎侧 `stream/permissionFlow.ts:21` 也已 import
  `hasSessionApproval` 做命中检查。
- **仍然缺的三块**：
  1. 会话审批的键粒度太粗：`sessionApprovals` 按 `toolName + toolArgs` 原样记键，
     没有"命令规范化、写按文件路径、MCP 永不缓存"的分级——参考侧语义是
     exec 键 = 首个可执行 + 规范化命令 + cwd，apply_patch 按文件逐个键，
     MCP/网络永不缓存。
  2. `policyWriter.generatePolicyRule` 产出 `Bash(<firstword>*)` 形状：
     一条 `git push --force && rm -rf x` 会因首个词 `git` 被永久放行（叠加批次 5 的问题）。
  3. `permissions/runtimeOverrides.ts` 零引用（连测试都没有）；
     `permissionManager.ts:7` 的 `remember` 字段注释自认 "For future implementation"。
- 非 TUI 形态（serve/webui/ACP/headless）没有任何 always 通道：headless fail-closed
  是对的；serve/webui/ACP 的"允许一次"每次都要重新问——没有会话级记忆可落。

### 2.2 目标行为

- 四个交互形态（TUI/serve/webui/ACP）共享同一套会话级审批缓存语义：
  键规范化、写按文件、MCP 不缓存、只活在本进程会话内。
- "always" 默认只进会话缓存；写盘（permissions.yaml）必须用户显式 opt-in，且
  规则形状收窄。
- 死代码清零。

### 2.3 改法步骤

1. **新增 `permissions/approvalCache.ts`**（替代 `sessionApprovals.ts` 的键逻辑，
   保留后者对外 API 或直接迁移——按引用面小者定，`sessionApprovals` 引用仅
   permissionFlow:21 与 useChat:980 两处，直接迁移改名）：
   ```ts
   // 形状（示意）
   export function approvalKey(
     toolName: string,
     args: unknown,
     cwd: string,
   ): string | null;
   // Bash: 过 @tnt/terminal-security 分词 → 首个可执行 + 规范化 argv + cwd；
   //       规范化 = 去引号、折叠空白、参数排序仅对 flag 后的确定集合。
   // applyPatch/MultiEdit/Edit/Write: `edit:<abs 路径>`（逐文件一键）。
   // MCP 工具（mcp__ 前缀）、webSearch/browser/computer 等网络类: return null（永不缓存）。
   export function rememberApproval(key: string): void;
   export function hasApproval(key: string): boolean;
   export function clearApprovals(): void; // 回合中止/会话结束时由 controller 调
   ```
2. **permissionFlow 接线**：进入 `requestUserPermission` 前先
   `hasApproval(approvalKey(...))` 命中即放行（替换现有 hasSessionApproval 调用点）；
   UI 应答"always"的回传通道不变（permissionManager 的决定对象里已有分级），
   "always" 分支写 `rememberApproval`。
3. **useChat.ts:977-986 改调 approvalCache**（记住的键变规范化键）；
   `:988-1010` 的写盘分支保持显式 opt-in，但 `generatePolicyRule` 收窄：
   - Bash：`Bash(<首词> <子命令?>*)` 只到二级动词，且**含 shell 算子的命令拒绝生成规则**
     （返回 null 并 log，UI 提示"该命令含组合算子，只支持本会话允许"）；
   - 文件类工具生成 `Edit(~/path/**)` 或 `Write(/abs/path)` 形状。
4. **四形态贯通**：serve/webui/ACP 的权限应答 UI 增加"本会话允许"选项
   （webui 的 ApprovalCard 加一个按钮；ACP 走 allow_always 映射到会话缓存而非
   永久策略）。headless 不加（fail-closed 是设计）。
5. **死代码**：删 `permissions/runtimeOverrides.ts`；处置
   `permissionManager.ts` 的 `remember` 死字段（随本次语义并入决定对象或删除）。

### 2.4 边界情况

- 回合被 abort / 会话结束：`clearApprovals` 挂到 controller 的会话清理点；
  子代理共享父会话缓存（与 promptCacheKey 同策略）。
- 同名工具不同 cwd：键含 cwd，不串。
- 用户"本会话允许"后该工具策略又变严（permissions.yaml 热重载）：缓存命中只跳过
  ask，不跳过 deny——deny 判定必须仍先走 `permissionChecker`（顺序：deny > 缓存 > allow 规则）。
- 键规范化不能吞掉语义差异：`git commit -m "a" && rm x` 含算子 → 不缓存、必问。

### 2.5 测试清单

- `approvalCache.test.ts`（新增）：
  - T2.1 键规范化：`git  commit   -m 'x'` 与 `git commit -m "x"` 同键；
  - T2.2 算子命令 → key 为 null（永不缓存）；
  - T2.3 MCP 工具 → null；webSearch/browser → null；
  - T2.4 Edit/Write 按文件路径分键，两个文件两个键；
  - T2.5 不同 cwd 不同键。
- `permissionFlow` 扩展：
  - T2.6 缓存命中跳过 onToolPermissionRequest（不发事件）；
  - T2.7 deny 规则优先于缓存命中（先配 deny 再缓存，仍拒）。
- `policyWriter` 收窄：T2.8 组合算子返回 null；T2.9 `git push` 生成 `Bash(git push*)` 而非 `Bash(git*)`。
- 回归：useChat 权限测试、ACP allow_always 测试。

### 2.6 提交切分与验收

- commit 1：`feat(permissions): add normalized session approval cache`（步骤 1-3）；
- commit 2：`feat(surfaces): offer session-scoped always in serve/webui/acp`（步骤 4）；
- commit 3：`chore(permissions): drop dead runtime overrides and remember field`（步骤 5）。
- 验收：T2.1-T2.9 绿；手测 webui 连续两条同形 Bash 第二条不再询问。

---

## 批次 3：VERDICT 消费端闭环 `[x]`

> 2026-11-06 完成。核验修正：传输层本就无缺口——SSE 全量透传
> `subagent.finished`（verdict 随 JSON），ACP 经 Subagent 工具结果内容拿到
> verdict，`tools/subagent.ts` 早已在 `<task_metadata>` 里写 `verdict:` 行；
> PARTIAL 语义（"It is not for uncertainty"）已存在于 verification prompt。
> 本次落地：新增 `subagent/report.ts`——`[VERDICT: X]` 徽标行（TUI 工具结果与
> webui 工具卡片可见）、PASS 报告尾部的抽查引导（重跑 2-3 条命令核对输出）、
> `noteVerificationOutcome` nudge tracker（连续 3 个 PASS 未复核 → 注入一次
> 提醒，FAIL/PARTIAL 重置，触发后重新武装）；`tools/subagent.ts` 改用
> `formatSubagentToolResult` 组装。测试：`report.test.ts` 7 例 + builtInAgents
> PARTIAL 钉子。验证门全绿（534 文件 / 4256 测试）。

### 3.1 现状证据（2026-11-06 核验）

- `subagent/verdict.ts`：解析契约已实现（独立行、恰好一个关键字、拒内联匹配）；
  `executor.ts:24,267,274` 已接线，`subagent.finished` 事件带 `verdict?: string`
  （`protocol/events.ts:88`）。
- **缺口**：三个消费面全部不读——`acp/updates.ts` 不透传、`stream/eventAdapter.ts`
  不映射、TUI/WebUI 无渲染；父代理无 PASS 抽查环节、无连续未验证 nudge；
  verification 内置代理的 prompt 未约束 PARTIAL 语义。

### 3.2 目标行为

1. verification 子代理的报告末尾 `VERDICT: PASS|FAIL|PARTIAL` 在父代理可读的结果里
   显式可见，且各事件消费面透传；
2. PASS 后父代理被引导抽查（重跑报告里的 2-3 条命令核对输出）；
3. 同会话连续 ≥3 个 verification 结果未被复核时注入一次温和提醒；
4. PARTIAL 只用于环境受限，不允许表达"不确定"。

### 3.3 改法步骤

1. **事件透传**：`stream/eventAdapter.ts` 把 executor 结果里的 verdict 映射进
   `subagent.finished` 事件载荷（确认 emit 点已有字段，缺的是映射）；`acp/updates.ts`
   的 session/update 转发带上 verdict（客户端可忽略，协议向后兼容）。
2. **TUI 渲染**：`ui/components/SubagentBreadcrumb`（或子代理结果块）在 verdict 存在时
   显示 `[PASS]`/`[FAIL]`/`[PARTIAL]` 徽标；WebUI 的 subagent 卡片同步
   （`webui/src/ui/chat/`，消费事件里的同名字段）。
3. **父代理结果增强**：`subagent/executor.ts` 返回给父代理的文本尾部，当
   verdict === PASS 时追加一段固定引导（不改缓存前缀，只动本轮工具结果）：
   "该报告以 PASS 结束。抽查：从其报告中选 2-3 条已运行的命令重跑，核对每个 PASS
   都有对应输出块且与重跑一致；重跑不一致即按未验证处理。"
4. **nudge tracker**：`loop/` 新增 `verificationNudge.ts`（形状照 `toolFailureTracker`）：
   - 计数器：verification 类子代理返回且 verdict 被"抽查动作"消费（本轮有后续
     Bash/Read 命中报告中的命令）才清零；
   - 连续 3 个 PASS 无人复核 → 下一次工具结果尾部注入一条提醒
     （尾追加，文本跨轮字节稳定，不提前提，参考 todoReminder 的注入方式）；
   - tracker 经 `StreamCallbacks` 传入，四形态共享。
5. **PARTIAL 语义**：`subagent/builtInAgents.ts` 的 verification prompt 补一句：
   "PARTIAL 只用于环境受限无法完整验证；'我不确定'不是 PARTIAL，是 FAIL"。

### 3.4 边界情况

- 旧客户端（ACP 未升级）：多带字段，向后兼容，不 break。
- verdict 缺失（旧报告无关键字行）：解析器返回 undefined，全链路按无徽标处理，
  nudge 不计.
- 抽查重跑失败的命令本身：提醒文本明确"命令失败不等于验证失败，输出不一致才算"。

### 3.5 测试清单

- T3.1 eventAdapter 映射：executor 带 verdict → 事件载荷带同值；
- T3.2 ACP updates 透传；
- T3.3 父代理结果尾部追加抽查引导（PASS 时），FAIL/PARTIAL 不追加；
- T3.4 nudge：连续 3 PASS 无复核 → 第 3 次后注入一次；复核后清零；注入文本两轮字节一致；
- T3.5 builtInAgents prompt 含 PARTIAL 约束句（快照断言）。

### 3.6 提交切分与验收

- commit 1：`feat(subagent): surface verdicts to event consumers and renderers`（1-2）；
- commit 2：`feat(subagent): prompt post-PASS spot-checks and unverified nudges`（3-5）。
- 验收：T3.1-T3.5 绿；手测派发一次 verification 子代理观察徽标与引导文本。

---

## 批次 4：L1 行为条款写进 systemMessage 与工具 description `[x]`

> 2026-11-06 审计完成：**18 条条款全部已在位，无需改码**。条款 1-7 在
> `systemMessage.ts` 的 Doing tasks / Communication style 段（`Look before you
claim`、范围纪律、验证纪律、可逆性逐条存在），8-14 在 Bash/Read/Edit/Write
> 描述（专用工具优先、shell 卫生、git 不 amend/-uall、读预算、先读后改、
> Edit 优先），15 在 todo 描述（三条以上才用、仅一个 in_progress、未验证不标
> completed），16 在 `generateSubagentToolDescription`（别外包理解、别委派查询、
> 别重复其搜索），17 有 RULES_PREAMBLE + 40000 字符上限 + @include 深度限制，
> 18 有快照声明与截断告知。钉子测试齐备：`systemMessage.behaviourClauses`、
> `gitStatus`、`instructionLayers`、`toolGuidance`。

### 4.1 现状

`agent/systemMessage.ts` 目前只有环境块、gitStatus、plan 限制、output style、rules
注入、"简洁/不用 emoji"。参考侧 18 条纪律全部缺失。逐条落地位置（措辞用 TNT 自己
的话重写，不逐字搬运）：

| #   | 条款（语义）                                                                             | 落点                                     |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | 没见过的文件/函数先搜再猜                                                                | systemMessage `# Doing tasks`            |
| 2   | 没读过的代码不提改                                                                       | 同上                                     |
| 3   | 范围纪律：不做未要求的功能/重构/顺手改进                                                 | 同上                                     |
| 4   | 默认不写注释，只在 WHY 不明显时写                                                        | 同上                                     |
| 5   | 报告完成前必须验证；跑不了就明说，绝不声称通过                                           | 同上                                     |
| 6   | 可逆性：暂停确认成本低；批准过一次≠永远批准                                              | 同上                                     |
| 7   | 说话方式：写给刚离开的人；结束报结果；不问"还要别的吗"                                   | `# Communication style`                  |
| 8   | 专用工具优先于 shell（Read 不用 cat、Write 不用 `echo >`）                               | 各工具 description                       |
| 9   | shell 卫生：绝对路径、少 cd、引号、&& 优先、禁换行分隔                                   | Bash description                         |
| 10  | git 安全：新建提交而非 --amend；pre-commit 失败即提交未发生                              | Bash description                         |
| 11  | `git status` 禁 -uall                                                                    | Bash description                         |
| 12  | 读文件默认预算；知道位置就读切片                                                         | Read description                         |
| 13  | 先 Read 才能 Edit；old_string 不唯一就扩大上下文或 replace_all                           | Edit description                         |
| 14  | 改文件优先 Edit（只传 diff）而非 Write                                                   | Write description                        |
| 15  | todo 纪律：3 步以上才用；仅一个 in_progress；未验证绝不标 completed                      | Todo 工具 description                    |
| 16  | 委派纪律：子代理 prompt 自包含；绝不外包理解；带路径行号；想读具体文件用 Read 不派子代理 | Subagent description                     |
| 17  | rules/AGENTS.md 分层加载 + @include 深度上限 + preamble（"以下指令覆盖默认行事方式"）    | `agent/systemMessage.ts` 的 rules 加载器 |
| 18  | gitStatus 声明"某一时刻快照，不会更新"；截断时告知截断本身                               | gitStatus 块                             |

### 4.2 步骤与验收

- 分两小批：先 1-7 与 12-14（prompt 层 + 高频工具描述），再 15-17 与 8-11、18。
- 每批跑一次前缀三态确认：systemMessage 变化只会发生在**会话开始**（前缀第一轮就含新条款），
  不产生 mid-session `invalidated`；工具描述变化会改请求 tools 数组 → 接受一次命中率回撤，
  在提交信息里注明。
- 验收：`systemMessage.*.test.ts` 快照更新；批次 8 的事件/守卫测试不回退。

---

## 批次 5：权限规则按算子切段 + 危险前缀剥离（依赖批次 2）`[x]`

> 2026-11-06 完成。核验修正：5a 与 5b **已在位**——
> `bashCommandMatches` 已是逐段判定（`segments.every` + NEVER_BY_SHAPE 与
> 内嵌代码 fail-closed，`Bash(git*)` 不再匹配 `git status && rm -rf x`）；
> `narrowDangerousAllow` 已把解释器/包运行器/shell 前缀的 allow 窄化为 ask，
> bypass 模式经 `allowUnsafeCalls: true` 的 `*` 规则合法豁免。真正的缺口是 5c：
> searchCode 的 ignore 列表只来自 .gitignore。本次落地：新增
> `permissions/searchIgnore.ts`——把文件类工具的 exclude/deny 路径 glob
> （`Read(.env*)` 等）转成搜索排除；searchCode 的 rg 与 grep 两条路、以及
> globFiles 的文件列表都接入，且策略 glob 放在基础参数里，gitignore 回退时
> 不丢失。测试：`searchIgnore.test.ts` 4 例（收集/忽略 allow 与命令规则/
> `./` 剥离去重/rg 参数接线）。验证门全绿（535 文件 / 4260 测试）。

### 5.1 现状证据

- `permissions/permissionChecker.ts`：规则命中即返回规则本身的 allow（约 :229-233），
  安全分析（`@tnt/terminal-security` 给的 `allowedWithPermission`）被丢弃；
  Bash 规则对整串命令做正则匹配（约 :53-59）——`Bash(git*)` 会放行
  `git push --force && rm -rf x`。
- `dangerousCommandPrefixes.ts` 存在但只用于个别判定，未进入"高风险模式剥离 allow"逻辑。

### 5.2 改法步骤

1. **切段判定**：`permissionChecker` 的 Bash 分支改为——
   先用 `@tnt/terminal-security` 的分词把命令按算子（`&&`、`||`、`;`、`|`、命令替换
   `$(...)`/反引号）切段，逐段独立判：deny 命中即 deny；任一段未命中 allow 规则
   → 整体升级 ask（fail-closed）；全部段落 allow 才放行。
2. **剥离表**：进入 `auto`/`bypassPermissions`/headless 时，解释器与包运行器前缀
   （python/node/deno/ruby/perl/php、npx/bunx/npm run、sh/bash -c、ssh、sudo、eval/exec/env/xargs）
   的 allow 规则不生效——表放 `dangerousCommandPrefixes.ts` 扩充。
3. **与批次 2 衔接**：剥离后落 ask → 用户"本会话允许"只进 approvalCache，
   组合算子命令永不缓存（T2.2 已保证）。
4. **deny 反作用于搜索**（同参考语义）：`exclude` 的路径 pattern 除拦截工具调用外，
   喂给 Search/Glob/List 作 ignore-glob，deny 的文件不再出现在结果集。

### 5.3 测试清单

- T5.1 `Bash(git*)` 命中时，`git push --force && rm -rf x` 整体升级 ask；
- T5.2 `python x.py` 在 auto 模式下剥离 allow → ask；
- T5.3 deny 的 `.env*` 不出现在 Search 结果；
- T5.4 单段命令行为与现状一致（不误伤）。

### 5.4 提交

- commit 1：`fix(permissions): require every shell segment to be allowed`；
- commit 2：`feat(permissions): strip interpreter allow rules in high-risk modes`。

---

## 批次 6：上下文预算对模型可见 `[x]`

> 2026-11-06 完成。核验修正：批次 6 的主体**已在位**——`loop/contextBudget.ts`
> 的 `ContextBudgetTracker` 就是实测口径的预算机制（provider 报告的
> promptTokens，非 tokenizer 全量估算，即 BodyAfterPrefix 思想；20% 阈值；
> unknown 回退；压缩恢复后重新武装），注入点已接线于
> `streamChatResponse.ts` 的 `onTailReminder`（工具结果尾追加，不动缓存前缀），
> 与 todoReminder/repeatCallGuard 共用通道。全量 tokenizer 慢路径也已由
> `compaction/measuredContext.ts` 取代。本次落地：提醒文本追加跨窗口保留
> 安抚句（"The todo list and your notes carry over into the next window"，
> 固定模板，字节稳定）。测试：`contextBudget.test.ts` 补 T6.1（同数字字节
> 级一致）与 T6.3（安抚句）断言，9/9 通过。验证门全绿（全量 vitest 零 FAIL；
> 过程中两次出现的单例失败经三次全量复跑确认为偶发 timing，与本改动无关）。

### 6.1 现状

grep `tokens left|tokensLeft|remaining tokens` 在 agent/stream 下零命中；压缩触发
靠全量 tokenizer 事后估算（`streamChatResponse.ts` 约 887-891 的 historyGrowth 兜底、
`compaction/index.ts` 的实测 usage）。

### 6.2 改法步骤

1. **口径**：新增 `compaction/remainingBudget.ts`，定义
   `remaining = contextLength - maxCompletionTokens(预留输出) - buffer - 当前已用(实测 usage 口径)`；
   压缩压力判定采用"前缀之后"口径：已缓存前缀不计入压缩压力
   （expensive 全量 encode 只留作兜底，不再做主路径）。
2. **注入**：回合尾部追加一条固定措辞的提示（"本回合后你还有约 N token 可用；
   接近耗尽时较早收尾或主动建议压缩"）。纪律：尾追加、措辞跨轮字节稳定、
   unknown（provider 未报 usage）时用固定替代句。
3. **接近耗尽加强**：remaining < 压缩阈值时，追加一句"note 与待办会跨窗口保留"
   的安抚文本（对齐参考语义，减少模型在边界处的行为漂移）。
4. 压缩触发判定改读同一口径，删除全量 encode 的慢路径调用点（保留函数供测试）。

### 6.3 测试清单

- T6.1 注入文本在两轮间字节一致（缓存守卫）；
- T6.2 usage 缺失时走 unknown 措辞；
- T6.3 压缩触发点与新口径一致（构造已知 usage 序列断言触发轮次）；
- T6.4 smoke-api 人工核对一轮命中率不回退。

### 6.4 提交

- commit 1：`feat(compaction): surface remaining context budget to the model`。

---

## 批次 7：systemMessage 分节 merge-patch（工程量最大，最后做）`[ ]`

### 7.1 现状

`agent/systemMessage.ts` 每轮整段重建；`cache/prefixState.ts` 事后判定
full/passthrough/invalidated。前缀组装顺序已是命名分节
（base → planMode → promptProfile → headless → jsonOutput → outputStyle → userRules），
但节与节之间没有快照/diff 机制——中途换 outputStyle、改 rules 都触发整段失效。

### 7.2 改法步骤（分三步，每步独立提交）

1. **注册表化**：把组装顺序升级为冻结的节注册表（`Map<sectionId, Section>` +
   重复 id 断言 + 穷尽检查），每节声明 `stable | diffable` 与构建输入。
   行为不变，纯结构重构，现有测试全绿为准入。
2. **diffable 节实现 `renderDiff(prev)`**：
   - `gitStatus`/环境类：只发变化项；移除项显式渲染 `status: unavailable`
     （沉默不等于删除）；
   - `outputStyle`/`userRules` 变化：改为**追加在对话侧的系统消息**
     （`stream/systemPromptPolicy.ts` 已有 in-history 通道，复用），
     前缀保持首字节不变；
   - diff 判定基于节快照（只存"要不要再告诉模型"的比较字段，不存渲染全文）。
3. **基线生命周期**：压缩完成回调清空全部 diff 基线（下一轮全量重注入）；
   回合回滚/截断同理。加一个 `has_retained_fragment` 校验：
   发 diff 前确认上一版该节文本确实还在保留窗口里，否则退回全量
   （"我曾宣布过"的标志单独不可信）。

### 7.3 测试清单

- T7.1 注册表重复 id → 断言失败（构造性测试）；
- T7.2 gitStatus 只发变化项，移除项显式 unavailable；
- T7.3 mid-session 换 outputStyle → 前缀字节不变（passthrough），system 消息追加；
- T7.4 压缩后下一轮全量重注入（基线清空）；
- T7.5 基线节文本已不在保留窗口 → 全量重注入（防骗路径）。

### 7.4 提交

- commit 1：`refactor(agent): registry for system message sections`；
- commit 2：`feat(cache): diff-based section reinjection with retained-fragment guard`；
- commit 3：`feat(compaction): clear section baselines after compaction`。

---

## 批次 8：死代码清理清单（逐项接线或删）`[ ]`

| 项                                                     | 现状（核验轮）                                       | 处置                                                                                          | 随哪批做        |
| ------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| `team/closure.ts`                                      | 仅自测引用                                           | 与 prdState 一起拍板：PRD 流程要消费则接进 team loader，否则删                                | 独立            |
| `team/prdState.ts`                                     | 仅自测引用                                           | 同上                                                                                          | 独立            |
| `hooks/facets.ts`                                      | 仅自测引用，hookRunner 无消费者                      | 删                                                                                            | 独立            |
| `permissions/runtimeOverrides.ts`                      | 零引用                                               | 删                                                                                            | 批次 2 commit 3 |
| `cache/cacheHitGuard.ts`                               | 仅测试引用                                           | **接线**：进 `vitest.e2e.config.ts` 层作缓存守卫（mock 回吐 hit/miss，尾 3 轮均值阈值），不删 | 独立            |
| 事件 `queue.changed`                                   | 0 发射 0 消费                                        | 随消息队列 UI 变化接 emit（TurnRunnerService drain 处）                                       | 独立            |
| 事件 `session.changed`                                 | 0 发射 0 消费                                        | 删声明                                                                                        | 独立            |
| 事件 `question.requested`                              | 0 发射 0 消费                                        | askQuestion 工具走事件总线接 emit，或删                                                       | 独立            |
| 事件 `compaction.started/finished`                     | 0 发射，ACP 有死消费分支                             | 接 emit（compaction 首尾）或删两侧                                                            | 批次 7 顺带     |
| `subagent.finished.verdict`                            | 发射无消费                                           | 批次 3 修                                                                                     | 批次 3          |
| `telemetryService.ts` OTLP 三处 TODO（:513,:550,:580） | 仅 debug 输出，`otlpDoc.test.ts` 反向钉死            | 删 OTLP 分支 + 更新文档测试；或实现 export                                                    | 独立            |
| `hooks/types.ts` 的 `once` 与 4 个未触发事件           | 声明未实现                                           | `once` 在 hookRunner 加状态表实现；未触发事件（TeammateIdle 等）接上或删声明                  | 独立            |
| `plugins/pluginDependencies.test.ts`                   | 有测试无实现（import 指向 pluginInstall 的另一函数） | 实现 DFS 闭包 + 环检测 + 跨市场拒绝（清单第 6 节规格），或删测试                              | 独立            |

---

## 执行顺序与依赖

```
批次1 (webui权限, bug)      ── 立即，独立
批次2 (审批缓存)            ── 次之
批次3 (VERDICT闭环)         ── 与2并行（文件互斥）
批次5 (权限切段)            ── 依赖2（缓存就位才好落ask升级）
批次4 (L1条款)              ── 独立，任意空档插队
批次6 (预算可见)            ── 独立
批次8 清单项                ── 按表穿插
批次7 (merge-patch)         ── 最后（工程量最大，碰stream/ui回调面）
```

批次 7 与 4 都改 systemMessage：串行做，4 在前 7 在后。

## 明确不做（与参考库结论一致）

不引入 ink 分支；不建 AST 代码图/向量库新轮子；不为参数校验引入 zod；
不加第二个缓存断点、不做 1h TTL；不照搬会话格式多版本迁移；
`ide/` 与 GUI 保持停放；不 push 上游。
