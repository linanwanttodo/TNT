# 研究员 agent（research）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增通用内置 agent `research`（信息搜集角色），dev 和 sec 两个默认花名册各引用它，WebSearch 对所有角色放行。

**Architecture:** 全走既有机制，无新抽象——builtInAgents.ts 注册表加一项（ModelService.getSubagentModels 的继承循环自动合成会话模型条目）；defaultTeams.ts 各队加 builtInRef 成员；defaultPolicies.ts 三张表的 WebSearch ask→allow；docs 同步更新。

**Tech Stack:** TypeScript / vitest，同 packages/cli 现状。

**Spec:** `.tnt/superpowers/specs/2026-11-01-research-agent-design.md`

## Global Constraints

- 内置 agent 约束不变式：所有内置角色 `deniedTools` 恒为 `["AskQuestion", "Exit"]`（builtInAgents.test.ts 已有全量断言）。
- builtInRef 成员不复制 prompt，restriction/deniedTools 留空由注册表解析（与 debug/shell/explore 行一致）。
- description 长度 > 40，systemMessage 长度 > 200（既有守卫测试）。
- 搜索走本地免费 DuckDuckGo Lite（webSearch.ts 现状），不接付费 API。
- 派生表行标注 prompt 派生自 docs/agent-discipline.md 的哪些节；prompt 内引用同格式（"工作纪律派生自……"仅用于团队 prompt，内置英文 prompt 参照既有内置 agent 行文，不用标注）。
- 测试从 packages/cli 运行：`npx vitest run <path>`。
- 无 emoji；提交信息以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。

## Review Focus

- **既有计数断言**：dev 12→13、sec 5→6、"Eight roles ship"——每个钉住数量的断言都要跟着新行为变红再绿，不许只改数字绕过。
- **dontAsk 派生表**：WebSearch 放行后，dontAsk 模式（headless/serve）下 WebSearch 从 exclude 变为可用——确认这是期望行为（无人的会话也能搜）还是应保留 exclude。
- **文档双向断言**：subagents.mdx 的"every listed role is implemented, every implemented role is listed"守卫，代码加角色而文档没加（或反之）都在提交时被抓。
- **派生表完整性**：agent-discipline.md 加行后，prompt 里的"派生自"引用与表格保持一致（dev/sec 团队 prompt 有中文标注，内置英文 prompt 不标注——research 用英文 prompt，因此只加表行，不改 prompt 文本）。
- **权限语义**：default 表和 acceptEdits 表的 WebSearch allow 意味着任何角色（含 implementer）无提示搜索；plan 模式本已 allow。

---

### Task 1: RESEARCH_AGENT 注册进内置注册表

**Files:**

- Modify: `packages/cli/src/subagent/builtInAgents.ts`（在 BEST_OF_N_AGENT 之后加 RESEARCH_AGENT，追加进 BUILT_IN_AGENTS 数组）
- Test: `packages/cli/src/subagent/builtInAgents.test.ts`
- Modify: `docs/cli/subagents.mdx`、`docs/zh/cli/subagents.mdx`（角色表加一行，"Eight roles ship with the CLI" 改 Nine；zh 同步"八个角色"→"九个角色"）

**Interfaces:**

- Consumes: 无（独立起点）。
- Produces: `RESEARCH_AGENT: BuiltInAgentDefinition`（name `"research"`，restriction `"no-writes"`，deniedTools `["AskQuestion", "Exit"]`），并出现在 `BUILT_IN_AGENTS` 数组——后续任务经 `builtInAgentByName("research")` 消费。

- [ ] **Step 1: 写失败测试**（builtInAgents.test.ts，逐条新增）

```typescript
it("answers research questions with cited sources and marked inference", () => {
  expect(RESEARCH_AGENT.restriction).toBe("no-writes");
  expect(RESEARCH_AGENT.systemMessage).toMatch(/cannot create or modify files/);
  // Every finding carries where it came from; a claim without a source is
  // not reported.
  expect(RESEARCH_AGENT.systemMessage).toContain("Source");
  expect(RESEARCH_AGENT.systemMessage).toContain("Confidence");
  expect(RESEARCH_AGENT.description).toContain("sources");
});
```

并把第一只测试的期望数组加 `"research"`（插在 `"best-of-n"` 后）、加 `import { RESEARCH_AGENT }`、`expect(builtInAgentByName("research")).toBe(RESEARCH_AGENT);`。

- [ ] **Step 2: 跑红**

Run: `npx vitest run src/subagent/builtInAgents.test.ts`
Expected: FAIL — "answers research questions..." 缺 RESEARCH_AGENT 导出（编译错也认，重跑确认非编译错即红）；同时 "offers the eight roles..." 因数组不匹配而红。

- [ ] **Step 3: 实现 RESEARCH_AGENT**

在 builtInAgents.ts BEST_OF_N_SYSTEM_MESSAGE 之后加：

```typescript
const RESEARCH_SYSTEM_MESSAGE = `You are a research agent. You gather information from the web and the workspace and report what the sources say; you cannot create or modify files.

Evidence first: every claim names its source - a URL you fetched or searched, or a file path you read - so the caller can check it. Search with WebSearch, fetch pages with Fetch, and quote the passage the claim rests on rather than paraphrasing it. Separate what a source states from what you infer from it; label each finding's confidence: confirmed (the source says it directly), corroborated (two or more independent sources agree), or uncertain (one source, or sources that conflict).

When sources conflict, report both sides and say which looks more current. When you cannot verify something, say so in the findings instead of filling the gap with a guess.

Return:
- Findings: each as statement, Source (URL or path), Confidence (confirmed / corroborated / uncertain).
- Not verified: what you could not confirm and what would settle it.
- Next step: the single question this research leaves open, if any.`;

export const RESEARCH_AGENT: BuiltInAgentDefinition = {
  name: "research",
  description:
    "Gathers information from the web and the workspace: searches, fetches pages, and reports findings with cited sources and per-finding confidence. Use it for external facts the codebase cannot answer.",
  restriction: "no-writes",
  deniedTools: ["AskQuestion", "Exit"],
  systemMessage: RESEARCH_SYSTEM_MESSAGE,
};
```

BUILT_IN_AGENTS 数组末尾（BEST_OF_N_AGENT 后）追加 `RESEARCH_AGENT,`。

- [ ] **Step 4: 跑绿**

Run: `npx vitest run src/subagent/builtInAgents.test.ts`
Expected: PASS 全绿（含 docs 双向守卫测试会红——所以文档改动属于本任务）。

- [ ] **Step 5: 更新两份 docs**

docs/cli/subagents.mdx：标题段 "Eight roles ship with the CLI" → "Nine roles ship with the CLI"；表加行（放在 best-of-n 之后）：

```
| `research`        | Gathers web and workspace information and reports findings with cited sources                   | Edit files                               |
```

docs/zh/cli/subagents.mdx："八个角色" → "九个角色"；表格加对应行（en 与 zh 成对更新）。

- [ ] **Step 6: 全测试文件绿 + lint**

Run: `npx vitest run src/subagent/builtInAgents.test.ts && npx eslint src/subagent/builtInAgents.ts src/subagent/builtInAgents.test.ts`
Expected: PASS，0 lint 错误。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/subagent/builtInAgents.ts packages/cli/src/subagent/builtInAgents.test.ts docs/cli/subagents.mdx docs/zh/cli/subagents.mdx
git commit -m "Add the research built-in agent"
```

---

### Task 2: dev、sec 花名册加 research 成员

**Files:**

- Modify: `packages/cli/src/team/defaultTeams.ts`（buildDev、buildSec 各加一个 member）
- Test: `packages/cli/src/team/defaultTeams.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `builtInAgentByName("research")` 返回已定义。
- Produces: DEFAULT_TEAMS 的 dev 队 13 成员、sec 队 6 成员，各含 `name: "research"`、`builtInRef: "research"`、restriction/deniedTools 留空。

- [ ] **Step 1: 写失败测试**（defaultTeams.test.ts，改两个测试的期望清单与计数）

dev 测试：成员数组加 `"research"`，`toHaveLength(12)` → `toHaveLength(13)`，测试名 "twelve members" → "thirteen members"。
sec 测试：成员数组加 `"research"`，测试名 "its five members" → "its six members"。

- [ ] **Step 2: 跑红**

Run: `npx vitest run src/team/defaultTeams.test.ts`
Expected: FAIL — dev 与 sec 两个测试（成员缺失）。

- [ ] **Step 3: 实现**（defaultTeams.ts）

buildDev 的 best-of-n member 之后、`const lead` 之前加：

```typescript
    member("dev", {
      name: "research",
      description: "信息搜集：外部事实、库行为、公开资料，带来源与置信度。",
      lead: false,
      builtInRef: "research",
      systemMessage: "",
    }),
```

buildSec 的 shell member 之后、`const lead` 之前加：

```typescript
    member("sec", {
      name: "research",
      description: "公开情报搜集：漏洞库、公开报告，带来源与置信度。",
      lead: false,
      builtInRef: "research",
      systemMessage: "",
    }),
```

（restriction/deniedTools 不写——注册表解析，与 debug/shell/explore 行一致。）

- [ ] **Step 4: 跑绿**

Run: `npx vitest run src/team`
Expected: PASS（loader.test.ts 的合并测试不受影响——它写的是自定义队）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/team/defaultTeams.ts packages/cli/src/team/defaultTeams.test.ts
git commit -m "Reference the research agent from the dev and sec rosters"
```

---

### Task 3: WebSearch 放行

**Files:**

- Modify: `packages/cli/src/permissions/defaultPolicies.ts`（default 表第 35 行、acceptEdits 表第 155 行：`permission: "ask"` → `permission: "allow"`；plan 表第 107 行已 allow 不动）
- Test: `packages/cli/src/permissions/defaultPolicies.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces: getDefaultToolPolicies() 与 ACCEPT_EDITS_MODE_POLICIES 返回的 WebSearch 条目 permission 为 "allow"；DONT_ASK_MODE_POLICIES（派生表）随之变 allow（headless 会话也能搜——搜索无写入面，与 Fetch 同级）。

- [ ] **Step 1: 写失败测试**（defaultPolicies.test.ts 追加）

```typescript
it("allows WebSearch everywhere: searching is not a dangerous action", () => {
  const byName = (policies: ToolPermissionPolicy[]) =>
    policies.find((p) => p.tool === "WebSearch")?.permission;
  expect(byName(getDefaultToolPolicies())).toBe("allow");
  expect(byName(ACCEPT_EDITS_MODE_POLICIES)).toBe("allow");
  expect(byName(PLAN_MODE_POLICIES)).toBe("allow");
  expect(byName(DONT_ASK_MODE_POLICIES)).toBe("allow");
});
```

（按该文件既有的 import 风格补齐导入。）

- [ ] **Step 2: 跑红**

Run: `npx vitest run src/permissions/defaultPolicies.test.ts`
Expected: FAIL — default 与 acceptEdits 返回 "ask"。

- [ ] **Step 3: 实现**

defaultPolicies.ts 两处 `{ tool: "WebSearch", permission: "ask" }` 改为 `permission: "allow"`（default 表处可加行尾注释 `// Searching is not a dangerous action; Fetch is the sibling allow.`，acceptEdits 处同样）。

- [ ] **Step 4: 跑绿 + 权限面回归**

Run: `npx vitest run src/permissions`
Expected: PASS（含 toolPolicyCoverage、policyNameCoverage、modesDoc、headlessPermissions 集成测试——若有测试断言 WebSearch 会弹审批，那是行为变化被测试钉住，按新行为更新该断言并注明）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/permissions/defaultPolicies.ts packages/cli/src/permissions/defaultPolicies.test.ts
git commit -m "Allow WebSearch in the default and acceptEdits policies"
```

---

### Task 4: 派生表加 research 行

**Files:**

- Modify: `docs/agent-discipline.md`（派生关系表末尾加一行）

**Interfaces:**

- Consumes: Task 1 的 research prompt 存在。
- Produces: 派生表覆盖所有角色。

- [ ] **Step 1: 失败不存在（文档单点改动），直接实现**

表末尾（"explore / shell / best-of-n" 行后）加：

```
| research                               | 1、7                                    |
```

（research 的 prompt 是英文内置 prompt，不引用"工作纪律派生自"中文标注；表行记录其派生节：证据优先（1）与结构化收口（7）。）

- [ ] **Step 2: 验证格式**

Run: `npx prettier --check docs/agent-discipline.md`（从仓库根）
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add docs/agent-discipline.md
git commit -m "Record the research role in the discipline derivation table"
```

---

### Task 5: 全套件收口

- [ ] **Step 1: 全套测试**

Run（从 packages/cli）: `npx vitest run`
Expected: 全绿。

- [ ] **Step 2: lint 与 tsc**

Run: `npx eslint src/subagent/builtInAgents.ts src/team/defaultTeams.ts src/permissions/defaultPolicies.ts && npx tsc --noEmit -p tsconfig.json`
Expected: 0 错误。

- [ ] **Step 3: 无额外提交**（各任务已带提交；本任务只验证）
