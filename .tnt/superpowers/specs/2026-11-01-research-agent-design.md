# 研究员 agent（research）设计

状态：待批准。规模：small change（短设计）。规格依据：2026-10-31 会话中用户口头批准的方案 + 本文档的通用化修订。

## 意图

TNT 的两个默认专家团（dev、sec）缺一个"搜集信息"的角色：需求分析要外部事实（库版本、API 行为、已知 CVE），安全审计要公开情报（漏洞库、公开报告）。这些活现在落在主 agent 或 explore 身上，explore 只读代码库、不碰网。

研究员（research）是和 shell、explore 一样的**通用内置 agent**：定义一次（BUILT_IN_AGENTS 注册表），任何专家团按需用 `builtInRef: "research"` 引用。dev 和 sec 两个默认花名册都放上它。

## 目标

1. 新内置 agent `research`：evidence-first 调研纪律——结论必须有可引用来源（URL 或文件路径）、事实与推断分离、无法验证的显式记 unknown。
2. dev、sec 两个默认花名册各加一个 `builtInRef:"research"` 成员（不复制 prompt，按引用解析——Task 4 既有机制）。
3. WebSearch 放行：搜索不是危险行为，所有角色都能搜、不弹审批。搜索走本地免费通道（webSearch.ts 现状：DuckDuckGo Lite HTML 抓取），不接付费 API；用户说的 fetch 抓网页（Fetch 已是 allow，不动）。
4. docs/agent-discipline.md 派生关系表加 research 行。

## 非目标

- 不接付费搜索 API（Brave、Serper、Google CSE 等）。本地 Lite 通道是基础；以后要接再说。
- 不改 explore 的定位（它是代码库地图，research 是外部信息）。
- 不给 research 单独的模型配置——继承会话模型，和其他内置 agent 一致。

## 方案（已选）

沿用内置 agent 既有机制，无新抽象：

- `builtInAgents.ts` 加 `RESEARCH_AGENT`，restriction `no-writes`，deniedTools `["AskQuestion", "Exit"]`，注册进 BUILT_IN_AGENTS。ModelService.getSubagentModels 的继承循环自动为它合成会话模型条目，无需改 ModelService。
- `defaultTeams.ts` dev 和 sec 各加一个 member（name: "research"，builtInRef: "research"，restriction/deniedTools 留空由注册表解析——与 debug/shell/explore 行一致）。
- `defaultPolicies.ts`：三张表里 WebSearch 从 `ask` 改 `allow`（default、acceptEdits；plan 模式已是 allow 不动）。dontAsk 派生表自动跟随。
- `docs/agent-discipline.md` 派生表加 `research | 1、7` 行（证据优先 + 结构化收口）。

被否的方案：给每个团队复制一份 researcher markdown 花名册（违反 builtInRef 复用设计，prompt 会漂移）；只加进 dev 不加 sec（用户明确说两个团都要）。

## 留给实现者的

- RESEARCH_SYSTEM_MESSAGE 的正文措辞（收口格式 = 发现 + 来源 + 置信度，参照 verification/explore 的行文风格）。
- 测试：花名册成员数变化会牵动既有计数断言，按 TDD 先红后绿。
- description 文案（listing 工具显示 + 派发提示）。

## 风险

- dev 队成员数 12 → 13，sec 队 5 → 6；既有测试若钉住数字需同步更新（这本身就是行为变化的证明）。
- WebSearch 放行是权限语义变化：任何角色（含 implementer）可无提示搜索。用户已明确批准"不危险，可以全部允许"。
