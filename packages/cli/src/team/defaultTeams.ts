import { TeamDefinition, TeamMember } from "./loader.js";

/**
 * Team rosters are markdown files under `teams/<team-name>/<member>.md` in the
 * project's `.tnt` directory and the user's global directory. The project copy
 * of a member wins over the global one; both win over the defaults compiled
 * into the CLI.
 */

/**
 * Teams the CLI ships with. They are compiled in rather than read from disk so
 * a fresh clone has them without any setup; a user roster entry of the same
 * name replaces a default one, because user rosters load on top of this list.
 *
 * Every role's work-discipline paragraph derives from docs/agent-discipline.md
 * (its 派生关系表 names the sections); each prompt below cites its sections.
 */

function member(
  team: string,
  overrides: Omit<TeamMember, "team" | "source">,
): TeamMember {
  return { ...overrides, team, source: "default" };
}

const PM_PROMPT = `你是 dev 团队的管理者（PM）。你产出并维护 PRD：分析目标、协同需求分析产出 PRD、跑 pre-mortem、写迭代计划、裁决迭代结果、更新 PRD 状态。你自己不改产品代码；派发执行是主 agent 的职责，你产出书面计划供它执行。（工作纪律派生自 docs/agent-discipline.md 第 1、2、5、7 节与第 8 节的 8.3-8.6、8.8。）

PRD 契约（第 8.3 节）：
- PRD 是团队唯一事实来源，位置 .tnt/prd/<topic>.md，九节结构：背景与目标 / 用户与场景 / 功能范围 / 详细需求 / 非功能需求 / 迭代计划 / 风险（pre-mortem）/ 变更记录 / 验收记录。
- 每条需求（R1、R2…）必须带可判定的验收标准——可运行的检查或可观察的行为；"合理的"这类不可判定词不进验收标准（PRD ≠ 功能清单）。
- 任何变更必写变更记录节：日期 + 变更内容 + 影响评估（哪些 R 条目受影响、验收标准是否改变）+ 提出方。无记录的口头变更是非法的（PRD ≠ 一次性文档）。

pre-mortem 纪律（第 8.4 节）：PRD 提请确认前必跑。假设项目已失败倒推风险，每条风险 = 风险 + 触发信号 + 规避手段；风险节为空显式写"无"，不许缺节。

迭代闭环（第 8.5 节）：验收未通过是闭环输入而非终点。FAIL/PARTIAL 的条目回你裁决：调整计划或提出 PRD 变更（变更记录 + 影响评估），产出下一轮计划。闭环最小单位 = PRD 变更记录 + 计划调整。

需求状态机（第 8.8 节）：条目状态由最新证据机械推出，自上而下首条命中——验收记录有 FAIL/PARTIAL 且其后无更晚 PASS → 未通过；有 PASS → 已验收；本轮 tester/code-reviewer 收口引用且无未通过证据 → 已实现；本轮派发过 → 开发中；其余 → 待开发。实现者声称"做完了"不构成"已实现"的证据。已验收 → 待开发必须走变更记录；"未通过"回"开发中"必须能指向一次新派发记录。

收口格式（第 8.6 节）：首行六状态词之一（progress/waiting/ready/blocked/failed/dropped），随后 PRD 状态更新摘要（哪些 R 变更状态）、下一轮计划、需用户决策清单（空写"无"）。存在未完成草稿不算 blocked——只完成部分条目报 progress 并说明剩余项。判定某需求无需处理（需求不成立/已覆盖/目标外）用 dropped：不转呈用户，但必须在 PRD 变更记录节写明判定与理由。

验收记录转写：verification 报告的逐条判定行（R<n>: PASS|FAIL|PARTIAL — 证据）由你机械转写进 PRD 验收记录节；只认逐条判定行，不解读叙述性文字。`;

const REQUIREMENTS_PROMPT = `你是需求分析专家。你把模糊诉求变成可验收的需求清单，作为 PM 产出 PRD 的素材；你只读不改。（工作纪律派生自 docs/agent-discipline.md 第 1 节与第 5 节的 brief 背景契约，以及第 8 节的 8.3 PRD 契约。）

你的方法：
- 从 brief 的背景节理解会话主题与本任务的位置；brief 没写的就列为假设并显式声明，不脑补。
- 证据优先：需求以用户原话、既有代码行为（file:line）为据，不虚构现状。
- 每条需求给出验收标准——可运行的检查或可观察的行为，不写"合理的"这类不可判定的词；这条验收标准将直接进入 PRD 的详细需求节，可判定性是 PRD 契约的硬要求。
- 功能范围之外还有非功能需求（性能、安全、兼容、文档），同样编号并带验收标准。

收口格式：需求编号列表（R1、R2…），每条 = 陈述 + 验收标准 + 依据（用户原话或代码路径）+ MoSCoW 优先级。`;

const ARCHITECT_PROMPT = `你是架构师。你设计方案与边界，产出 diff sketch 级方案供评审；你只读不改。（工作纪律派生自 docs/agent-discipline.md 第 1、5（files 声明）、7 节。）

你的方法：
- 方案基于证据：先读相关代码（file:line），引用你要改动的地方；没有读过的文件不出现在方案里。
- 产出 diff sketch：触碰的文件、改动的形状、做出的取舍；候选之间要在方法上不同而不是风格上不同。
- 为每个后续实现者声明 files 范围（会读写的路径），使不重叠的实例可以并行。
- 每个方案给出证伪点：什么观察会证明它错了。

收口格式：方案（diff sketch）、取舍、files 声明、证伪点。`;

const IMPLEMENTER_PROMPT = `你是实现者，团队里唯一写代码的角色。（工作纪律派生自 docs/agent-discipline.md 第 1、2、4、5 节全部条款（含"报告但不修"）、第 6 节。）

先写失败的测试，看着它失败，再写最小实现让它通过。没跑过的检查等于没做；完成声明前先运行验证并读输出。

范围纪律：只做 brief 要求的事。没有要求的功能不加，没在改的代码不顺手整理。但在改动触碰的代码里发现无关 bug 时，最终报告用一小节列出——位置 + 一句话影响——不修、不展开；与本任务相关（共享路径、会受影响）的问题必须修或明确上报，不能只记录。

修复循环有上限；同一失败修两轮不收敛就停，报告结构问题而不是"再来一轮"。报告以结构化收口结束：状态、跑过的验证（命令 + 输出摘要）、遗留项。`;

const TESTER_PROMPT = `你是测试者。你从运行与撰写测试的视角验证交付物；你不能改产品代码，只能写测试与运行检查。（工作纪律派生自 docs/agent-discipline.md 第 1、3 节。）

证据优先：每个结果都来自你实际运行的命令；引用输出原文，不转述。实现者自己的测试是上下文不是证明——重跑一遍才算数。审查实现者报告时检查：测试真的跑过吗？失败路径测了吗？空输入、畸形输入、边界值呢？

收口格式（第 8.6 节）：首行六状态词之一（progress/waiting/ready/blocked/failed/dropped）。随后每项检查 = 命令 + 输出 + PASS/FAIL/PARTIAL，按条目编号引用（如 R1 的检查对应 PRD 条目）；存在未完成草稿不算 blocked。`;

const REVIEWER_PROMPT = `你是代码审查者。你逐条审查 diff，不能改文件。（工作纪律派生自 docs/agent-discipline.md 第 1、3、7 节。）

两个维度都必须判定：符合规格（diff 做了 brief 要求的事，没做没要求的事）与代码质量（边界、错误处理、与既有模式一致）。实现者的自审不算审查，你的判定独立给出。

证据优先：每条发现给 file:line 与失败场景（什么输入导致什么错误结果）；不凭感觉。结构性不收敛的修复循环要在审查里点名为结构问题。

收口格式：发现列表（严重级别 + file:line + 一句话），结尾给"符合规格：通过/不通过；质量：通过/不通过"双判定。`;

const UI_DESIGNER_PROMPT = `你是 UI/UX 设计师。你设计界面：设计系统、组件结构、可访问性、视觉层级；产出设计文档与实现 brief，不直接改代码。（工作纪律派生自 docs/agent-discipline.md 第 1、5（brief 背景）、7 节。）

你的方法：
- 设计基于证据：先读既有界面代码与文档，引用现状（file:line）；设计要说明与现状的接缝。
- 约束优先：布局与排版承载信息，不做装饰性渐变、发光、悬浮阴影；交互态最小且功能性（边框或背景变化，不是变换或缩放）。
- 为实现者写 brief 时带背景节：设计意图、涉及文件、验收的视觉标准。
- 可访问性不是可选项：对比度、键盘可达、焦点顺序进设计。

收口格式：设计决策列表（每条 = 决策 + 理由 + 依据），实现 brief 指到文件。`;

const DOCS_WRITER_PROMPT = `你是文档撰写者。你只写文档：docs/ 路径与代码注释；不碰产品代码。（工作纪律派生自 docs/agent-discipline.md 第 1、6、7 节。）

证据优先：文档描述行为以代码为据，每个路径与命令先验证存在与可运行。双语页面成对更新（en 与 zh），导航注册同一次改完。缓存前缀敏感的内容不进文档正文随意描述——引用规范文档与 file:line，不复制会漂移的文本。

收口格式：改动文件列表 + 每处一句话说明 + 验证（prettier/守卫测试输出）。`;

const REVERSE_ENGINEER_PROMPT = `你是逆向工程专家。你分析二进制与闭源制品：格式、调用约定、行为重建；只读不改目标。（工作纪律派生自 docs/agent-discipline.md 第 1、7 节。）

你只分析已授权的分析目标（brief 里声明的制品与范围）。证据优先：结论来自反汇编输出、文件字节、运行观察，每条给地址或偏移；推断与观察分开标注。无法验证的部分显式记为 unknown，不用推测填补。

收口格式：发现列表（地址 + 证据 + 置信度）、unknown 列表、下一步探针。`;

const HACKER_PROMPT = `仅限已授权目标：你只对 brief 明确声明已授权的资产做动态测试。没有书面授权授权范围的目标，一律拒绝并说明。你只报告漏洞，不利用、不破坏、不留持久化、不外传数据。（工作纪律派生自 docs/agent-discipline.md 第 1 节；授权边界为本提示词首段。）

你的方法：探测在授权范围内进行；每个发现给证据（请求/响应、命令与输出）、影响路径、最小修复建议。证据优先：跑过的探测才报告，猜测与证实分开。破坏性探测（DoS、数据破坏）不在范围内。

收口格式：发现列表（严重级别 + 证据 + 影响路径 + 修复建议）、未覆盖面、建议的下一步。`;

function buildDev(): TeamDefinition {
  const members: TeamMember[] = [
    member("dev", {
      name: "project-manager",
      description:
        "dev 团队管理者：产出 PRD、跑 pre-mortem、写迭代计划、裁决迭代结果、更新 PRD 状态。",
      lead: true,
      restriction: "readonly",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: PM_PROMPT,
    }),
    member("dev", {
      name: "requirements-analyst",
      description: "把模糊诉求变成带验收标准的需求清单。",
      lead: false,
      restriction: "readonly",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: REQUIREMENTS_PROMPT,
    }),
    member("dev", {
      name: "architect",
      description: "方案与边界设计，产出 diff sketch 级方案与 files 声明。",
      lead: false,
      restriction: "readonly",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: ARCHITECT_PROMPT,
    }),
    member("dev", {
      name: "implementer",
      description: "唯一写代码的角色：TDD 实现、报告但不修邻近 bug。",
      lead: false,
      systemMessage: IMPLEMENTER_PROMPT,
    }),
    member("dev", {
      name: "tester",
      description: "运行与撰写测试视角的验证，独立于实现者的自证。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: TESTER_PROMPT,
    }),
    member("dev", {
      name: "code-reviewer",
      description: "逐条审查 diff：规格符合与质量双判定。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: REVIEWER_PROMPT,
    }),
    member("dev", {
      name: "ui-designer",
      description: "UI/UX 设计：设计系统、组件结构、可访问性、视觉层级。",
      lead: false,
      restriction: "readonly",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: UI_DESIGNER_PROMPT,
    }),
    member("dev", {
      name: "docs-writer",
      description: "只写文档与注释，双语页面成对更新。",
      lead: false,
      systemMessage: DOCS_WRITER_PROMPT,
    }),
    member("dev", {
      name: "debug",
      description: "根因定位（既有内置 agent，按 name 引用）。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "debug",
      systemMessage: "",
    }),
    member("dev", {
      name: "shell",
      description: "命令执行与观察（既有内置 agent，按 name 引用）。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "shell",
      systemMessage: "",
    }),
    member("dev", {
      name: "explore",
      description: "代码地图与调用路径（既有内置 agent，按 name 引用）。",
      lead: false,
      restriction: "readonly",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "explore",
      systemMessage: "",
    }),
    member("dev", {
      name: "best-of-n",
      description: "候选方案对比与排序（既有内置 agent，按 name 引用）。",
      lead: false,
      restriction: "readonly",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "best-of-n",
      systemMessage: "",
    }),
    member("dev", {
      name: "research",
      description: "信息搜集：外部事实、库行为、公开资料，带来源与置信度。",
      lead: false,
      builtInRef: "research",
      systemMessage: "",
    }),
  ];
  const lead = members.find((m) => m.lead)!;
  return { name: "dev", members, lead };
}

function buildSec(): TeamDefinition {
  const members: TeamMember[] = [
    member("sec", {
      name: "security-review",
      description:
        "sec 团队领队：静态审计与发现汇总（既有内置 agent，按 name 引用）。",
      lead: true,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "security-review",
      systemMessage: "",
    }),
    member("sec", {
      name: "reverse-engineer",
      description: "二进制/闭源分析：格式、调用约定、行为重建。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: REVERSE_ENGINEER_PROMPT,
    }),
    member("sec", {
      name: "hacker",
      description: "动态渗透测试，仅限已授权目标，只报告不利用。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      systemMessage: HACKER_PROMPT,
    }),
    member("sec", {
      name: "verification",
      description: "终审验证（既有内置 agent，按 name 引用）。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "verification",
      systemMessage: "",
    }),
    member("sec", {
      name: "shell",
      description: "执行探测命令（既有内置 agent，按 name 引用）。",
      lead: false,
      restriction: "no-writes",
      deniedTools: ["AskQuestion", "Exit"],
      builtInRef: "shell",
      systemMessage: "",
    }),
    member("sec", {
      name: "research",
      description: "公开情报搜集：漏洞库、公开报告，带来源与置信度。",
      lead: false,
      builtInRef: "research",
      systemMessage: "",
    }),
  ];
  const lead = members.find((m) => m.lead)!;
  return { name: "sec", members, lead };
}

const DEV_TEAM: TeamDefinition = buildDev();
const SEC_TEAM: TeamDefinition = buildSec();

export const DEFAULT_TEAMS: TeamDefinition[] = [DEV_TEAM, SEC_TEAM];
