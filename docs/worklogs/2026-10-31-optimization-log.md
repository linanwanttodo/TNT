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

## 18. 受理纪律注入替换领队注入（goal-PRD 设计交付顺序第 4 步）

**做了什么：** systemMessage.ts 的 activeTeamLeadBlock() 改产出 `<context name="team-reception" source="<team>">` 块，内容为 i18n `agent.receptionistDiscipline`（en/zh 成对，源自设计第四部分层次二：受理/转派 PM/按计划派发/转呈求助，不自行规划，不处理流程外请求，PRD 唯一事实来源，注意力纪律，goal 未设流程不启动）。领队提示词不再注入主 agent——它经派发链流向团队子代理；builtInRef 解析逻辑随之移除（builtInAgentByName 导入不再需要）。teamInjection 测试更新为受理契约：块出现/消失、getTeam 解析、builtInRef 团队同样产出受理块、受理块在 goal-align 块之后、领队提示词文本不在主 agent 提示里。userRules 全是 volatile 内容，systemPrefixFingerprint 四 digest 不变、ARCHITECTURE-tnt.md 无需同步。

**为什么：** 设计修订 Task 7：主 agent 兼任领队会把两种身份混进一个上下文；激活态注入的是"老板代理"的受理纪律，PM 才是管理者。

**依据：** spec 第三部分第 3 点（受理纪律注入修订 Task 7）、第四部分层次二全文；交付顺序第 4 步（fingerprint 仅在 base 被触碰时同步——本次未触碰）。

**验证：** RED：新受理契约用例 2 个先行失败（无 team-reception 块）；旧领队注入断言按设计更新。GREEN：src/agent 124 用例、src/team 19 用例、src/i18n 19 用例全绿；systemPrefixFingerprint 不变；tsc 干净。提交 700c36c90。

## 19. 召集偏好开关与 /team 转呈语义（goal-PRD 设计交付顺序第 5 步）

**做了什么：** settingsFiles.ts 新增 readSettingsBoolean()：与字符串读取器同优先级规则（六文件自低到高，后写覆盖），只有 JSON true/false 计数——"true" 字符串与数字 1 不猜测转换，未设置返回 undefined。ui/commands/handlers/team.ts 的激活输出追加 goal 语义：未设 goal 时附加 team.goalMissing（显式提示先 /goal，流程不静默启动；激活态本身照常写入，等待目标）；已设 goal 时附加 team.goalActive（引用目标原文 + 注意力转呈说明）。i18n en/zh 成对。对话发起的召集判定条款与 team.autoConvoke 的自动召集语义已编译进 agent-discipline.md 8.2（前置条目 15）与受理纪律注入文本（前置条目 18），偏好键名采用 `team.autoConvoke`（默认 false——读取器返回 undefined 时调用方按关闭处理）。

**为什么：** 设计要求双入口：显式命令路径上"未设 goal → 明确报错不静默"是硬要求；偏好开关是"大目标自动召集"（C 方案）的数据面，默认 false 是反目标守卫（未开启时主 agent 不自动进流程）。

**依据：** spec 第三部分第 2 点（召集判定双入口 + 偏好开关）、第五部分 8.2；交付顺序第 5 步。

**验证：** RED：settingsFiles 布尔读取器 4 用例、team 命令 goal 语义 2 用例先行失败；GREEN 后 12 + 8 用例、src/i18n 19 用例、slashCommandsDoc 守卫 4 用例全绿，tsc 干净。提交 d08049ec5。

## 20. 收口词汇表与确定性 PRD 状态机（goal-PRD 设计交付顺序第 6 步）

**做了什么：** 新增 src/team/closure.ts（CLOSURE_STATUSES 六状态、closureStatusOf 首行状态词识别——中英文状态词均合法，状态词埋在正文不算收口、requiresChangeRecord 仅 dropped 需变更记录）与 src/team/prdState.ts（PrdEvidence 五类证据、STATE_TABLE 五行自上而下首条命中、prdStatusOf 机械推导、ILLEGAL_TRANSITIONS 已验收→待开发必须走变更记录）。关键裁决落在表内：未通过行要求判定之后没有新的 dispatch/tester/code-reviewer 证据——"未通过回开发中必须指向新派发记录"作为首条命中的一部分机械成立；已验收行取最后一条 verification 判定为 PASS。新代码放 src/team/ 新文件，未触碰 500 行豁免清单。

**为什么：** 设计的状态判定是测试口径："给定收口证据序列，状态字段可机械推出；implementer 声称完成而无 tester/verification 证据时不得推进到已实现"。

**依据：** spec 第三部分第 6、8 点；docs/agent-discipline.md 8.6/8.8；交付顺序第 6 步。

**验证：** RED：两套件因模块缺失收集失败、随后 1 用例红（未通过回开发生的循环回接语义）；GREEN 后 src/team 34 用例全绿，tsc 干净。提交 5102c900c。

## 21. 子代理生命周期事件接入 agent 事件总线（goal-PRD 设计交付顺序第 7 步）

**做了什么：** protocol/events.ts 的 AgentEvent 联合类型新增三个 add-only 变体：subagent.started {agentName, prompt}、subagent.reported {agentName, content}、subagent.finished {agentName, content, success, verdict?}。subagent/executor.ts 新增函数级 emit()：publishAgentEvent 封套 {sessionId: 父会话 id, turnId: 子代理类型名, seq: 本生命周期内单调递增, timestamp}；childContext 建立后发 started，fireSubagentStop 后依次发 reported（response 全文）与 finished（success: true，parseVerdict 命中时带 verdict）；catch 块仅在生命周期已开始（nextSeq > 0）时发 finished {success: false, content: error.message}——模型解析失败等 started 之前的中途失败不发事件。事件进 agent 事件总线，webui 的 SSE 转发通道自动获得，WebUiService.ts 与 handlers/webui.ts 零改动。新增 executor.events.test.ts 两用例：成功路径 started/reported/finished 顺序与父会话封套、失败路径 finished success: false。

**为什么：** 目标-PRD 流程的最后一根管道：前端（webui）需要在不进入主会话转写的情况下观察子代理派发、上报与收口；事件走既有总线而非新通道，保持"一个引擎、四个面"的输出词汇表统一。

**依据：** `.tnt/superpowers/specs/2026-11-01-goal-prd-flow-design.md` 交付顺序第 7 步与事件契约（agentName + content 字段、既有封套形状）；AgentEventInput 分布式 Omit 类型复用 events.ts 既有定义。

**验证：** RED：executor.events.test.ts 两用例先行失败（事件联合类型无变体、无事件发出）；GREEN 后 src/subagent + src/protocol + src/session 189 用例全绿，tsc 干净，prettier 经 lint-staged 通过。提交 5286218bc。

## 22. lint 门错误清理与 autoConvoke 生产接线（goal-PRD 收尾）

**做了什么：** 两步。第一步清 CI lint 门错误：executor.ts 生命周期封套变量 agentType 改 const（emit 只读不改写）；systemMessage.ts 的 buildSystemMessageSections 语句数 51 超上限 50，把规则收集前半段（agent 文件层、--rule 处理、yaml 规则、markdown 规则去重）抽为独立函数 collectRuleMaterial()，主函数降到上限内，纯移动不改行为。第二步补 autoConvoke 的生产消费线：readSettingsBoolean("team.autoConvoke") 此前只有实现与测试、无任何调用方（死设置）——systemMessage.ts 新增 autoConvokeBlock()（开关为 true 时产出 `<context name="team-convoke">` 块，内容为 i18n `agent.autoConvoke` en/zh 成对：召集信号三条件、召集后转呈告知一次、小活不召集；false/未设置块不存在，反目标守卫），接入 userRules 组装（goal-align 之后、team-reception 之前）。goalAlignment 测试新增 3 用例。

**为什么：** lint 门是 CI 硬约束（51 条语句会挂 cli-pr-checks）；autoConvoke 是交付顺序第 5 步的一半——设置面有了，注入面缺失意味着"开启后自动召集"对主 agent 完全不可见，等于功能没实现。

**依据：** spec 第三部分第 2 点（偏好开关开启后主 agent 对含召集信号的大目标自动进入流程）、第五部分 8.2 召集信号清单（多子任务拆解/多角色协作/用户点名）；设计第四部分"两个层次都是动态内容（volatile 节）"——convoke 块同样只进 volatile userRules。

**验证：** RED：convoke 开启用例先行失败（userRules 无 team-convoke 块；fixture 初版写错 .tntrc.json 路径，改 .tnt/settings.json 后按预期红）。GREEN：goalAlignment 8 用例、src/agent + src/team + settingsFiles + team handler + executor.events 共 175 用例全绿，tsc 干净，eslint 两个文件零错误。systemPrefixFingerprint 四 digest 不变（userRules 全 volatile）。提交 81dbcd4eb、f2f9aab50。

## 23. 命令文档守卫修复：/loop 与 /ide（2026-11-07）

**做了什么：** `docs/cli/slash-commands.mdx` 与 `docs/zh/cli/slash-commands.mdx` 的「能力」表补 `/loop`（`every 20 minutes <prompt>`、cron 表达式、`off`）、`/mcp` 后补 `/ide`（`/ide`、`/ide connect jetbrains`、`/ide tools <server>`、`/ide diagnostics <file>`），中英成对。

**为什么：** `slashCommandsDoc.test.ts` 在 HEAD 上是红的：`/loop` 早已完整实现（automation registry + scheduler，`handlers/loop.ts`）却从未进文档表；补完 `/loop` 后 `assert` 立刻报出下一个缺失项 `/ide`（同样已实现且有 handler）。这个守卫是双向的，红一次只报一个名字，所以要修到它闭嘴才算完。

**依据：** `.tnt/AGENTS.md` 的守卫文化（加命令必须同步 en/zh 文档表）；`handlerCoverage.test.ts` 已确认两条命令都有 handler。

**验证：** `npx vitest run src/slashCommandsDoc.test.ts src/ui/commands/handlerCoverage.test.ts` → 7 用例全绿；`npx prettier --check` 两文件通过。

## 24. lint 门清零（2026-11-07）

**做了什么：** 先 `npx eslint "src/**/*.{ts,tsx}" --fix` 清掉 96 个 `import/order`，再把 7 个不可自动修的结构性问题逐个真修：

- `automationStore.ts`：`nextRunFromCron` 的 hour×minute 双循环抽成 `firstStampOnDay()`（max-depth 5/6 → 3）；`createAutomation` 的 if/else 链抽成 `resolveSchedule()`，用提前返回替代"每层都判断字段缺席"的否定条件（no-negated-condition）。
- `modelConfigStore.ts`：`updateDeclaredModel` 复杂度 38 拆成 `validateModelPatch()` + `applyModelPatch()`，主函数只留查找、校验调用、写入。
- `ide.ts`：两处 `!== null` / `!== undefined` 条件反转成正向形式（no-negated-condition）。
- `webuiRoutes.ts` 839 行：按域拆成 4 个注册模块——`webuiRoutes.sessions.ts`（/sessions 与 /session/_）、`webuiRoutes.models.ts`（/models_ 与 /model）、`webuiRoutes.automations.ts`（/automations* 与 /team），主文件只留注册顺序与引擎路由（现 ~500 行内）。拆分是纯移动，路由表与响应形状逐字节保持。
- `MCPService.ts` 520 行：模块级 `getPluginMcpServers()` / `warnLegacyMcpConfigOnce()` 移到新文件 `mcpPluginServers.ts`；未解析密钥的提示构造移进 `mcpUtils.ts` 的 `unresolvedSecretNames` / `unresolvedSecretsMessage` / `unresolvedSecretsWarning`，`connectServer` 收敛为一次调用。

**为什么：** `npm run lint` 是 CI 硬门（cli-pr-checks），HEAD 上 103 个错误让它必红。拆 `webuiRoutes` 同时解决后续要改 `/message` 时"再往 839 行的文件里加东西"的问题；`updateDeclaredModel` 与 `resolveSchedule` 的拆分让两处最容易看错的字段校验各自成段。

**依据：** `eslint.config.js` 的 500 行 / complexity 30 / max-depth 4 限制与它自己写明的豁免清单语义（预先存在的热点才豁免，不新增）；`AGENTS.md`「a change is not done until tsc/vitest/prettier all pass」。

**验证：** `npx eslint "src/**/*.{ts,tsx}"` 零错误零警告；`npx tsc --noEmit` 干净；`npx vitest run src/services src/commands/serve.helpers.test.ts` 49 文件 534 用例通过（其中 WebUiService 一例因并行跑测试时端口 24500 被占而 EADDRINUSE，单跑 52/52 全绿——环境问题，非回归）。

## 25. 删除 /config 化石（2026-11-07）

**做了什么：** 整体移除"配置选择器"这条路径：`ui/ConfigSelector.tsx`、`ui/hooks/useConfigSelector.ts` 两文件删除；`NavigationScreen` 去掉 `"config"`、`SCREENS` 去掉对应条目；`useSelectors` 不再接收 `configPath`、不再返回 `handleConfigSelect`；`TUIChat` / `Composer` / `ScreenContent` / `useChat` / `useChat.types` 的整条 prop 链清理；`SlashCommandResult.openConfigSelector` 字段删除；`handleConfigCommand` 与 `handleSpecialCommands` 里的 `/config` 特例删除；i18n `config.loading|select|local|loadFailed` 4 组键（en/zh）与选择器测试用例删除；`docs/cli/configuration.mdx`（en/zh）那句话改成 `--config <path>` 的真实用法。

**为什么：** 选择器只 `push` 一项（`~/.tnt/config.yaml` 存在时），`type: "local" | "assistant" | "create"` 里的后两者是上游 hub 时代遗留、在此 fork 中不可达。选中后唯一动作是 `services.config.updateConfigPath(默认路径)` + 清空会话历史。多配置的真实入口是 `--config`（`src/index.ts:198`）。一个只有一行的选择器不值得占一个命令名，文档又一直在描述它——删除比"补登记"诚实。

**依据：** 用户裁决（三选一选"删掉化石"）；`docs/cli/configuration.mdx` 自己写的「published assistant slug is refused at startup」，即 hub 语义已废。

**验证：** `npx tsc --noEmit` 干净；`npx eslint "src/**/*.{ts,tsx}"` 干净；`npx vitest run src/ui/context/NavigationContext.test.tsx src/ui/CtrlC.test.tsx src/ui/hooks/useChat.clear.test.ts src/ui/hooks/useChat.subagent.test.ts` 31 用例全绿（导航测试里的 `"config"` 屏幕用例改用 `"jobs"`/`"model"`，避免同一屏幕自比）。全仓 grep `ConfigSelector|openConfigSelector|handleConfigSelect|cmd.config` 零残留。

## 26. 斜杠命令下沉：headless 与 WebUI 共用一个分发（2026-11-07）

**做了什么：** 新增 `commands/slashCommandResult.ts` 的 `classifySlashResult()`——把 `SlashCommandResult` 归成 prompt / print / compact / clear / exit / unsupported 六种"下一件事"，`newInput` 优先于 `output`（提示词来源交的是要发的文本，不是要显示的文本）。三处消费：

- **headless**（`commands/chat.ts`）：原来只认 `/compact` 一行，其余斜杠命令被当普通文本发给模型。改为先 `handleSlashCommands()`，再按分类结果动作：print 走 `finalText`（沿用既有 json/text 输出格式）、prompt 替换后续 userInput、compact 复用压缩、clear 调 `services.chatHistory.clear()`、exit 返回告别文案、picker 类返回 `chat.commandNeedsTui` 提示。
- **WebUI**（`services/webuiSlashMessage.ts` 新模块 + `POST /message` 接线）：print 落进 transcript（`addSystemMessage`）+ `session.changed` 让各标签页重载；prompt 替换入队文本；clear/compact 直接作用于服务并广播；exit 与 picker 类发 `notice` 事件而不是丢给模型。
- **手动压缩核心**（`compaction/manual.ts` 新模块）：`compactHistoryOnce(history, model, llmApi, commit)` 抽出压缩本体，打印留给调用方；`commands/chat.ts` 的 `handleManualCompaction` 与 WebUI 压缩都走它，避免第二份实现。

**为什么：** 审计发现的"A 引擎四面"不一致：`handleSlashCommands` 此前唯一调用点是 `ui/hooks/useChat.ts`，于是 `tnt -p "/help"` 和浏览器里输入 `/team` 都会被当成提示词送给模型。要么把命令能力下沉，要么在文档里承认只有 TUI 支持——选了前者，因为 headless/浏览器能用的那部分（列表类、技能类、压缩、清空）本来就不需要界面。

**依据：** 审计结论第 2、3 条；`SlashCommandResult` 的既有字段语义（`newInput`/`output`/`compact`/`clear` 都是引擎侧可完成的动作）；`AGENTS.md` 的"one engine, four surfaces"。

**验证：** 新增 `commands/slashCommandResult.test.ts`（6 用例：分类优先级、空 output 不算可打印、picker 归 unsupported）与 `services/webuiSlashMessage.test.ts`（8 用例：普通文本直通、非命令斜杠文本直通、print 落 transcript、prompt 改写、clear+sessionChanged、picker 报错不发给模型、无模型时压缩不抛、无 assistant 时跳过分发）全绿；`npx tsc --noEmit` 干净；`npx eslint` 干净。

## 27. cacheHitGuard 接入遥测（2026-11-07）

**做了什么：** `stream/usageTelemetry.ts` 增加按 `promptCacheKey` 维护的尾部命中率环（长度 `CACHE_HIT_TAIL_ROUNDS`）与"已告警"集合：每轮非压缩请求在 provider 确实报了缓存活动（`cacheRead > 0 || cacheWrite > 0`）时记录 `cacheRead / reportedInput`；尾部均值低于 `cacheHitFloor()` 时 `logger.warn("Cache hit rate below floor", …)` 一次，恢复后清除标记以便下次再报；压缩轮清空基线（同 `forgetCacheRound`）。

**为什么：** `cache/cacheHitGuard.ts` 此前零生产调用方——`TNT_CACHE_HIT_FLOOR` 是个没有任何运行期行为的死设置。审计把它列为空壳（第 10 条）。接进遥测是它本来的用途：判定"尾部是否根本不再读缓存"，与已有的单轮 break 检测（`assessCacheBreak`）互补——后者问"这一轮掉了没有"，前者问"尾部整体还达不达标"。

**依据：** `cacheHitGuard.ts` 自身注释（"the last rounds are the ones a session pays for again and again"、"undefined is not a pass"）；既有 `assessCacheBreak` 的"provider 不报缓存就不评判"原则，此处沿用同一豁免。

**验证：** 新增 `stream/usageTelemetry.cacheFloor.test.ts` 4 用例：尾部低命中只告警一次、健康尾部不告警、冷启动一輪不拖累尾部判定、provider 不报缓存则完全评判；与既有 `usageTelemetry.cacheRound.test.ts` 合计 6 用例全绿；tsc/eslint 干净。

## 28. closure/prdState 标注规格态（对第 20 条条目的勘误及第 10 条同类的第 7 条）

**做了什么：** `team/closure.ts` 与 `team/prdState.ts` 的文件头各加一段 SPEC-ONLY 说明：词汇表与状态机是可执行且有测试的**规格**，运行期没有任何调用方，PRD 没有存储，因此不派发状态；并写明"接线必须是有意为之——本模块决定一次团队运行如何收口，接入会改变行为而不只是格式"。

**为什么：** 审计第 8、9 条：两个模块只有 `*.test.ts` 引用，零生产消费方，而第 20 条 worklog 把它们记成"交付顺序第 6 步完成"。在"接线至真实消费方"与"明确标为规格态并降级"之间选后者：树上没有 PRD 存储，也没有证据采集方，硬接等于用不存在的证据推导状态，是伪接线。诚实标注 + 记录勘误，等 PRD 读取器落地时再按表实现。

**依据：** 审计结论第 8、9 条；第 20 条条目原文（"状态判定是测试口径"，本来只承诺机械可推导，没承诺有消费方）。

**验证：** 纯注释改动；`npx tsc --noEmit` 干净；`npx vitest run src/team` 全绿（含两模块既有用例）。

## 29. 删除 SquadView 死代码（2026-11-07）

**做了什么：** 删除 `webui/src/ui/chat/SquadView.tsx` 与其 `SquadView.module.css`。它由 `ApprovalsPanel` + `SubagentsPanel` + `answerApproval` 组成，全 `webui/src` 无任何引用；`App.tsx` 的 `squad` 标签页渲染的是 `SubagentDirectoryPane`（更强：可点进活跃子代理标签页），而审批与子代理面板本来就在右侧 rail 中。

**为什么：** 审计第 5 条。同一个"agents"视图有两份实现，其中一份是死的——留着的代价是下一个人以为它是入口，改错地方。

**依据：** `ChatViewTabs` 的 `ChatViewId = "chat" | "trajectory" | "context" | "squad"` 与 `App.tsx:434` 的实际渲染分支对比。

**验证：** webui `npx tsc --noEmit` 干净；webui `npx vitest run` 15 文件 114 用例全绿；grep `SquadView` 零残留。

## 30. 消息链修复：hook 注入截断、转录只显示用户原文、无模型显式报错（2026-11-07）

**做了什么：** 三处。

- `hooks/fireHook.ts`：新增 `capHookContext()`（4 000 字符预算 + 截断标记，标记告知模型完整文档可用 Skills 工具按需读取），`SessionStart` 与 `UserPromptSubmit` 的 `additionalContext` 统一过预算。此前 superpowers 的 SessionStart hook 把整份 SKILL.md 作为上下文注入，TNT 原样转发。
- `ui/hooks/useChat.ts`：`processMessage` 在拼合 hook 注记前保留用户原文 `userText`，两个 `formatMessageWithFiles` 调用点与两个队列提示条都改传原文；`MemoizedMessage` 渲染用户消息时优先 `item.userText`，`splitServedPrompt` 标记拆分作为存量记录的回退。转录从此显示用户打的那句话，注记只随请求进模型。
- `ui/hooks/useChat.ts`：`processMessage` 入口增加无模型守卫——`!model || !llmApi` 时向转录写入 `chat.noModelConfigured` 系统消息并返回，不再静默吞掉。

**为什么：** 用户实测 v1.1.2：发 "hi" 后无任何回复，转录里整段 superpowers 提醒原样可见。逐段对照参考实现（pi 的系统提示分节、codex 的 ContextualUserFragment + 约 1k token 截断、atomcode 的合成 user 提醒 UI 隐藏、ZCode 的 uiVisibility/transcriptVisibility 三态 + 24k 截断）后确认 TNT 三处违背：hook 上下文无预算全量转发、注记拼进用户消息且显示层未接 `userText`（机制在 `formatMessageWithFiles` 里已设计但调用点没传）、无模型时静默无响应（会话记录 0 条 assistant、usage 全 0，`~/.tnt/config.yaml` 被重写为 `models: 0` 后 TUI 毫无提示）。

**依据：** 参考实现四家一致的"隐藏 provider 可见上下文 + 预算截断 + 技能惰性加载"模式；TNT 既有 `userText` 设计注释（"surfaces render userText so the terminal matches the webui"）——本条目是把已设计未接线的机制接完。

**验证：** `fireHook.cap.test.ts` 3 用例（短文本不动、整份手册被截断并带指引、截断点在预算内）；src/hooks + 消息渲染相关 17 文件 126 用例全绿；`tsc --noEmit` 与 eslint 干净；headless 在无模型时维持响亮的显式报错。技能惰性加载本身 TNT 已有（Skills 工具 + 技能斜杠命令），泄漏源是 hook 上下文处理而非技能系统。

## 31. 添加模型接线：/model 复用首装配置界面，多模型 + 200k 默认上下文（2026-11-07）

**做了什么：**

- `/model`（`ModelSelector`）末尾常驻"添加模型…"条目，空配置时它也是唯一条目（此前零模型只显示 `models.none` 就死路）；选中后跳到新的 `addModel` 导航屏幕。
- 该屏幕**直接复用首装引导界面** `ProviderSetupScreen`：协议 → 地址 → 密钥 → 模型 ID。为嵌入主 TUI 增加 `standalone` 开关——独立引导时 `exit()` 卸载自己的 Ink 应用，嵌入时只走导航卸载，不再冒掉主应用的风险。
- 模型 ID 输入支持**空格分隔批量添加**：`buildConfigYaml` 与新的 `applyProviderSetup()`（services/modelCatalog.ts）都按 `/\s+/` 拆分，每个 ID 生成一条 `models` 条目，共享同一 provider/apiBase/apiKey。
- 新条目默认写入 `contextLength: 200000`（`DEFAULT_CONTEXT_LENGTH`），可在 `config.yaml` 里逐条改。
- `/model` 的添加流程走 `addDeclaredModel` → 校验、写盘、重载模型服务，然后 `switchChatModel` 切到第一个新模型：从零到可用对话不离开终端。

**为什么：** 审计发现 `/model` 只能选不能加——`addDeclaredModel` 的唯一调用方是 WebUI 的 `POST /models`，TUI 用户没有任何添加模型的路径；配合已修复的"无模型显式报错"，用户会被明确告知没模型却没有地方加，等于死循环。用户裁决：复用首装界面、空格分隔多模型、默认 200k。

**依据：** 用户指令（复用首装配置界面 / 空格分隔 / 200k 可在文件里改）；`ProviderSetupScreen` 既有四步流程与 `buildConfigYaml` 的单模型实现。

**验证：** `tsc --noEmit` 干净；src/config/providerSetup、src/startup（含 onboarding 11 用例）、src/ui/ModelSelector、i18n 守卫共 12 文件 70 用例全绿；`npm run build` 打包通过。
