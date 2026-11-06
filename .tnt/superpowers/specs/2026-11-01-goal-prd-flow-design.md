# /goal 目标驱动开发流程 v1 设计

日期：2026-11-01
状态：待评审
前置：`2026-10-31-team-design.md`（/team v1，Task 1-4 已完成，Task 5-7 进行中——
本设计在其完成后实施，并修订其 Task 7 的领队注入设计）

## 调研依据（本设计的事实来源，均已核实）

- **`/goal` 已存在且持久化**：`ui/commands/builtins.ts:41` 注册，handler 在
  `handlers/sessions.ts:63-85`（`/goal <目标>` 设置、`/goal clear` 清除），状态存
  session record 的 `goal` 字段（session/store.ts:98），跨 compaction 保留。
  **缺口**：`getSessionGoal()`（session/index.ts:704）目前唯一的消费者是命令自身的
  显示逻辑——主 agent 的系统提示词、任何派发链都不读它。目标被存储、被显示，但
  从不进入推理上下文。
- **派发深度 = 1**：`subagent/depth.ts` `DEFAULT_MAX_SUBAGENT_DEPTH = 1`，子代理
  不能嵌套派发。领队/PM 不可能是子代理——这决定了流程引擎必须放在主 agent 或
  "PM 计划 + 主 agent 执行"两层之间。
- **子代理无技能/插件注入**：插件技能只进主会话上下文；团队成员（子代理）的纪律
  编译自 `docs/agent-discipline.md`，不读任何插件。冲突面只有主 agent。
- **PRD 相关概念在仓库中零出现**：grep 全 docs/ 与 .tnt/ 无 "PRD"、"pre-mortem"、
  "迭代闭环"。本设计是从零引入，不是对既有概念的扩展。
- **goal 的既有语义是会话级、不绑团队**：`handleGoal` 的 i18n 文案是"Set the goal
  for the current session"（i18n/index.ts:205 en / :896 zh）。本设计沿用该语义：
  goal 是主 agent 的工作方向，无论团队激活与否；团队流程只是 goal 的一个消费者
  （用户修正 1，2026-11-01 审查会话确认）。
- **团队激活有两条路**（用户修正 2，2026-11-01 审查会话确认）：显式命令
  （`/team`、`/team dev`）与对话意图识别（用户说"叫专家团来开发"等，主 agent 判定
  后进入激活态）。命令只是入口之一，不是唯一入口。激活判定采用用户选定的 C 方案：
  默认主 agent 按任务规模判断（需要拆解成多个子任务的大目标 → 召集专家团），用户
  可用偏好开关覆盖（`/team` 命令或配置声明"大目标自动召集"）；未开关时对话发起
  默认"主 agent 自己干，点名才召集"。
- **`.tnt/superpowers/` 已被 git 跟踪**（.gitignore 217 行反向规则）——设计文档与
  计划都落在仓库里。用户项目里的 PRD 目录同理可跟踪。
- **superpowers 共存裁决**（与用户确认）：内置 goal 流程作为 TNT 的正式开发团队
  工作流；superpowers 等规划插件留给未激活团队的通用开发。激活态即模式开关，
  一条注入规则消解双流程归属冲突；不检测插件、不 fork。
- **dsh-superagent-prototype 参照研究**（2026-11-01）：DeepSeek 开源研究原型
  （MIT），一个"主动式编码智能体"框架，与本项目高度相关。完整研究记录在
  文末**附录：dsh-superagent-prototype 参照研究**（域模型、裁决印证表、
  prompts 逐文件要点、不采纳清单、v2 候选清单）。本设计从它吸收三项模式
  （报告状态词汇表 → 第三部分第 6 点；人类注意力经济 → 第三部分第 7 点与
  第四部分；确定性状态判定 → 第三部分第 8 点），并有五条裁决得到它的独立
  实现印证（见附录"裁决印证表"）。

## 意图与动机

v1 专家团解决了"谁能干活"（名册、人格、并行派发），没解决"流程怎么走"：用户设定
开发目标后，没有机制驱动团队走"需求分析 → PRD → 方案 → 开发 → 测试 → 验收 →
交付"的完整流程。本设计引入 **goal 驱动的目标开发流程**：

- **goal 是会话级的通用机制，不限制 agent**（用户修正 1）：主 agent 接活时（无论
  是否激活团队），goal 都注入其上下文，作为对齐与自检的锚点；激活团队时，goal
  进一步成为专家团流程的输入（受理臂转派 PM）。两层共享一个存储，互不绑定。
- **PRD 是真实文件**，不是聊天输出。它是团队的共享状态板与验收依据。
- **主 agent 是老板的代理（执行臂 + 监控），不是 PM**。PM 的管理职责由团队子代理
  承担，主 agent 只受理、转派、转呈、监控。
- **流程产出对齐正式开发团队**：PRD（含 pre-mortem 风险表）、迭代计划、验收记录、
  交付报告，全部落盘、可追溯。
- **自我迭代**：验收未通过的需求项自动回到计划调整，直到全部验收或触发停点。
- **团队召集有两条路**（用户修正 2）：显式命令与对话意图识别；判定默认按任务
  规模（大目标召集、小活自己干），偏好开关覆盖（C 方案）。

## 目标 / 非目标 / 反目标

**目标（v1）**

1. goal 进入主 agent 上下文（通用层，不限制 agent）：未激活团队时，主 agent 干活
   也对着 goal 对齐与自检；激活团队时，goal 进一步驱动"受理 → PRD → 计划 →
   执行 → 验收 → 交付"流程。
2. 团队召集双入口：显式命令（`/team <name>`）与对话意图识别；默认按任务规模
   判断（大目标召集专家团），偏好开关可覆盖（C 方案）。
3. PRD 落盘：`.tnt/prd/<topic>.md`，九节结构，需求条目带验收状态。
4. Pre-mortem（预死亡分析）成为流程的固定节点：PRD 确认前，PM 假设已失败倒推
   风险，写进 PRD 风险节。
5. 迭代闭环：verification 对照 PRD 验收标准逐条判定；未通过项回 PM 调整计划，
   PRD 变更带影响评估记录。
6. 主 agent 职责收敛（流程期间）：受理 goal、转派 PM、按 PM 计划派发、转呈用户、
   监控异常、新需求入板。不自行规划，不戴 PM 帽。
7. 流程纪律进 `docs/agent-discipline.md`（新增第 8 节：目标开发流程）。

**非目标（v1 不做）**

- 不做成员间消息机制（mailbox/群聊广播）；共享状态 = PRD 文件 + brief 回传
  （v1 team-design 已有先例，mailbox 留 v2）。
- 不做嵌套派发（深度仍为 1）；PM 不直接派发成员，由主 agent 按 PM 计划执行。
- 不做 PRD 的 web UI 或外部工具集成；PRD 是纯 markdown。
- 不做声明式工作流引擎（phaseOrder/graph scheduler 留 v2）。
- PRD 不做多主题并行管理（v1 每个会话一个活跃 PRD）。
- 偏好开关只做"大目标自动召集专家团"的布尔声明（v1 的 C 方案覆盖面），不做
  更细的规则引擎（按项目/按文件类型自动分流留 v2）。

**反目标（出现即为失败）**

- 主 agent 在流程期间仍以通用助手身份回答与流程无关的问题（受理纪律失效）。
- PRD 只存在于会话上下文，不落盘。
- 验收状态与 PRD 文件内容脱节（收口说"已验收"但 PRD 里还是"待开发"）。
- 团队未激活时出现 PRD/流程行为（goal 通用层不受此限——它本来就是会话级机制）；
  团队未激活且未触发召集判定时会话与现状一致。
- 主 agent 的召集判定在小活上频繁误触发团队流程（判定条款必须锚定"需要拆解成
  多个子任务"这类可观察信号，不是"用户语气像大项目"）。

## 约束（承接 v1 team-design 的守卫文化）

- 缓存前缀稳定性：受理纪律注入走 userRules volatile 分节（与 Task 7 同通道），
  静态 spine 不动；`systemPrefixFingerprint.test.ts` digest 同步。
- goal 注入属于激活后下一 turn 的动态内容，不进任何缓存前缀文本。
- commit 纪律、worklog 记录、`.tnt/superpowers/` 产物位置，同 v1。
- `SubagentRestriction` 不新增枚举值。

## 方案取舍（已评审）

- **A. 主 agent 戴 PM 帽（v1 team-design Task 7 原设计）**——被本次需求修订否决：
  PM 管理职责与"老板代理"定位冲突；主 agent 兼任 PM 会把两种身份混进一个上下文
  （用户明确反对污染）。
- **B. 放开深度限制到 2，PM 子代理真派发**——否决：架构级改动（深度簿记、前缀、
  schema），token 成本乘法级；v1 用"PM 写计划、主 agent 执行计划"表达同样的
  管理结构，代价只是计划文件多读一次。
- **C. 采纳：主 agent = 受理臂 + 监控；PM = 团队子代理；PM 产出书面计划，主 agent
  按计划逐项派发；PRD 文件是团队共享状态板。**
- **superpowers 共存**：内置流程优先，不检测插件。激活态注入一条裁决规则。
  理由：方法论（TDD、证据优先、ruling-not-stall）已编译进 agent-discipline.md；
  PRD/pre-mortem/验收闭环是 superpowers 没有的增量。
- **PRD 位置**：`.tnt/prd/`（项目内、git 可跟踪、可评审、变更可追溯），不放
  `.tnt/superpowers/`（那是本仓库的规划产物目录，用户项目的 PRD 是用户项目的
  开发产物，语义不同）。

## 设计

### 第一部分：流程总览

```
用户 /goal <目标>；主 agent 干活时对 goal 对齐（通用层，任何模式生效）

召集专家团（两条路，进入流程层）：
  a) 显式命令：/team dev 激活后，主 agent 对大目标进入流程
  b) 对话发起：用户说"叫专家团来做 X"；或偏好开关开启时主 agent 按任务规模
     自动召集（默认关闭——未开关时小活自己干、点名才召集）

主 agent（受理臂，不戴 PM 帽）：
  1. 受理：goal 转为 brief 派发 project-manager（PM）
     "分析目标、协同 requirements-analyst 产出 PRD、跑 pre-mortem、给出迭代计划"
  2. PM + requirements-analyst 子代理产出 .tnt/prd/<topic>.md
     （九节结构见第二部分；PM 在主 agent 转呈前完成 pre-mortem）
  3. 主 agent 转呈用户：PRD 路径 + 摘要（目标、范围、验收标准、风险 top 3、
     迭代计划概要）→ 等用户确认
     [确认后进入执行循环；不确认 → 用户意见回 PM 修订 PRD]
  4. 主 agent 按 PM 迭代计划逐轮派发：
     implementer（可能多实例 keyed 并行）→ tester → code-reviewer
  5. 每轮收口：主 agent 把结果回传 PM，PM 更新 PRD 状态字段
     （需求条目状态机：待开发 / 开发中 / 已实现 / 已验收 / 未通过）
  6. 一轮计划内全部"已实现"→ 主 agent 派发 verification：
     对照 PRD 验收标准逐条判定，输出 PASS/FAIL/PARTIAL + 证据
  7. 未通过项 → 主 agent 转回 PM → PM 调整计划或提出 PRD 变更
     （变更写进 PRD 变更记录节，含影响评估）→ 回到 4
  8. 全部需求条目"已验收"→ 主 agent 派发 docs-writer 补文档（如计划要求）→
     交付报告给用户（PRD 路径 + 迭代轮次 + 验收记录 + 遗留项）

主 agent 全程监控（不派发时也生效）：
  - 子代理收口异常（BLOCKED、双不通过、fix-loop 触顶）→ 转呈用户
  - 新需求（用户中途提出）→ 转给 PM → PRD 变更记录 → 计划调整
  - 四类停点（不可逆/安全敏感/越界副作用/计划全坏）→ 停下问用户
```

与 v1 team-design 的差异（修订 Task 7）：

- 领队提示词**不再注入主 agent**。激活时注入主 agent 的是一段**受理纪律**
  （第四部分），内容是"你是老板的代理：受理、转派、按计划执行、转呈、监控"，
  明确声明不自行规划、不以助手身份处理流程外请求。
- PM 的人格提示词从"领队：拆解、派 brief"改为"管理者：产出 PRD、跑 pre-mortem、
  写迭代计划、裁决迭代结果、更新 PRD 状态"——它不再写"派发"职责（派发权在
  主 agent），改为"产出书面计划供执行"。

### 第二部分：PRD 文件格式

位置：`<cwd>/.tnt/prd/<topic>.md`。topic 为 kebab-case 主题名（主 agent 从 goal
生成，重名追加 `-2`、`-3`）。

```markdown
# PRD: <一句话目标>

## 元数据

- goal: <用户原始 goal 原文>
- 状态: 起草 | 已确认 | 执行中 | 已交付 | 已搁置
- 创建: <日期> 轮次: <迭代轮号>

## 1. 背景与目标

（为什么做：从 goal 与会话上下文提炼；北极星——完成时什么变了）

## 2. 用户与场景

（谁在什么场景遇到什么问题；CLI 项目通常是"TNT 使用者在做什么任务时被什么卡住"）

## 3. 功能范围

（本次做什么、不做什么；需求编号 R1/R2/...；MoSCoW 优先级）

## 4. 详细需求

### R1: <需求名>

- 陈述: ...
- 验收标准: 可运行的检查或可观察的行为（不写"合理的"这类不可判定词）
- 状态: 待开发 | 开发中 | 已实现 | 已验收 | 未通过
- 关联: <文件/模块>

### R2: ...

## 5. 非功能需求

（性能、安全、兼容、文档；同样是编号条目 + 验收标准 + 状态）

## 6. 迭代计划

（PM 的拆解：每轮 = 哪些 R 条目、派给谁、files 范围、依赖顺序；
这是主 agent 执行臂的直接输入）

## 7. 风险（pre-mortem）

（PM 在 PRD 确认前假设项目已失败倒推：每条 = 风险 + 触发信号 + 规避手段；
空表需显式写"无"，不允许缺节）

## 8. 变更记录

（每条 = 日期 + 变更内容 + 影响评估[哪些 R 条目受影响、验收标准是否改变] +
提出方[用户/PM/验收结果]）

## 9. 验收记录

（verification 的逐条判定追加处：R 编号 + 判定 + 证据 + 日期）
```

规则：

- PRD 由 PM（写文件）与 requirements-analyst（提供需求陈述与验收标准素材）产出；
  implementer/tester/reviewer **只读不写** PRD（它们的 restriction 本就是
  readonly/no-writes，机械保证）。
- 状态字段是收口契约的一部分：PM 每轮收口后更新 PRD（PM 无 restriction，可写），
  主 agent 不直接编辑 PRD（受理臂不动产物）。
- verification 写第 9 节（verification 是 no-writes——**这是本设计对既有 restriction
  语义的唯一突破点**，见第四部分的裁决）。
- PRD 进 git（用户项目的开发产物，可评审可追溯）。

### 第三部分：与既有机制的接线

1. **goal 读取（通用层）**：`getSessionGoal()` 已在 session/index.ts 导出。两层
   消费：
   - 通用层（任何模式）：goal 原文注入主 agent 上下文（userRules volatile 节的
     goal 分行，与受理纪律同通道但独立成行——未激活团队时只有这一行，激活后追加
     受理纪律）。主 agent 干活时对 goal 对齐与自检。这是对现状的增量：现状下
     goal 无任何消费者。
   - 流程层（团队激活）：goal 是受理臂转派 PM 的 brief 输入。
     `/goal` 重设或 clear = 新 turn 新变化，可归因到节，前缀 spine 不受影响。
2. **召集判定（双入口）**：
   - 显式命令：`/team <name>` 激活态 + 存在 goal → 流程可启动；未设 goal →
     主 agent 提示先 `/goal`（明确报错，不静默）。
   - 对话发起：主 agent 提示词含"何时召集专家团"判定条款（进 agent-discipline
     第 8 节）：锚定可观察信号——目标需要拆解成多个子任务、涉及多角色协作、
     用户明确点名团队；命中 → 进入激活态（等价于 `/team dev`），转呈用户告知
     （"已召集 dev 专家团，如不需要请 /team off"）。
   - 偏好开关（C 方案）：配置项（如 `.tntrc.json` 的 `team.autoConvoke: true`，
     默认 false）声明"大目标自动召集"；开启后主 agent 对符合召集信号的大目标
     自动进入流程，无需用户点名。
3. **受理纪律注入**（修订 Task 7）：激活态时注入 userRules volatile 节的内容
   从"领队提示词"改为"受理纪律 + 当前 goal 原文"。
4. **PM 派发**：PM 作为团队成员由主 agent 用 Subagent 工具派发（files 声明
   `.tnt/prd/<topic>.md` 等）；PM 的 systemMessage 更新后，成员名册侧不需要新
   字段。allowDispatch 不引入（v1 team-design 已声明留 v2）。
5. **verification 写 PRD 的 restriction 裁决**：verification 既有 restriction 是
   no-writes（builtInAgents.ts:70），但 PRD 第 9 节必须由 verification 追加。
   两个选项：
   - (a) PRD 验收记录改由 PM 在收到 verification 报告后代写（verification 只报告，
     PM 落盘）——零 restriction 改动，多一跳；
   - (b) 给 verification 增加"可写 PRD 路径"的例外——需要新的 restriction 维度
     （路径级白名单），触碰权限模型。
     **采纳 (a)**：机械边界不动，"报告不写、PM 落盘"同时强化了"verification 不能
     改自己判定"的独立性；代价是收口格式里 verification 的报告必须含结构化的逐条
     判定行，PM 机械转写（该格式进 agent-discipline 第 8 节）。
6. **收口格式扩展**（agent-discipline.md 第 8 节新增条款）。参照
   dsh-superagent 的结构化报告词汇表（`docs/001-domain.md:112`：progress /
   waiting / ready / blocked / failed / dropped 六个显式状态，禁止从自由文本
   推断状态），本设计的收口报告采用显式状态词，每个状态有固定判据，不靠
   agent 自我感觉：

   **状态词汇表**（流程内所有收口报告的第一行必须是其中之一）：

   | 状态             | 判据（必须全部满足）                                             | TNT 流程中的使用者                          |
   | ---------------- | ---------------------------------------------------------------- | ------------------------------------------- |
   | 进展 progress    | 工作仍在继续，本轮有可报告的产出，下一轮计划明确                 | implementer/tester 中间收口                 |
   | 等待 waiting     | 回合结束且没有未决问题，在等下一个输入                           | implementer 完成一轮后等测试/验收           |
   | 就绪 ready       | 成果已被检查（测试过/评审过），随时可被下一环节消费              | 一轮实现收口、PRD 就绪待确认、最终交付      |
   | 受阻 blocked     | 实现**确实无法继续**且**必须人来行动**（缺授权、缺决策、缺环境） | 任何角色；存在未完成草稿不算 blocked        |
   | 失败 failed      | 尝试后确定无法完成，且不在人能解的范围内                         | fix-loop 触顶、验证反复失败且 PM 无调整方案 |
   | 无需处理 dropped | 调查后确认无事可做（需求不成立、已被覆盖、目标外）               | 需求分析发现需求与 goal 矛盾时              |

   两条从 dsh 借来的边界纪律，直接写进状态判据：

   - **存在未完成的草稿不算 blocked**（dsh：`prompts/work.md:44` "Use blocked
     only when implementation actually cannot proceed and a human must act,
     never merely because an unfinished PR exists"）。TNT 对应：一轮实现只做
     了部分 R 条目 → 报"进展"并说明剩余条目；报告"受阻"的唯一合法原因是
     出现了用户必须决策/行动的具体事项。
   - **"dropped" 静默关闭但可追溯**（dsh：dropped 报告结束工单且不发消息，
     但人的后续消息可恢复它）。TNT 对应：PM 判定某需求无需处理时，不在收口
     消息里打扰用户，但必须在 PRD 变更记录节写明判定与理由，用户随时可查。

   三类角色的收口格式：

   - PM 收口 = 状态词（就绪/受阻/失败）、PRD 状态更新摘要（哪些 R 变更状态）、
     下一轮计划、BLOCKED 清单（空写"无"）。
   - verification 收口 = 逐条 `R<n>: PASS|FAIL|PARTIAL — 证据`，末行
     `VERDICT: <n 通过>/<m 总数>`（这一格式本身就是"结构化字段不从自由文本
     推断"的落点：PM 转写时只认逐条判定行，不解读任何叙述性文字）。
   - 主 agent 转呈格式 = 固定小节序列（PRD 路径、状态摘要、风险、需要用户
     决策的事项），转呈触发条件见第 7 点。

7. **人类注意力经济**（参照 dsh-superagent `docs/000-philosophy` 与
   `prompts/team/communication.md`："take as little human attention as possible,
   and give as much value as possible"；"A PR merely existing is not a delivery
   milestone"）。主 agent 对用户的转呈是稀缺资源，v1 固定四条纪律：

   - **只在三种情况打扰用户**：结果就绪可用（PRD 待确认、一轮就绪、最终交付）；
     需要用户做决定（blocked 状态、PRD 变更确认、停点）；确定无法完成（failed）。
     除此之外全程沉默——中间进展只在 PRD 文件里，不进对话。
   - **每个请求只确认一次**：受理 goal 时确认一次并说明将做什么；流程期间不再
     重复确认。"代码写完了"不是交付里程碑——只有过验证的"就绪"才转呈
     （对应反目标：收口说"已验收"但 PRD 里还是"待开发"）。
   - **转呈短而具体**：固定小节序列，每节一到两行；不粘贴长报告（完整内容
     用户可查 PRD 文件与各角色收口记录，对话里只有结论与路径）。
   - **问题一次一个、具体可答**：转呈里"需要用户决策的事项"小节每次至多一项，
     且是具体问题（不是"请确认方案是否可行"这类开放式确认）。

   这四条与既有反目标"主 agent 在流程期间仍以通用助手身份回答流程外问题"互补：
   反目标管"多话的旁支"，注意力经济管"多话的主线"。

8. **确定性状态判定规则**（参照 dsh-superagent `docs/003-execution.md` 的
   Ticket stages 表："Read the table from top to bottom; the first matching row
   wins"，阶段由"它在等什么"决定，完全确定性）。PRD 需求条目的状态机
   （待开发 / 开发中 / 已实现 / 已验收 / 未通过）同样按确定性规则运转：

   - **状态由最新证据决定，不由任何 agent 的自我汇报措辞决定**：PM 更新状态
     字段的唯一依据是结构化收口/验收记录（tester 报告、verification 判定行），
     implementer 声称"做完了"不构成"已实现"的证据——tester 或 verification
     的对应报告才是。
   - **自上而下判定，首条命中即胜**（PM 收口时逐条目执行）：

     | 顺序 | 条件（按最新证据）                                              | 状态   |
     | ---- | --------------------------------------------------------------- | ------ |
     | 1    | §9 验收记录有该 R 条目的 FAIL/PARTIAL 判定，且其后无更晚的 PASS | 未通过 |
     | 2    | §9 验收记录有该 R 条目的 PASS 判定                              | 已验收 |
     | 3    | 本轮 tester/code-reviewer 收口引用该条目且无未通过证据          | 已实现 |
     | 4    | 本轮派发过该条目                                                | 开发中 |
     | 5    | 其余                                                            | 待开发 |

   - **非法迁移拒绝**：已验收 → 待开发 不允许直接改（必须走 PRD §8 变更记录，
     记录变更与影响评估后由新验收覆盖）；"未通过"条目回到"开发中"必须能指向
     一次新的派发记录。
   - 这条规则同时是测试口径：状态机测试验证的不是"PM 会不会写状态"，而是
     "给定收口证据序列，状态字段是否可机械推出"。

9. **i18n**：`goal.*`、`prd.*` 系列 key，en/zh 双语言块成对。

### 第四部分：主 agent 提示词注入（两个层次）

**层次一：goal 对齐行（通用层，任何模式注入）**

userRules volatile 节加一行（存在 goal 时）：

- 当前会话目标：<goal 原文>。你的工作与决策对齐此目标；目标外的事项先确认再动。

**层次二：受理纪律（激活态时追加）**

- 你是使用者的代理老板：受理目标、转派专家团、按 PM 的书面计划派发执行、
  向使用者转呈与求助。
- 流程期间不自行规划：计划由 PM 产出，你执行；执行中的偏差回到 PM 裁决。
- 流程期间不以通用助手身份处理流程外请求：转呈用户，由用户决定是否中断流程。
- PRD 是唯一事实来源：派发 brief 引用 R 编号；你的报告引用 PRD 路径与状态。
- 注意力纪律：只在"结果就绪 / 需要用户决定 / 确定无法完成"三种情况转呈用户；
  中间进展留在 PRD 与各角色收口记录里，不进对话；每个请求只确认一次。
- 监控：收口异常、验证未通过、新需求——按第一部分的流程图行动。
- 流程纪律已编译进 agent-discipline.md 第 8 节；不调用外部规划类插件技能。
- 未设 goal 时流程不启动（只提示用户先 /goal；goal 对齐行照常生效）。

两个层次都是动态内容（volatile 节），激活/退出/goal 变化在下一 turn 生效并可
归因到节，静态 spine 不动。

### 第五部分：agent-discipline.md 第 8 节（目标开发流程）

新增章节（前 7 节不动），内容：

1. **goal 对齐**：goal 是会话级锚点（通用层）；主 agent 干活时对 goal 对齐与
   自检，目标外事项先确认再动。
2. **召集判定**：双入口（命令/对话）；可观察信号清单（需拆解成多个子任务、
   多角色协作、用户点名）；偏好开关语义；召集时必须转呈用户告知。
3. **PRD 契约**：九节结构、状态机、变更记录规则；"PRD ≠ 功能清单"（每条需求
   必须有可判定验收标准）、"PRD ≠ 一次性文档"（变更必有记录与影响评估）。
4. **pre-mortem 纪律**：PRD 确认前必跑；假设已失败倒推风险；每条风险带触发信号
   与规避手段；与 architect 证伪点的关系（证伪点是方案级的，pre-mortem 是
   任务/流程级的，两者并存不互斥）。
5. **迭代闭环规则**：验收未通过 = 闭环输入而非终点；闭环的最小单位是"PRD 变更
   记录 + 计划调整"，不允许无记录的口头迭代。
6. **角色在流程中的收口格式与状态词汇表**（第三部分第 6 点的展开：六状态词
   汇表、blocked/dropped 边界纪律、三类角色的收口格式）。
7. **主代理受理纪律与注意力经济**（第四部分文本的上位来源，含四条转呈纪律）。
8. **确定性状态判定**（第三部分第 8 点：证据优先、自上而下首条命中、非法迁移
   拒绝、测试口径）。
9. **流程与 superpowers 等外部规划插件的裁决**（激活态优先，已编译的方法论
   不重复加载）。

## 交付顺序（在 /team v1 Task 5-7 完成之后实施）

1. agent-discipline.md 第 8 节（规范先行，含 goal 对齐、召集判定、PRD 契约、
   pre-mortem、迭代闭环、收口格式与状态词汇表、受理纪律与注意力经济、确定性
   状态判定、插件裁决九小节）。
2. goal 对齐行注入（通用层）+ 测试（有/无 goal 两种形状；未激活团队也生效）。
3. PRD 文件格式与 PM/requirements-analyst 提示词升级（含 pre-mortem 纪律），
   defaultTeams.ts 对应更新 + 测试。
4. 受理纪律注入（修订 Task 7 的领队注入为受理注入）+ systemPrefixFingerprint
   digest 同步 + 测试。
5. 召集判定与偏好开关（`.tntrc.json` `team.autoConvoke`，默认 false）+ `/team`
   命令的转呈告知语义 + 测试。
6. verification/PM/主 agent 收口格式接线 + 迭代闭环测试（PRD 状态机、变更记录、
   转呈格式）。
7. i18n + docs（en/zh 成对）+ worklog。

## 留给实现者决定

- PRD 文件名 topic 的生成规则细节（goal → kebab-case 的具体截断与去重）。
- 主 agent 转呈的措辞细节（第一部分的固定小节序列不变）。
- PM 提示词里 pre-mortem 的具体提问模板。
- 第 9 节验收记录的表格 vs 列表排版。

## 验证方式（设计层面的验收）

- 无 goal、团队未激活：会话行为与现状逐字节一致（前缀指纹 + 现有测试全绿）。
- 有 goal、团队未激活：userRules 节含 goal 对齐行，无受理纪律；前缀 spine 不变。
- 受理注入后：主 agent 的 userRules 节含受理纪律与 goal；`/team off` 或
  `/goal clear` 后下一 turn 消失；前缀 spine 不变。
- 召集判定：未开启偏好开关时，主 agent 不自动进入流程（反目标守卫）；开启后
  对含召集信号的目标进入流程并转呈告知。
- PRD 状态机测试：待开发 → 开发中 → 已实现 → 已验收 的合法迁移与非法迁移拒绝
  （PM 收口逻辑层面测试）。
- 确定性状态判定测试：给定收口证据序列（tester 报告、verification 判定行），
  状态字段可机械推出；implementer 声称"完成"而无 tester/verification 证据时，
  状态不得推进到"已实现"（第三部分第 8 点的测试口径）。
- 收口格式测试：所有流程内收口报告首行为六状态词之一；"仅存在未完成草稿"的
  报告不得为 blocked；dropped 判定必伴随 PRD 变更记录条目。
- 变更记录测试：PRD 变更必留记录与影响评估。
- verification 报告格式测试：逐条判定行可被 PM 机械转写。
- 全部既有守卫（slashCommandsDoc、unusedKeys、docsAccuracy、前缀指纹）与
  490+ 测试文件全绿。

## 附录：dsh-superagent-prototype 参照研究

本附录是参照研究的完整记录，供实现时回查；正文各处引用"参照 dsh"时以本
附录为准。克隆位置：`~/All_projects/GithubProjects/test-continue/dsh-superagent-prototype`
（GitHub：deepseek-ai/dsh-superagent-prototype，MIT，2026-10-31 发布，经
ghfast.top 镜像克隆）。下文引用的 `docs/…`、`prompts/…` 均指该仓库内文件。

### A1. 项目是什么

DeepSeek 的研究原型：一个**主动式编码智能体**框架。人通过 GitHub Issue/评论或
飞书消息向它提需求，它自己接单、派工、执行、交付 PR，全程尽量不占用人的注意
力。它不是聊天助手，是"值守队列里的开发团队"：没有请求时静默，请求来了自动
评估是否接单，接了就一路做到 PR 可评审，只在必须人行动时发消息。

核心链路：

```
Source（事件源：GitHub/飞书）
  → Trigger（不可变事件，幂等键）
  → Eval（评估：gate 准入层 + assessment 研判层）
  → accept 创建 Ticket（工单，带 Mandate 授权）
  → Assignment（派工，绑定 Executor）
  → Executor Session（worker-<ticket id>，每工单独立目录）
  → Report（结构化报告六状态）
  → Channel（回帖/IM 送达）
```

一句话区分两套系统：**dsh 的主 Session = 我们的主 agent（受理/路由，不扩权）；
dsh 的 Executor = 我们的团队成员（真正干活）；dsh 的 Ticket+Mandate ≈ 我们的
PRD 条目（授权范围）+ 迭代计划（派发依据）**。dsh 没有我们的 PM 角色——它的
路由器只做接单/停止/忽略/转投四类决定，需求推导明确下放给 worker；我们的
PM 承担了 PRD 编制与计划，这是 TNT 设计超出 dsh 的部分，也是"正式开发团队"
定位的体现。

### A2. 五条裁决印证表（它的独立实现验证了我们的裁决）

| 我们的裁决                                                | dsh 的对应实现与原文                                                                                                                                                                                                                                                                                       | 出处                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 主 agent 不戴 PM 帽，PM 真管理；主 agent 只受理/转派/转呈 | 路由器不扩权："Do not expand a request's scope, add implementation plans, acceptance criteria or policy checklists: workers derive requirements from the original source"；路由备注最多 30 个词（中文按分词计），只许写"routing background or explicit human constraints, not implementation instructions" | `prompts/dispatch.md:14`、`:47-48`  |
| PRD 是共享状态板，PM 单点写状态；执行/验证角色只读        | "Ticket state that follows the DSH Session" 被拒绝：工单会被多次派工、交接、恢复，状态必须由域内单点定义，不跟随任何一次执行会话                                                                                                                                                                           | `docs/001-domain.md` 拒绝概念表     |
| verification 只输出结构化判定，PM 机械转写                | "Inferring 'waiting on a person' from a report's free text" 被拒绝：分类需要结构化事实，Executor 通过结构化字段提问，不从自由文本推断状态                                                                                                                                                                  | `docs/001-domain.md` 拒绝概念表末条 |
| PRD 元数据存 goal 原文（不存转述）                        | "A routing note or ticket title never substitutes for the original context and cannot add implementation requirements"——路由摘要不能替代原文，worker 必须读原始触发消息                                                                                                                                    | `prompts/work.md:23`                |
| PRD §8 变更记录带影响评估                                 | "Cancelling running Tickets on a Policy change" 被拒绝：变更会留下半成品，正确做法是"记录变更并送达受影响的工单"                                                                                                                                                                                           | `docs/001-domain.md` 拒绝概念表     |

### A3. 已吸收进本设计的三项模式（落点与原文）

**1. 报告状态词汇表** → 正文第三部分第 6 点。dsh 把 worker 报告固定为六个
状态（`docs/001-domain.md:112`：progress 进展 / waiting 等待 / ready 就绪 /
blocked 受阻 / failed 失败 / dropped 无需处理），Report 的状态是结构化字段，
不靠自由文本描述。两条边界纪律直接借来：

- 存在未完成草稿不算 blocked：`prompts/work.md:44` "Use blocked only when
  implementation actually cannot proceed and a human must act, never merely
  because an unfinished PR exists"。未完成的 PR 只能报 blocked 如果有具体
  的人的行动项；否则报 progress。
- dropped 静默关闭：`prompts/work.md:45` "When the work ends with nothing for
  a human to do (not reproduced, not a defect, a decision already tracked
  elsewhere, no request), report dropped: it closes the ticket without a
  message, and a person's later message on its threads resumes it"。
  静默但不失联——后续消息可恢复。

**2. 人类注意力经济** → 正文第三部分第 7 点与第四部分受理纪律。出处
`docs/000-philosophy`（"Take as little human attention as possible, and give
as much value as possible"，每个消息/通知/提问都消耗注意力，必须产出大于
消耗）与 `prompts/team/communication.md`（"A PR merely existing is not a
delivery milestone"）。dsh 的完整推论清单：

- 只在三种情况向人发消息：结果就绪可用 / 需要人做决定 / 确定无法完成
  （`docs/000-philosophy:12`）。
- 每个请求确认一次，干活期间沉默，完成后写一次（同上 :12）。
- 一次只问一个具体问题，用结构化形式（同上 :13）。
- 按影响停止，不按投入停止：本地改动做到可评审为止，需要设计决策的停在
  清晰的问题上（同上 :14）。
- 诚实报告：草稿标注未完成，失败报失败，从不绕过限制来避免提问（同上 :15）。
- IM 送达由路由器独占，worker 不得自行发第二条（`prompts/work.md:18`）——
  对应我们"转呈权只在主 agent"。

**3. 确定性状态判定** → 正文第三部分第 8 点。出处 `docs/003-execution.md`
Ticket stages 表："Each open Ticket has one stage, determined by what it is
waiting for. Read the table from top to bottom; the first matching row wins."
阶段由"它在等什么"决定，表驱动、自上而下、首条命中即胜，完全确定性，无
任何 agent 主观判断。我们将同一规则套到 PRD 需求状态机上：状态由最新证据
推出，不由汇报措辞决定。

### A4. dsh 其他值得记住的机制（本次未吸收，但与 TNT 长期相关）

- **Mandate（授权）**：accept 授予的不可变记录（Policy 版本、范围 scope、
  强度 strength、匹配规则）。范围扩大 = 新工单；只有人的 stop 能撤销授权。
  → TNT 对应物的远期候选：PRD 条目隐含的授权（files 范围 + R 编号）显式化，
  防止 implementer 越界改 files 范围外的文件。v1 靠 brief 引用 R 编号表达。
- **Strength（强度）**：explicit 明确 / inferred 推断 / not admitted 三档，
  决定一个请求凭什么启动工作。→ TNT 对应：`/goal` 或用户明说 = explicit；
  偏好开关自动召集 = inferred（需要显式规则才允许）。语义同构，v1 不需要
  实现，但召集判定的信号锚定应保持"explicit 优先"。
- **幂等 accept**：accept 按 trigger ID 幂等，同一事件重复投递只建一个工单。
  → TNT 场景较轻（交互式会话，无双投递），但"goal 重设后 PM 收到的 brief
  应带轮次号"是同一思想的弱化版。
- **Eval 两层**：gate（确定性准入：谁、什么强度）与 assessment（模型研判）
  分离。→ 与我们"召集判定锚定可观察信号（确定性）+ 用户可覆盖（模型/人
  判断）"同构。
- **规则变更送达而非取消**：Policy 变更时给受影响的活跃工单发 policy-changed
  通知，不取消正在跑的工作（`docs/002-authorization.md`）。→ v1 对应 PRD
  变更记录 + 用户确认；v2 若做"流程中改 goal"，应沿用"通知 + 续跑"而不是
  "打断重开"。
- **Resume 语义**：被 drop 的工单，人的后续消息可在原 Mandate 下恢复，无需
  重新评估；被人的 stop 停止的工单则必须重新走 accept。→ TNT 对应：已搁置
  的 PRD（状态字段已有"已搁置"）应可被"继续做 X"恢复，而不必重写 PRD。
- **输入顺序保证**：同一工单到同一会话的消息按队列序发出，先确认后答复，
  前一条失败三次才让位（`docs/003-execution.md`）。→ v2 若做 mailbox，这是
  现成的设计答案。
- **"主 Session 不等待"纪律**：`docs/004-prompts.md:78` 报告/通知/后台任务
  结果都是自动到达的消息，主 Session 禁止 sleep/长等待（noWait guard 拒绝
  sleep、>30s 超时、>5s job 等待），因为阻塞的 step 会延迟新候选的处理。
  → TNT 主 agent 监控角色的同款纪律：监控靠收口消息驱动，不靠轮询。
- **面板只显示需要人的东西**："A healthy state takes no space"（`docs/000-
philosophy:21`）。→ v2 若做 PRD 状态面板/状态行，健康状态零占用。

### A5. 参照后明确不采纳的点

- **accept mode 三档（off/observe/auto）**：observe 档只记录"本会接受什么"
  而不真做，供人审查后再切 auto。它需要三档是因为异步值守队列误判成本高、
  事后审查是唯一纠错手段；TNT 召集是交互式会话内的即时决定，用户当场可
  纠正，布尔开关 + 默认 false（C 方案）已足够。**v2 候选**：若 `team.
autoConvoke` 开启后误召集频发，可加 observe 档（自动判定只记录到会话，
  不召集，用户可查"本会本会召集什么"）。
- **Per-Ticket 独立目录/worktree**：dsh 每工单一个目录一个 prepare 命令。
  TNT 的派发已有 files 范围机制，v1 不引入目录隔离。
- **Auto-merge 条款（<200 行自动合并等）**：属于 GitHub 交付特化，TNT 无
  对应物。
- **Worker slot 并发模型**：TNT 的 keyed 并行派发已覆盖 v1 需求。

### A6. dsh 文档地图（回查索引）

| 文件                                             | 内容                                                                                                                                                                                        | 与 TNT 的相关度                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/000-philosophy.md`                         | 注意力经济哲学；agent 行为推论（只被请求才行动、只在必要时说话、一次一个具体问题、按影响停止、诚实报告）；运营责任（先窄后宽、降噪、不刷量）                                                | 高（已吸收第 2 项模式）                                                            |
| `docs/001-domain.md`                             | 完整域模型：9 概念规则表（Source/Trigger/Thread/Eval/Mandate/Ticket/Assignment/Subscription/Channel）、12 条拒绝概念表（每条带理由）、中英术语表                                            | 高（裁决印证的主要出处）                                                           |
| `docs/002-authorization.md`                      | 准入两路（Eval vs Subscription 扇出）、强度表、admission 表、bot 规则、accept mode 与规则、Policy 版本、resume/stop/revalidate、Eval 超时处理                                               | 中（召集判定与 v2 的授权显式化参考）                                               |
| `docs/003-execution.md`                          | Ticket stages 表（本设计状态判定规则的出处）、Executor 会话与目录、后台 30 分钟上限、并发 slot、prepare、合并规则、失败/恢复/重试/重启、消息顺序保证                                        | 高（已吸收第 3 项模式）                                                            |
| `docs/004-prompts.md`                            | 提示词组装顺序与优先级（工具事实 > 内置段 > 规则要求 > 团队段 > 外部文本）、内置部件 override 机制、版本化、"主 Session 不等待"纪律、15 条内置文本原则                                      | 中高（受理纪律注入的措辞参考；优先级列表对 agent-discipline 的写法有直接参考价值） |
| `docs/005-panel.md`                              | 管理面板设计（仅显示需人处理的事项）                                                                                                                                                        | 低（v2 面板参考）                                                                  |
| `docs/006-deployment.md`                         | 部署配置                                                                                                                                                                                    | 低                                                                                 |
| `docs/007-architecture.md`                       | 实现架构：Runtime/Engine（五部件 Intake/Evals/Tickets/Assignments/Replies）、Effects 队列、Outbox、单写者规则、请求/事实命名约定、SQLite 表、模型面（主 Session 14 工具 / Executor 6 工具） | 中（v2 若做流程引擎可参考其"单写者、事务性命令、effects 队列"三件套）              |
| `docs/008-cookbook.md`                           | 加 Source 的 11 步教程（稳定 ID、scope、Channel 幂等发送、线程上下文、测试模式）                                                                                                            | 低                                                                                 |
| `prompts/dispatch.md`                            | 路由器行为：accept/attach/stop/ignore 四决定、幂等、30 词备注、"不扩权"裁决原文、IM 送达独占                                                                                                | 高（裁决印证 + 已吸收）                                                            |
| `prompts/work.md`                                | worker 行为：范围自查、报告契约（六状态 + PR 纪律）、blocked/dropped 边界、"读原文不读转述"                                                                                                 | 高（已吸收第 1 项模式）                                                            |
| `prompts/orchestrator.md`                        | 主 Session 角色定义                                                                                                                                                                         | 中                                                                                 |
| `prompts/team/{scope,delivery,communication}.md` | 团队可编辑三节：工单范围、交付要求、沟通规范（注意力经济的操作化文本）                                                                                                                      | 中高（PM 提示词升级的参考格式）                                                    |
| `src/` 实现                                      | admission.ts / core/（Engine 五部件）/ executor/ / sources/ 等；架构职责在 `docs/007-architecture.md` 的模块表已完整覆盖，无需逐文件阅读                                                    | 低（实现期需要才查）                                                               |

### A7. 阅读顺序建议（后续会话恢复上下文用）

1. 先读本附录 A1-A3（结论与落点）。
2. 需要裁决原文时查 A2 表中的 file:line，直接读 dsh 仓库对应文件。
3. 写实现计划时按 A6 地图按需取用；`docs/004-prompts.md` 的优先级列表
   建议在写 agent-discipline.md 第 8 节前重读一遍。
