# 优化工作日志

本文件记录每一项优化的：做了什么、为什么、依据来源、验证方式。后续会话可直接查阅，避免重新推理或误改。

## 分支 fix/cache-prefix-stability（2026-10-31 起）

### 1. 前缀稳定性修复（commit 71a3a96bd）

**做了什么：**

- `packages/cli/src/agent/systemMessage.ts`：`getGitStatus()`、`isGitRepo()`、`sessionDate()`（新增）全部改为进程级快照（首次调用后 memoize）。
- `packages/cli/src/stream/turnState.ts` + 新文件 `systemPromptSeries.ts`：`TurnState.systemPrompt` 不再每 turn 重置，改为从按 promptCacheKey 键控的会话级注册表借用；带自定义 systemMessage 的委派运行（子代理）用独立条目，避免父子互相污染。
- `packages/cli/src/tools/selection/requestTools.ts:75` 与 `streamChatResponse.ts` 的 contextBudget reminder：改读 `getModelContextLimit(model)`，使 model 级 `contextLength` 配置生效（原先只读 `defaultCompletionOptions.contextLength`，绕过模型级配置）。

**为什么：**

- git status 块的提示词文本承诺"a snapshot in time / will not update during the conversation"，但原实现每轮 `execSync("git status --porcelain")`——每碰一个文件前缀尾部就变字节，缓存整体作废，且契约自相矛盾。
- TurnState 每 turn 重置 `systemPrompt: { updates: [] }`，导致每个新 turn 第一轮 `previous === undefined` → 判定 rewrite → 清空 updates、重发 head、整段重计费；日志里每轮都出现误导性的 "System prompt rewritten, cached tokens rebilled"。
- 上下文窗口旁路导致用户在 config.yaml 配 1M contextLength 时，工具延迟和上下文提醒仍按 200k 默认值计算。

**依据来源（参考实现调研，此前会话结论）：**

- claude-code：git status memoize + 1h TTL 锁会话状态；beta 头 latched。
- opencode：日期/环境作为 DB 持久化条目，只在变化时渲染。
- pi：section-diff 式 system prompt，跨请求保持字节稳定。
- atomcode：CI 强制 wire prefix append-only。

**验证：**

- `npx vitest run src/stream`（212 项）+ `src/agent src/tools`（609 项）全绿。
- `systemPrefixFingerprint.test.ts` 守卫确认静态 spine 四形状 digest 未变。
- 新测试 `systemPromptSeries.test.ts`（4 项）；`turnState.test.ts` 第一条改写为新契约（跨 turn 继承同一 series 对象）。
- tsc --noEmit 通过。

### 2. prune 循环线性化（commit 9b2478324）

**做了什么：** `requestPreparation.ts` 的 `pruneHistoryToContextLimit` 不再每剪一条就 `validateContextLength` 全量重编码（O(n²)）；改为 system 消息、updates、工具列表各算一次，每条消息 token 数算一次，剪一条减一条。

**为什么：** 长 会话下剪枝循环对全历史做 O(n) 次 tokenize，纯浪费。算术保持一致（含 updates 每条 encode+5 的开销；顺带修掉了原实现因 `hasSystemInHistory` 判断把主 system 消息漏计的问题）。

**验证：** `src/stream` 212 项全绿（9 个测试文件的 tokenizer mock 补齐 `countToolDefinitionTokens` / `getModelContextLimit` / `getModelMaxTokens` 导出），tsc 通过。

### 3. undo 栈上限（commit 8ab840b08）

**做了什么：** `ChatHistoryService` 的 `past` 栈上限 20 条（`MAX_UNDO_STEPS`），超出丢最旧；补测试。

**为什么：** 每次 commit 全量浅拷贝历史入栈且无上限，长会话持有 O(提交数) 份全历史副本；20 步也已是用户手速能达到的范围。

**验证：** `ChatHistoryService.test.ts` 35 项全绿，含新增上限测试。

### 4. 插件加载缓存（commit 4ebaf9ec9）

**做了什么：** `loadAllPlugins()` 按 cache roots 的 mtime 指纹 memoize；新增 `invalidatePluginCache()` 供原地修改插件文件后手动失效。

**为什么：** 调用点在每轮关键路径上（systemMessage 的 outputStyle、subagent 名册、hook 表、MCP 声明），原实现每轮重新遍历所有插件目录多次，纯 I/O 浪费。

**依据来源：** claude-code 对 git 状态/上下文的 memoize 模式；TNT 自身 loader.ts 原注释即承认这是启动 + 每轮都会走的代码。

**验证：** loader.test.ts 20 项全绿（含新增"安装后指纹变化自动重载"测试）；src/plugins 全量 136 项全绿；tsc 通过。安装/卸载路径已接入 invalidatePluginCache()（pluginInstall.ts:253、:361）。

### 5. shouldAutoCompact 去 debug 全量 tokenize（commit 72f54865b）

**做了什么：** `compaction/index.ts` 的 "Context usage check" 日志不再为打印 historyTokens 而对全历史跑 `countChatHistoryTokens`。

**为什么：** 该字段对判定无用（决策已用 measured 或 countTotalInputTokens 的结果），每次压缩检查白白重编码全部消息。

**验证：** src/compaction 100 项 + autoCompaction/measuredCompaction 13 项全绿，tsc 通过。

### 6. session meta 冗余重写（commit c2a527deb）

**做了什么：** `session/store.ts` 的 `sync()` 在本次 diff 未产生任何 transcript 记录（`records.length === 0`）时提前返回，不再执行 `buildMeta()`（含一次 statSync）和 `writeMeta()`（temp+rename+chmod 的原子重写）。补测试：无变更的 sync 不改 meta.json 字节与 mtime，`updatedAt` 保持最后一次真实变更的时间。

**为什么：** 勘误——最初分析说"session meta 每次变更全量重写"，实际读码后确认 transcript 本身已是 append-only（appendRecords），真正的浪费点是 meta.json 派生缓存：`saveSession()` 会在一个 turn 内被多次调用（ChatHistoryService 每次 stateChanged、useChat 各钩子），turn 内后几次调用往往零 diff，却仍各付一次 statSync + 原子重写。无变更时缓存本就准确，跳过同时让 `updatedAt` 与 `list()` 排序只反映真实变更。

**依据来源：** claude-code 的不变即不写 memoize 模式（同第 1 项）；store.ts 原注释即声明 meta.json 是 "derived cache for listing"，派生缓存无变化不重写是该契约的自然延伸。

**验证：** src/session + ChatHistoryService + ui/hooks 共 21 文件 193 项全绿（含新增第 12 条测试），tsc 通过。

### 7. headless 懒加载 TUI-only 服务（commit c667c5606）

**做了什么：** `services/index.ts` 的 `initializeServices` 在 headless 模式（`-p`、ACP worker、review worker）只急切加载核心九项（API_CLIENT、AGENT_FILE、CONFIG、MODEL、MCP、TOOL_PERMISSIONS、SYSTEM_MESSAGE、CHAT_HISTORY、HOOKS）；FILE_INDEX、GIT_AI_INTEGRATION、QUIZ、RESOURCE_MONITORING、STORAGE_SYNC 留给首次请求时加载。TUI 保持全量急切初始化。顺带把 `headless` 传给 `updateService.initialize()`（其 `doInitialize(headless?)` 本就支持，用于跳过自动更新网络检查，但一直没接到）。

**为什么：** 逐个查了急切集的成本：FILE_INDEX 启动即全工作区 fdir 爬取（1 秒超时竞速），但唯一消费方是 TUI 的 @ 文件搜索（FileSearchUI/UserInput）；GIT_AI 启动即 `exec("git-ai --version")` 子进程探测，消费方 tools/index.tsx 直接走实例且对未探测状态（null）天然安全；QUIZ/STORAGE_SYNC 无 headless 用途。这些在 headless 下是纯启动延迟。

**依据来源：** pi 的按需初始化（surface 不需要的服务不启动）；claude-code 的 headless 冷启动优先（首 token 延迟优先于后台完备性）。

**验证：** src/services + acp + review + commands 共 77 文件 662 项全绿，tsc 通过。MCP headless 握手语义未动（MCP 在核心九项里，headless 仍等握手并在失败时报错）。

## 待办（按报告优先级）

- P0（已确认就位，无需改）：DeepSeek usage 归一（openai-adapters/util.ts normalizeUsage 已认 `prompt_cache_hit_tokens`，OpenAI.ts 两条路径已接入，有测试）
- P2（已完成）：14 个服务启动期急切初始化——见第 7 项；headless 仍阻塞 MCP 握手（属 `-p` 的语义需求：工具清单要先于首请求确定，故保留）
- /team 专家团 v1（等设计评审）：六个人格进 builtInAgents.ts，Claude Code 的开发能力作为提示词与 agent 循环纪律的主要参考；Codex 的 UI 设计能力、pi 的纯净性为辅。

---

## 记录约定

- 位置固定：`docs/worklogs/`（git 跟踪，跨会话可查；`.md` 不进 docsParity 发布站守卫）。
- 每完成一个优化项并提交后，立即在本文件追加一节：做了什么 / 为什么 / 依据来源 / 验证方式。
- 一天多项工作可用日期命名的独立文件，长期约定类内容（如 /team 设计决策）写在 `.tnt/superpowers/specs/`（2026-10-31 起；此前误写为 `docs/superpowers/specs/`——该目录被 .gitignore 排除且在 docs 站构建的遍历树里，已整体迁移并写入 `.tnt/AGENTS.md` 的硬性约束）。

### 8. /team v1 Task 1：agent 循环纪律规范（commit 229a...，实际 229ca4ba3）

**做了什么：** 新增 `docs/agent-discipline.md`（中文，七节：证据优先、裁决而非
停滞、审查门槛、修复循环上限、派发纪律含 brief 背景契约与 files 声明、"报告
但不修"条款、前缀稳定、结构化收口）+ 派生关系表。

**为什么：** /team 设计第一部分——规范文档是人格提示词的上位依据，先于实现落地。
"报告但不修"条款来自用户点名的 Claude Code 行为差异（同提示词下 Claude Code 会
主动指出邻近 bug），TNT 主提示词第 3 条的范围纪律在主动抑制它。

**依据来源：** spec `.tnt/superpowers/specs/2026-10-31-team-design.md` 第一部分；
内置 verification agent 的 side-effects 条款；dsh writeScopes 的 advisory 语义。

**验证：** `npx prettier --check docs/agent-discipline.md` 通过；纯文档无测试面。

**SDD 说明：** 执行工作区从脚本默认的 `.superpowers/sdd/2026-10-31-team/` 迁移到
`.tnt/superpowers/sdd/2026-10-31-team/`（`.tnt/AGENTS.md` 硬规则：技能建议路径
在 `.tnt/superpowers/` 之外时迁移并记录）。ledger 记录了预检扫描的一项裁决：
Task 4 按"实现注"创建 `defaultTeams.ts`，不创建 dev.md/sec.md。

### 9. /team v1 Task 2：Subagent keyed 并行（commit 134eda278）

**做了什么：** `tools/specs/concurrency.ts` 的 `Subagent` 声明从 `"exclusive"`
改为 keyed claim（`subagentKeys` 读可选的 `files` 路径数组，逐项
`normalizePathKey`）；`subagent/index.ts` 的 SUBAGENT_TOOL_META 参数新增可选
`files: { type: "array", items: { type: "string" } }`（advisory 语义说明写在
参数描述里）。concurrency.test.ts 追加三条测试（keyed/重叠归一/缺失回落）。

**为什么：** /team 合并模型的核心能力——不重叠的子代理文件范围并行执行，重叠
自动串行化（planner 既有 barrier 逻辑）；未声明 `files` 回落全局独占槽，与改动
前行为完全一致（Review Focus 第一条，测试钉死）。preprocess 已原样透传 args，
subagent.ts 无需改动。

**依据来源：** spec 第三部分第 1 条；dsh writeScopes 的 advisory（提示性范围
不是锁）语义；既有 `normalizePathKey` 的规范化（`./src/a.ts` 与 `src/a.ts`
同 shard）。

**验证：** RED（keyed 测试先失败于 exclusive:true）→ GREEN（14/14）；
`npx vitest run src/tools/specs src/stream/toolExecution` 33 项全绿；prettier
通过。npm run lint 报 10 个错误全部位于本次未触碰的文件（systemMessage.ts
504 行、plugins/loader.ts 510 行、requestPreparation/streamChatResponse/
turnState 的 import 排序），属既有欠账，与 base commit 229ca4ba3 一致，非本
任务引入。

**执行事故记录：** Task 2 中途误执行 `git checkout stash@{0} -- .`，把一个
不相关的 TUI 暂存（stash@{0} "tnt-parallel-wip-viewport"）恢复进工作区，覆盖
了未提交的 Task 2 修改并暂存了数百个文件。已完整恢复：reset 索引、checkout
HEAD 还原被覆盖的跟踪文件、删除 stash 引入的未跟踪文件、从备份恢复 worklog
的 Task 1 条目；stash@{0} 本身未被改动。随后重做 Task 2 三处修改并重跑了
RED→GREEN 与回归套件。

### 10. /team v1 Task 3：TeamService 名册加载（commit 见 git log）

**做了什么：** 新增 `packages/cli/src/team/loader.ts`——三层名册（项目
`.tnt/teams/` > 全局 `<continueHome>/teams/` > 默认 TS 常量）合并；`TeamMember`
/`TeamDefinition` 形状（含 `builtInRef` 预留位由 Task 4 使用）；frontmatter 解析
复用 `@tnt/config-yaml` 的 `parseMarkdownRule`（YAML 解析，字段按 untyped record
读取）；mtime 指纹 memoize + `invalidateTeamCache()` 照 plugins/loader.ts
4ebaf9ec9 的模式；无 lead 或多 lead 的团队告警跳过；坏 frontmatter/缺 name 告警
跳过。`services/types.ts` SERVICE_NAMES 加 `TEAM: "team"`。占位
`defaultTeams.ts`（空数组，Task 4 填充）。

**为什么：** /team 设计第二部分。memoize 因加载点在每轮关键路径（派发查询链与
/team 列表）。lead 校验因派发链与领队注入都依赖"恰好一个领队"。

**依据来源：** spec 第二部分（名册格式与三层优先级、taken-set 语义）；
plugins/loader.ts 的逐行扫描与指纹缓存模式；`TNT_GLOBAL_DIR` 为全局目录唯一
override 名（globalDir.ts 注释）。

**验证：** TDD RED（6 条测试在模块不存在时失败）→ GREEN 6/6；
`npx tsc --noEmit` 通过；测试中途发现并修复实现 bug（loadMembersFromDir 多套
一层目录遍历，把成员文件当子目录读——被 "sees a file added after invalidateTeamCache"
测试抓住）。全局层目录布局为 `<TNT_GLOBAL_DIR>/teams/<team>/`（无 `.tnt` 中段，
continueHome 本身即 TNT 目录），测试 fixture 已按此修正。

## 11. 默认专家团（Task 4）

**做了什么：** 新增 `src/team/defaultTeams.ts`，编译进 CLI 的两个默认团队——dev（12 成员：PM 领队 + 需求/架构/实现/测试/审查/UI/文档 8 个自写角色 + debug/shell/explore/best-of-n 4 个内置引用）与 sec（5 成员：security-review 领队内置引用 + 逆向/渗透/验证/shell）。`loadTeams` 把默认团队垫底，用户文件花名册同名覆盖默认。测试 `defaultTeams.test.ts` 钉住花名册名单、每队恰好一个领队、builtInRef 可解析、hacker 提示词含授权边界条款、source/team 标记。

**为什么：** 让全新克隆不配置就有可用的专家团；内置引用（builtInRef）让内置 agent 人格被团队复用而不复制提示词。

**依据：** 计划 Task 4；规格花名册表。计划写"11 成员"是笔误，规格表为 12 个（8 自写 + 4 内置引用），以规格为约束权威，已记入 SDD 台账 Ruling。

**验证：** `npx vitest run src/team` 12/12 通过；`npx eslint src/team/` 无错误；`npx tsc --noEmit` 干净。发现 DEFAULT_TEAMS 非空后 3 个 loader 隔离测试被默认团队污染，为此拆出 `loadFileTeams`（仅文件层）供这些测试使用。

## 12. 派发查询链接线（Task 5）

**做了什么：** `get-agents.ts` 新增 `resolveDispatchableAgent(name, modelState, activeTeam?)`，统一三段查找：ModelService 配置+内置 → 激活团队成员（builtInRef 按内置注册表解析 systemMessage/restriction/deniedTools）→ plugin agent（`plugin:` 前缀查找，默认 no-writes 限制），返回统一 `DispatchableAgent` 形状。`executor.ts` 的 restriction/deniedTools 解析改走它（内置角色的 narrowing 从注册表随身携带，不再二次查找）；list 工具输出追加激活团队成员行，plugin 行改为 `plugin:` 前缀显示（修复"能列出不能派发"缺口——之前列出的是裸名，派发找不到）。会话态：core `Session` 类型与 session store 全链路加 `activeTeam` 标量（与 outputStyle 同形状），`session/index.ts` 暴露 `getSessionActiveTeam`/`setSessionActiveTeam`。

**为什么：** 激活团队后成员要真的可派发，list 输出要即时反映；plugin agent 之前可列出但派发必失败。

**依据：** 计划 Task 5；规格"派发查询链"节。

**验证：** `npx vitest run src/subagent src/tools src/session` 83 文件 678 测试全绿；eslint 我触碰的文件干净；tsc 干净。工具前缀 digest 变化（Subagent schema 加 files 数组）：`e691729a9be4f3a9`/32559 → `e643e3597265f28b`/32838，守卫测试与 ARCHITECTURE-tnt.md changelog 同步更新，成本为每会话一次冷启动。两个既有 executor 测试的 session mock 补 `getSessionActiveTeam` 导出。

## 13. /team 命令（Task 6）

**做了什么：** 新增 `/team` 内置斜杠命令（`handleTeamCommand`）：无参数列出名册及当前激活态，`/team <name>` 激活（写入会话 activeTeam），`/team off` 关闭，`/team create <name> [--from <file>]` 在 `.tnt/teams/<name>/lead.md` 生成领队模板或从文件导入，写后 `invalidateTeamCache()`。注册进 BUILTIN_SLASH_COMMANDS 与 createCommandHandlers，i18n en/zh 成对补齐，中英文档表格各加一行。

**为什么：** 名册加载器与派发链已就位（条目 11/12），需要一个用户入口来列出、激活团队并生成名册脚手架；激活态沿用 outputStyle handler 的会话标量形状。

**依据：** spec「/team 命令」节（list/activate/off/create 四态；create 拒绝已存在路径）；文档守卫 handlerCoverage 与 slashCommandsDoc 要求三处同步。

**验证：** RED：team.test.ts 6 用例先行失败（模块不存在）；GREEN 后 `vitest run src/ui/commands src/slashCommandsDoc.test.ts src/i18n/unusedKeys.test.ts` → 19 文件 116 用例全绿；prettier/eslint/tsc 通过；提交 6a76606ca。

## 14. 领队注入与主提示词条款（Task 7）及两项回归修复

**做了什么：**

- baseSystemMessage 末尾新增"报告但不修"条款：改动触碰的代码里发现无关 bug 时，最终报告用一小节列出位置与一句话影响，不修、不展开；共享路径上的问题仍须修或上报。systemPrefixFingerprint 四个 digest 同步（61314b4e4101cd8e/5269 → cbe14346d198d77f/5547 等），ARCHITECTURE-tnt.md 补 2026-10-31 prefix changelog。
- systemMessage.ts 新增 activeTeamLeadBlock()：会话激活团队时，把领队提示词作为 `<context name="team-lead" source="<team>">` 块追加进 volatile 的 userRules 节；无激活团队时不产生该块，激活/关闭只重刷 userRules，不触碰静态 spine。
- 回归修复一：Task 5 引入了 subagent↔team 环（team/loader 导入 subagent/runContext 的 SubagentRestriction，subagent 又导入 team），architecture.test.ts 守卫红。将类型移到 src/team/restrictions.ts，runContext 重新导出，依赖方向恢复单向。
- 回归修复二：72f54865b 从 shouldAutoCompact 的 "Context usage check" 日志删掉 historyTokens 但没更新 tokenizer.test.ts 的断言，测试红。按新契约（日志只报 measured/local 的 inputTokens）更新测试。

**为什么：** 条款让派发出去的实现者报告而非顺手修无关 bug（Task 1 纪律第 5 节）；领队注入是 /team 激活的最后一块——激活后主 agent 每轮都读得到领队的工作纪律。两个回归是全量回归（vitest run，509 文件）暴露的既有欠账，不修不能收口。

**依据：** spec「领队注入」节（userRules 汇入、volatile、latch）；systemPrefixFingerprint 守卫要求 digest 与架构文档同步；architecture.test.ts 模块依赖方向守卫。

**验证：** RED：条款断言与 teamInjection 4 用例先行失败；GREEN：src/agent 116 用例全绿；全量 `npx vitest run` → 4040 passed / 0 failed（修复前 2 failed）；tsc/eslint/prettier 通过。提交：4c9db393e（条款）、579e0d866（注入）、1e329ed41（依赖环）、48b1f6fa1（tokenizer 日志断言）。

## 15. 目标开发流程规范（goal-PRD 设计交付顺序第 1 步）

**做了什么：** docs/agent-discipline.md 新增第 8 节"目标开发流程"，九小节：goal 对齐、召集判定（双入口 + 可观察信号 + autoConvoke 默认 false）、PRD 契约（九节结构、验收标准可判定性、变更必有记录）、pre-mortem 纪律、迭代闭环规则、收口格式与六状态词汇表（progress/waiting/ready/blocked/failed/dropped，含 blocked/dropped 边界纪律与 PM/verification/主 agent 三类收口格式）、主代理受理纪律与注意力经济（四条转呈纪律）、确定性状态判定（证据优先、五条件自上而下首条命中表、非法迁移拒绝）、流程与外部规划插件裁决。派生关系表同步：PM/requirements-analyst/tester/code-reviewer/verification 增列第 8 节，主 agent 行由"领队注入段"改为"受理纪律注入段"。

**为什么：** 设计规格要求规范先行——第 2-7 交付步（goal 注入、PM 提示词升级、受理注入、召集开关、闭环测试、i18n）的角色提示词与状态机全部从第 8 节派生，先落规范再接线。

**依据：** `.tnt/superpowers/specs/2026-11-01-goal-prd-flow-design.md` 第五部分（九小节清单）与第三部分第 6、7、8 点；dsh-superagent-prototype 的状态词汇表与注意力经济结论已按附录裁决合并进 8.6/8.7。

**验证：** 文档改动，无代码路径；prettier 经 lint-staged 通过；提交 095510cdf。

## 16. goal 对齐行注入（goal-PRD 设计交付顺序第 2 步）

**做了什么：** systemMessage.ts 新增 goalAlignmentBlock()：会话设有 goal 时，userRules volatile 节在 team-lead 块之前追加 `<context name="goal-align">` 块，内容为 i18n 的 `agent.goalAlignmentLine`（en/zh 成对：目标原文 + 对齐/越界先确认两条指令）。无 goal 时块不产生，userRules 节与现状逐字节一致；goal 增删改只重刷 userRules 节，静态 spine 不动。新增 systemMessage.goalAlignment.test.ts 五用例：无 goal 形状不变、有 goal 无团队仅对齐行、激活团队时对齐行与受理内容并存、/goal clear 下一 turn 消失、同 goal 两次构建文本一致（volatile latch）。

**为什么：** 设计的通用层：goal 是会话级锚点，现状下 goal 无任何消费者；这是"主 agent 干活时对 goal 对齐与自检"的落地，未激活团队也生效。

**依据：** spec 第三部分第 1 点（userRules volatile 节 goal 分行、独立成行）与第四部分层次一文本；交付顺序第 2 步。

**验证：** RED：新用例 2 个先行失败（无 goal-align 块）；GREEN：src/agent 三套件 14 用例、src/i18n 19 用例全绿，systemPrefixFingerprint 四 digest 不变，tsc 干净。提交 291aff647。

## 17. PM 与需求分析提示词升级到 PRD 契约（goal-PRD 设计交付顺序第 3 步）

**做了什么：** defaultTeams.ts 的 PM_PROMPT 从"领队：拆解、派 brief"改为"管理者：产出 PRD、跑 pre-mortem、写迭代计划、裁决迭代结果、更新 PRD 状态"：九节 PRD 结构与 .tnt/prd/ 位置、验收标准可判定性（PRD ≠ 功能清单）、变更必有记录（PRD ≠ 一次性文档）、pre-mortem 三项式风险条目、迭代闭环最小单位、五条件确定性状态机（8.8 的表格文字化）、六状态收口词汇与 PM 收口格式、dropped 静默关闭但写变更记录、verification 判定行机械转写契约。REQUIREMENTS_PROMPT 对齐 PRD 契约：素材供 PM、验收标准直接进 PRD、补非功能需求与 MoSCoW。TESTER_PROMPT 收口格式改为六状态首行 + 按条目编号引用。PM 成员描述同步，不再自称领队。派发职责未写入 PM 提示词（派发权在主 agent）。

**为什么：** 设计对 Task 7 原设计的修订：主 agent 是受理臂不戴 PM 帽，PM 是产出书面计划的团队子代理；PRD 是团队共享状态板，PM 提示词是它的写入方契约。

**依据：** spec 第一部分（流程总览与 Task 7 修订）、第二部分（PRD 九节格式）、第三部分第 3-6、8 点；docs/agent-discipline.md 第 8 节（上一条目落地的规范）。

**验证：** RED：defaultTeams.test.ts 新增四用例先行失败（PM 无 PRD/pre-mortem/九节、收口无六状态词）；GREEN 后 src/team 两套件 19 用例、src/subagent 九套件 72 用例全绿，tsc 干净。提交 78cc84823。
