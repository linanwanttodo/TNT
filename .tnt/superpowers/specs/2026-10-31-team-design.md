# /team 专家团 v1 设计

日期：2026-10-31
状态：待评审
分支基线：fix/cache-prefix-stability（f2a4e74db）

## 调研依据（本设计的事实来源，均已核实）

- **TNT 现状**：`subagent/builtInAgents.ts` 已有 8 个内置角色（verification、explore、
  debug、security-review、shell、ci-investigator、browser、best-of-n），经
  `ModelService.getSubagentModels` 注册（配置的 subagent 模型优先，同名内置让位），
  `executor.ts` 按 name 解析 restriction/deniedTools，派发深度默认 1。
  `commands/` 下无 /team。**缺口**：plugin agent（loader.ts loadPluginAgents，名字
  `plugin:file`）只进入 list 工具的输出（tools/subagent.ts:161），`getSubagent` 只查
  ModelService——**插件 agent 能列出、不能派发**。
- **命令注册路径**（已核实）：`ui/commands/builtins.ts` 的 `BUILTIN_SLASH_COMMANDS`
  （i18n descriptionKey）+ `ui/commands/handlers/*.ts` + `i18n/index.ts` 单文件 en/zh
  双语言块；守卫 slashCommandsDoc.test.ts（docs/cli 与 docs/zh/cli 双语表）、
  unusedKeys.test.ts、handlerCoverage.test.ts。会话内运行时状态切换有 outputStyle
  handler 先例。
- **领队注入通道**（已核实）：`--rule`/config/markdown rules 全部汇入 system prompt 的
  `userRules` 分节（固定 marker `<context name="userRules">`），分节机制本就为
  "变化可归因到节"设计（systemMessage.ts sections 注释）。激活团队注入领队提示词 =
  userRules 节一次性追加并 latch，与 planMode/promptProfile 的 volatile 语义同构；
  前缀指纹守卫 `agent/systemPrefixFingerprint.test.ts` 验证节形状不变。
- **zcode 参考**（test-continue/zcode/apps/zcode-cli/docs/design/v2/）：
  `tool/07-subagent.md` 明确划线——agent team（teammate spawn，`team_name`+`name`，
  带 SendMessage mailbox、禁止嵌套 spawn）是**独立于普通 subagent 的分支**，不应混为
  一个概念；v1 因此采用"领队派发 + 汇总"的普通 subagent 形态，mailbox/team-swarm
  留给 v2。`expert-workflow.md` 的 WorkflowDefinition（definitionId/phaseOrder/
  strategy/graph scheduler/artifact）是 /team v2 工作流层的模板，v1 不引入。
- **claude-code 参考**：agent 定义 = frontmatter（name/description/tools/model）+
  正文提示词的 markdown 文件（.claude/agents/ 生态），TNT 的 plugin agent 已采用同形；
  开发纪律（ruling-not-stall、review gate、fix-loop cap、brief 写法、结构化 verdict）
  是全角色提示词的提炼来源。

## 意图与动机

TNT 目前的能力模型是"一个主 agent + 可派发的内置专家"（subagent 工具），但专家与
团队是两套割裂的概念：subagent 工具能派发 8 个内置角色，/team 则另起炉灶。v1 把
两者合并为**一个模型**：

- **专家团就是子代理名册**。人格（persona）只是 agent 定义；主 agent 用 Subagent
  工具派发，可以一次派一个或多个（不同人格或同人格多实例）。
- **主 agent 自己决定并行还是串行**。派发时声明每个代理会涉及的文件范围
  （advisory write scopes）：范围不重叠（不同文件、不同模块）→ 并行执行；范围
  重叠（可能互相污染的文件、同一模块）→ 串行执行。判定权在主 agent 的规划里，
  执行层的串行化由既有并发规划器完成。
- 串行的"流程专家团"（zcode /workflow 式的阶段管线）不需要新引擎：主 agent 按
  依赖顺序逐轮派发即得。v2 再引入声明式 WorkflowDefinition（zcode
  expert-workflow.md 的 phaseOrder/graph scheduler 形状）把常见管线固化。
- 全流程角色开箱即用：需求分析、架构、实现、测试、审查、文档、项目管理，加上逆向
  工程与（授权范围内的）渗透测试两个特殊角色。
- 用户可用 `/team create` 定义自己的团队与人格。
- Claude Code 的开发能力（结构化输出、ruling-not-stall、review gate、fix-loop 上限、
  工具纪律）是全部提示词与 agent 循环纪律的主要参考；Codex 的 UI 设计能力、pi 的
  纯净性为辅。

## 调研补充（并行模型的事实依据，均已核实）

- TNT 并发规划器（`tools/specs/planner.ts` + `concurrency.ts`）已实现 keyed claim
  - barrier 语义：同一批次中 keyed 不重叠的调用进入同一步并行执行，keyed 重叠或
    exclusive 的调用构成 barrier 步，串行执行且与前面互斥。文件写工具已按路径 claim。
- **`Subagent: "exclusive"`（concurrency.ts:177）是当前唯一的串行化原因**——子代理
  被硬编码到全局独占槽，多代理并行从未开启。
- dsh agent-team（docs/subsystems/agent-team.md）的 `writeScopes` 是"规范化的提示性
  路径前缀，不是锁"，重叠时给出 warning 而非拒绝——TNT 的 keyed claim 是同一思想
  的执行层形态，本设计取执行层形态（claim 即串行化），告警随 planner 既有行为。
- zcode `07-subagent.md` 划线：agent team（teammate/mailbox）独立于普通 subagent；
  dsh/zcode 的 teammate 形态都要求 mailbox 与嵌套限制。v1 不引入 mailbox——主 agent
  单点派发 + 汇总即可表达并行与串行，通信复杂度留给 v2。

## 目标 / 非目标 / 反目标

**目标（v1）**

1. `/team` 命令：列出团队、激活团队、查看当前团队。
2. 默认团队 `dev`（软件开发全流程）与 `sec`（安全评估）随 CLI 发行。
3. 8 个现有内置 agent（verification/explore/debug/security-review/shell/
   ci-investigator/browser/best-of-n）成为团队成员，由领队与各角色按需派发。
4. `/team create` 生成用户自定义团队文件（人格 + 名册 + 领队）。
5. 一份 agent 循环纪律规范文档（docs/），先于实现落地，指导人格提示词与后续主循环改进。

**非目标（v1 不做）**

- 不做声明式 WorkflowDefinition 执行引擎（/team v2 的 dwf 工作流层）；v1 的串行
  管线由主 agent 按依赖顺序逐轮派发表达。
- 不做 teammate mailbox、成员互发消息或团队持久化名册（dsh/zcode 划线的
  team/swarm 形态留给 v2）；v1 协作 = 主 agent 派发 + 收报告 + 再派发。
- 不改动 MCP headless 语义与提示词缓存前缀的稳定性契约。

**反目标（出现即为失败）**

- 激活/退出 /team 导致系统提示词前缀字节漂移、缓存整体重计费。
- 新角色绕过现有权限体系（restriction/deniedTools/tool permissions）。
- 用户自定义人格能派发未被声明允许的操作（领队权力必须来自名册声明）。

## 约束（来自本仓库守卫文化）

- 前缀稳定性：`subagent` 工具描述刻意不内插 agent 名单（get-agents.ts 注释）；名单只
  出现在运行时的 list 工具输出里（属历史消息，不属缓存前缀）。/team 的一切注入必须
  遵守同一形状。
- 守卫测试：新增命令要过 slashCommandsDoc.test.ts（en/zh 双语文档表）、unusedKeys
  （i18n）、docsAccuracy（路径存在性）。
- 架构分层：stream/loop 引擎不得 import ui/；commands 层可以。
- commit 纪律：短祈使句、无 AI 署名；每项工作写入 docs/worklogs/。

## 方案取舍（已评审）

- **A. 六人静态注册进 builtInAgents** —— 已被扩充需求否决：名册要覆盖全流程九个新
  角色 + 8 个既有角色，且要支持自定义；全部硬编码会让"非团队会话"的名册无限膨胀。
- **B. 单一模板 + persona 参数** —— 否决：角色间的行为纪律差异（审查者与实现者的
  规则本质不同）会被退化成几个形容词。
- **C. 先写纪律规范文档，人格叠于其上 + A 的名册机制** —— 采纳。规范文档是整个
  TNT CLI 的改进依据，不局限于 /team；名册用文件而非硬编码。

## 设计

### 第一部分：agent 循环纪律规范（先落地）

位置：`docs/agent-discipline.md`（中文，与 ARCHITECTURE-tnt 同级引用）。

内容来源 = Claude Code 实际运行行为的提炼（本会话与 superpowers 技能的可观察纪律），
每条给出"规则 + 反例 + 依据"。章节：

1. **证据优先**：命令输出是证据，描述代码不是；未跑过的检查等于没做。
2. **ruling-not-stall**：冲突与歧义由执行者裁决并记录（决定、理由、错了的代价），
   只有四类事停下问人：不可逆/破坏性、安全敏感、越出 worktree 的副作用、计划全坏。
3. **review gate**：实现者自审不算审；每个交付物过一次独立审查，spec 符合 + 质量
   两个判定都通过才算完成。
4. **fix-loop 上限**：修复循环有轮次上限；到上限收敛不了就是结构性问题，裁决并
   记录，不允许"再来一轮"。
5. **派发纪律**：brief 要写给"刚进门的同事"——目标、已排除项、文件行号；已知答案
   的查找不派发；子代理工作时不重复它的搜索。
6. **前缀稳定**：进入提示词缓存的文本跨请求字节不变；会话状态（日期、git、名单）
   一律走运行时通道而非前缀通道。
7. **结构化收口**：多阶段交付以明确 verdict/状态行结束，下游按状态机消费。

这份文档是人格提示词的上位规范：每个角色提示词的"工作纪律"段从对应章节派生，
并在文档里标注派生关系。后续主循环（stream/loop）改进同样引用它。

### 第二部分：团队名册与文件格式

**名册 ≠ 内置硬编码。** 团队是一个 markdown 文件（TNT 已有 loadMarkdownSkills/
plugin agents 的先例），三处来源按优先级合并：

| 来源     | 位置                           | 说明                                     |
| -------- | ------------------------------ | ---------------------------------------- |
| 用户项目 | `.tnt/teams/*.md`              | 项目级自定义，最高优先                   |
| 用户全局 | `<global>/teams/*.md`          | 跨项目复用                               |
| CLI 默认 | `packages/cli/src/team/teams/` | 随发行，不可覆盖同名（重名告警取用户版） |

文件格式（frontmatter + 正文提示词，与 plugin agent 的 `content` 形状一致）：

```markdown
---
name: architect
description: 系统架构设计……（一句话，给模型和 /team 列表用）
team: dev
lead: false
restriction: readonly # no-writes | readonly | full（省略 = 继承会话）
deniedTools: [AskQuestion, Exit]
---

（正文 = 该角色的系统提示词，工作纪律段引用 docs/agent-discipline.md 章节）
```

- `name` 全局唯一，冲突时 用户项目 > 用户全局 > 默认（与 plugin loader 的 taken-set
  语义一致）。
- 领队是名册里的一个成员，`lead: true`，每个团队恰好一个。
- **成员间派发**：成员可派发哪些其他成员，由 `allowDispatch: [...]` 字段声明（v1
  从简：默认只有领队可派发，声明了 allowDispatch 的成员可派发列出的角色）。

### 默认团队

**dev（软件开发全流程）**，领队 project-manager：

| 角色                 | restriction | 定位（提示词要点）                                                                                        |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| project-manager      | readonly    | 领队：拆解、派 brief、追踪状态、收口 verdict                                                              |
| requirements-analyst | readonly    | 把模糊诉求变成可验收的需求清单                                                                            |
| architect            | readonly    | 方案与边界设计，产出 diff sketch 级方案供评审                                                             |
| implementer          | full        | 唯一写代码的角色；TDD；完成后自证（测试输出）；报告但不修相邻 bug（见下）                                 |
| tester               | no-writes   | 运行与撰写测试视角的验证（区别于 verification 的对抗式终审）                                              |
| code-reviewer        | no-writes   | 逐条审查 diff，spec 符合 + 质量两个维度                                                                   |
| ui-designer          | readonly    | UI/UX 设计：设计系统、组件结构、可访问性、视觉层级；产出设计文档与实现 brief（参考 Codex 的 UI 设计能力） |
| docs-writer          | full        | 只允许写文档路径；提示词内声明只碰 docs/ 与注释                                                           |
| debug                | no-writes   | （既有内置）根因定位                                                                                      |
| shell                | no-writes   | （既有内置）命令执行与观察                                                                                |
| explore              | readonly    | （既有内置）代码地图                                                                                      |
| best-of-n            | readonly    | （既有内置）方案对比                                                                                      |

**不加全栈工程师**：full-stack 是任务范围不是行为纪律——implementer 本就面对
monorepo 全栈；任务大时由主 agent 拆成多个 implementer 并行实例（合并模型的原生
能力），而不是新增与 implementer 重叠的角色。

**"报告但不修"条款（用户点名的 Claude Code 亮点，调研已定位成因）**：Claude Code
prompts.ts 无显式"主动报 bug"条款，该行为主要是模型能力差异；但 TNT 主提示词第 3
条的范围纪律（"No features nobody requested, no tidying of code you were not
changing"）在主动抑制它，而 verification agent 已有
"check the code that shares the path for side effects"（builtInAgents.ts:39）。
修法：主提示词与 implementer 人格补一条"报告但不修"——改动触碰的代码里发现无关
bug 时，最终报告用一小节列出（位置 + 一句话影响），不修、不展开；范围纪律原文
保留（它防的是擅自改代码）。进 agent-discipline.md。

**上下文共享（用户点名的缺口，v1 用简报回传，mailbox 留 v2）**：子代理默认只见
brief，v1 用三层补齐——

1. **brief 带会话背景**：派发契约加"背景"一节，主 agent 写明会话主题、相关决策、
   本任务的位置；零新机制，纪律进 agent-discipline.md 第 5 节。
2. **报告回传经主 agent 传递**：串行依赖的上下文（前序代理的关键结论）由主 agent
   写进下一个 brief——这正是 review gate 的既有形态。
3. **共享产出走文件**：设计文档、接口定义落仓库，后续 brief 引用路径；git 即共享板。
   微信群式全员广播（mailbox）需任务 DAG 与消息持久化（dsh agent-team 的整个
   types.ts 就在定义它），确认放 v2。

**sec（安全评估，授权测试限定）**，领队 security-review（既有内置升级为领队）：

| 角色             | restriction | 定位                                                           |
| ---------------- | ----------- | -------------------------------------------------------------- |
| security-review  | no-writes   | 领队：静态审计汇总（既有内置扩展为可领队）                     |
| reverse-engineer | no-writes   | 二进制/闭源分析：格式、调用约定、行为重建                      |
| hacker           | no-writes   | 动态渗透测试，提示词首段硬性声明"仅限已授权目标"，只报告不利用 |
| verification     | no-writes   | （既有内置）终审                                               |
| shell            | no-writes   | （既有内置）执行探测命令                                       |

既有 8 个内置 agent 保持 BUILT_IN_AGENTS 注册不变（所有会话可用）；团队文件通过
引用其 name 复用它们，不复制提示词。

### 第三部分：运行时接线（各点均按调研核实过的路径）

1. **并行子代理（核心新能力）**：把 `Subagent` 的并发声明从 `exclusive`
   （concurrency.ts:177，全局独占槽）改为 keyed claim。Subagent 工具新增可选参数
   `files`（advisory 路径列表，语义对齐 dsh writeScopes：提示性范围，不是锁）：
   - 主 agent 派发时声明该代理会读写的路径；未声明则回落全局独占槽（保守）。
   - 范围不重叠的多个 Subagent 调用进入 planner 的同一步并行执行；范围重叠则
     planner 既有 barrier 逻辑自动串行化。主 agent 不需要理解 planner——它只做
     "这两个任务碰不碰同一块"的判断，串行化是执行层保证。
   - 串行流程（分析到方案到实现到审查）= 主 agent 逐轮派发，天然有序。
   - 同一人格可多实例并行（如两个 implementer 改不同模块）；名册按人格类型组织，
     实例按派发创建。
   - 派发纪律（brief 要声明文件范围、避免范围含糊）写入 agent-discipline.md
     第 5 节，主 agent 系统提示词引用。
2. **派发查询链**：`getSubagent`（subagent/get-agents.ts）目前只查 ModelService。
   新增 `TeamService`（services/ 注册，懒加载），提供合并后的可派发名册：
   `ModelService.getSubagentModels`（配置 + 8 内置）→ 激活团队成员 →
   插件 agent。
   团队成员的 baseSystemMessage = 文件正文，model 继承会话模型（复用 ModelService
   里内置 agent 的 inherit 逻辑，抽成共享函数）；restriction/deniedTools 由 frontmatter
   声明，executor.ts 按 name 解析处同样扩展。**同时修复既有缺口**：插件 agent 以
   `plugin:name` 进入查询链（默认 restriction no-writes），让"能列出"与"能派发"一致。
3. **激活状态**：`/team dev` 的激活态随会话存续（outputStyle handler 的运行时状态
   形状，v1 存内存会话态，不落 meta）。激活只在运行时改变 list 工具输出与派发查询链，
   **不改任何缓存前缀文本**。
4. **领队注入**：激活时把领队提示词追加进 userRules 分节（SystemMessage 的
   additionalRules/markdown rules 汇聚点，见调研）。追加发生在激活后的下一 turn，
   一经加入不再变动（会话级 latched，如同 beta header）；`/team off` 是新 turn 的
   新变化，可归因到节。userRules 节标记 volatile: true（与 rules 现状一致——规则
   变化本就允许重计费该节，前缀 spine 不受影响）。
5. **命令**：`/team`（无参 = 列出可用团队与当前激活态）、`/team <name>`（激活）、
   `/team off`、`/team create <name>`（生成模板文件到 `.tnt/teams/`，或
   `--from <file>` 导入）。注册走 `BUILTIN_SLASH_COMMANDS` + handlers/team.ts，
   i18n 双语言块 + slashCommandsDoc 双语表同步。
6. **深度与领队**：专家团与子代理合并后，"领队"不再是独立执行者——派发权始终在
   主 agent，激活团队只改变可派发名册与提示词注入。v1 保持扁平深度
   （maxDelegationDepth = 1），子代理不再派发子代理（对齐 zcode "teammate 不得再
   spawn teammate" 的划线）；allowDispatch（成员间互派）与 mailbox 属 v2。

### 交付顺序

1. `docs/agent-discipline.md`（规范先行，单独 commit；含第 5 节并行派发纪律与
   brief 背景契约，及"报告但不修"条款）。
2. 并行子代理：Subagent 并发声明 exclusive → keyed（`files` 参数）+ planner 集成
   测试（重叠串行、不重叠并行、未声明回落独占）。
3. TeamService + 名册加载 + 派发查询链接线（含 plugin agent 可派发的缺口修复）+ 测试。
4. 默认团队两份名册文件 + 领队/成员提示词（提示词按规范文档派生），主提示词
   "报告但不修"条款同步修改（注意 systemPrefixFingerprint 守卫需同步更新 digest）。
5. `/team` 命令四形态 + i18n + en/zh 文档守卫。
6. `/team create`。
7. worklog 记录。

### 留给实现者决定

- TeamService 的缓存与 mtime 指纹（沿用插件 loader 的失效模式）。
- `/team create` 生成模板的具体条目与默认值（不做多步交互问卷，一步生成可编辑文件——
  用户再编辑比问卷快）。
- tester 与 verification 在提示词里的措辞分工细节。
- hacker 角色在非授权上下文被请求时的拒绝话术（提示词内声明即可，不做运行时拦截；
  现有 tool permissions 仍是最终闸门）。

## 调研发现的边界划线（zcode 07-subagent.md，v1 遵守）

- agent team（teammate/mailbox/互发消息）与普通 subagent 是**两个概念**，不许混在
  一个工具里。v1 的 /team 全部成员走既有 subagent 工具派发，没有 mailbox。
- teammate 不得再 spawn teammate —— 对应 v1 的扁平深度 1 与"领队之外不派发"。
- 定义文件要有 provenance（谁定义的、版本），运行时拒绝路径穿越 —— 名册加载沿用
  plugin loader 的既有防护（taken-set、绝对路径校验）。

## 验证方式（设计层面的验收）

- 前缀指纹守卫（systemPrefixFingerprint.test.ts）在 /team 激活前后不变。
- 并行子代理有 planner 集成测试：`files` 不重叠的两个 Subagent 同步执行、重叠的
  串行、未声明 `files` 的回落独占槽（行为与改动前一致）。
- 派发查询链有测试：团队激活后 getSubagent 能解析团队成员与 plugin agent。
- 名册三层合并有测试：重名取用户版、坏文件告警不中断。
- slashCommandsDoc 双语表、unusedKeys、docsAccuracy 全绿。
- 每个 tnt 守卫与既有 490+ 测试文件全绿。
