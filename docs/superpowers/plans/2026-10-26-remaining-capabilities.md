# Remaining Capability Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents on this repository; the owner requires a single writer. The exception is the workflow in Task 2, which runs only after the owner explicitly approves that run. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining install/config noise, land the capability work already in the tree, finish the seven-dimension gap analysis (including its workflow), and retire the open P1/P2 items with measured evidence.

**Architecture:** Three tracks. Track A is delivery: commit/push the completed tool and config work, then verify the installed binary. Track B is analysis: repair the supplied seven-chain workflow so it is replayable, run it (or run the four open dimensions manually), and complete the closed-source comparison. Track C is measurement/backlog: real-key cache A/B, then an audit that turns the remaining P2 list into its own TDD plan. No new subsystems are introduced in this plan.

**Tech Stack:** TypeScript, vitest, the CLI's own agent loop, the workflow DSL (`agent` / `phase` / `report` / `artifact` / `log`), SQLite FTS5 + LanceDB (existing), LSP, and static bundle inspection.

**Spec:** `HANDOFF-PRODUCT-GAP-ANALYSIS.md` (§4–§9, Appendix A), `PRODUCT-GAP-ANALYSIS-2026-10-24.md`, and the workflow script supplied as a message attachment on 2026-10-26.

## Global Constraints

- No reference-product names in code comments, docs, filenames or commit messages; neutral wording only.
- Conventional commits; every commit starts from green gates: `npx vitest run`, `npx tsc --noEmit`, `npx eslint`.
- User-visible copy is added in both `en` and `zh` (`packages/cli/src/i18n/index.ts` or the paired docs page).
- Closed-source artifacts are read only; never execute them. Use `rg -a` / `strings` / file reads.
- Do not scan the disk or environment for credentials; use only a key the owner supplies or authorizes.
- One writer on this repository; no subagent dispatch from this session. The workflow itself may dispatch its own agents only after the owner approves the run.
- Every threshold changed from a reference default is re-derived from TNT's own measurements and recorded in the commit body.

---

### Task 1: Land the install/config fix and the pending capability work

**Files:**
- Modify: `packages/cli/src/config/settings.ts`
- Modify: `packages/cli/src/config/settings.test.ts`
- Modify: `docs/cli/troubleshooting.mdx`
- Modify: `docs/zh/cli/troubleshooting.mdx`
- Stage: the DocumentSymbol / ImportGraph / MCP documentation files already modified or untracked in the working tree.

**Interfaces:**
- Consumes: nothing.
- Produces: `loadSettings()` still drops `model`/`models`; it now logs at debug instead of warn. No signature change.

- [x] **Step 1: Verify the config fix is green**

Run: `cd packages/cli && npx vitest run src/config/settings.test.ts`
Expected: 7 tests pass, including “drops model fields without an alarming warning”.

- [x] **Step 2: Verify the installed configuration really loads**

Run the probe against `~/.tnt/config.yaml` (no provider call):

```bash
cd packages/cli
cat > .tmp-config.ts <<'EOF'
import { ConfigHandler } from "core/config/ConfigHandler.js";
import FileSystemIde from "core/util/filesystem.js";
import { LLMLogger } from "core/llm/logger.js";
import { localPathToUri } from "core/util/pathToUri.js";
const ide = new FileSystemIde(localPathToUri(process.cwd()), "cli");
const handler = new ConfigHandler(ide, new LLMLogger());
const result = await handler.loadConfig();
console.log(JSON.stringify({
  errors: result.errors,
  chatModels: result.config?.modelsByRole?.chat?.map((m: any) => m.title) ?? [],
  selected: result.config?.selectedModelByRole?.chat?.title ?? null,
}, null, 2));
EOF
npx tsx .tmp-config.ts
rm .tmp-config.ts
```

Expected: `errors: []`, one chat model, a selected model.

- [x] **Step 3: Run the full gates**

Run: `cd packages/cli && npx vitest run && npx tsc --noEmit && npx eslint . --ignore-pattern 'src/.zcode/**' --ignore-pattern 'src/.mimosa/**' --ignore-pattern '.mimosa/**'`
Expected: all green.

- [x] **Step 4: Commit the config fix**

```bash
git add packages/cli/src/config/settings.ts packages/cli/src/config/settings.test.ts \
  docs/cli/troubleshooting.mdx docs/zh/cli/troubleshooting.mdx
git commit -m "fix(config): stop warning for model fields in compatible settings"
```

- [x] **Step 5: Commit the capability round**

```bash
git add packages/cli docs/cli docs/zh/cli
git commit -m "feat(tools): add document symbols and the persisted import graph"
```

- [x] **Step 6: Push every unpushed commit**

```bash
git push origin refs/heads/main:refs/heads/main
```

Expected: the two earlier tool commits and both new commits reach `origin/main`.

---

### Task 2: Make the seven-chain workflow replayable

**Files:**
- Create (ignored): `packages/cli/src/.zcode/workflow-drafts/seven-dimension-review.dwf.ts`
- Source: the script supplied as the 2026-10-26 attachment (406 lines).

**Interfaces:**
- Consumes: the workflow DSL (`agent`, `phase`, `report`, `artifact`, `log`).
- Produces: a script whose `report()` calls happen only after the join, in fixed order, and whose final value is named `summary`, not `report`.

- [ ] **Step 1: Copy the supplied script into the ignored draft path**

```bash
mkdir -p packages/cli/src/.zcode/workflow-drafts
cp /home/lin/.qoder-cn/tmp/-home-lin-All-projects-GithubProjects-continue/attachments/1ad76020-f4fd-420c-961e-44aa98eccf71/4fecdfd6-4157-4f44-867e-2d666c1b6bce.txt \
  packages/cli/src/.zcode/workflow-drafts/seven-dimension-review.dwf.ts
```

Expected: the file is under a git-ignored directory; `git status` does not list it.

- [ ] **Step 2: Fix the shadowed DSL function**

Replace the final declaration and return:

```ts
const summary: WorkflowReport = {
  conclusion:
    "七路分析完成：" +
    allFindings.length +
    " 条差距中 " +
    confirmedCount +
    " 条通过独立复核（高影响 " +
    confirmedHigh +
    " 条），" +
    unconfirmedHigh +
    " 条高影响未通过复核已单列待人工复核。报告见 " +
    revised.reportPath +
    "。最优先：" +
    revised.topPriorities.join("；"),
  findings: allFindings.map((f) => ({
    where: f.tntEvidence,
    what: f.gap + "（建议：" + f.recommendation + "）",
    evidence:
      f.tntEvidence +
      " ↔ " +
      f.referenceEvidence +
      (f.reviewNote ? "｜复核：" + f.reviewNote : ""),
    status: f.confirmed ? "verified" : "unconfirmed",
    severity: f.impact,
  })),
  verified: [
    "六个维度每条差距均由独立复核员重新打开双方证据文件核对行号与行为描述",
    "既有研究文档的建议逐项与当前代码对账，防止重复推荐已完成项",
    "终稿经未参与撰写的独立审读员审读并修订",
  ],
  notCovered: [
    "REA 对闭源二进制的深度逆向未展开——本轮只做文件级提取，需要更深的二进制级分析时可用本地 REA 逐项跟进",
    "各代理在真实任务上的效果与成本基准（跑分对比）未做，本轮是静态能力对照",
    "TUI 交互面已有专项差距报告（TUI-GAP-ANALYSIS-2026-10-25.md），本轮只覆盖引擎与能力层",
  ],
};
return summary;
```

Expected: no `const report` binding remains; the DSL's `report()` is reachable for the whole script.

- [ ] **Step 3: Remove `report()` from the concurrent chains**

Delete these calls from `priorPromise` and `gapPromises`:

```ts
report({ dimension: "既有研究对账", stage: "分析中" }, "进度");
report({ dimension: "既有研究对账", stage: "复核中" }, "进度");
report({ dimension: "既有研究对账", stage: "已完成" }, "进度");
report({ dimension: d.name, stage: "分析中" }, "进度");
report({ dimension: d.name, stage: "复核中" }, "进度");
report({ dimension: d.name, stage: "已完成" }, "进度");
for (const f of check.findings) report({ ...f, dimension: d.name });
```

- [ ] **Step 4: Report after the join, in fixed order**

Insert immediately after `const [prior, ...dimResults] = await Promise.all(...)`:

```ts
report({ dimension: "既有研究对账", stage: prior.items.length > 0 ? "已完成" : "失败" }, "进度");
for (const result of dimResults) {
  report({ dimension: result.dimension, stage: result.error ? "失败" : "已完成" }, "进度");
}
for (const result of dimResults) {
  for (const finding of result.findings) {
    report({ ...finding, dimension: result.dimension });
  }
}
```

Expected: every `report()` call is now ordered by the fixed `dimResults` array, not by completion timing.

- [ ] **Step 5: Prove replay determinism before spending quota**

Run a reduced variant with two dimensions only, on a provider the owner approves. Stop the run after the first join, resume it, and confirm the journal accepts the replay:

Expected: resume reaches the synthesis phase; no `inputHash differs` error.

> Blocked on 2026-10-26: the script is fixed and syntax-checked at `packages/cli/src/.zcode/workflow-drafts/seven-dimension-review.dwf.ts`, but this session has no workflow host to submit it to and no confirmed provider quota. The manual fallback in Task 3 was executed instead.

- [ ] **Step 6: Run the full seven-chain workflow**

Preconditions: owner approval for its subagents and a provider with quota.

Command: submit the draft path to the workflow host the owner uses (the handoff describes `CreateWorkflow` with a `path`).

Expected: `PRODUCT-GAP-ANALYSIS-2026-10-24.md` is rewritten; `artifact.file` publishes it; the run returns the `summary` object.

---

### Task 3: Fallback manual completion of the four open dimensions

**Files:**
- Create: `PRODUCT-GAP-ANALYSIS-2026-10-26.md` (untracked working report)
- Read: `packages/cli/src/{retrieval,loop,stream,compaction,tools,permissions,subagent}/`, `core/`, and the reference trees.

**Interfaces:**
- Consumes: Task 2's output if the workflow ran; otherwise this is the only analysis path.
- Produces: one section per dimension with inventory, ≤6 findings, TNT `path:line` and reference `path:line` evidence.

- [x] **Step 1: Write the shared evidence rules**

Every finding must carry: TNT path:line, reference path:line, impact (high/medium/low), and a recommendation labelled 直接搬运 / 改造落地 / 需自研.

- [x] **Step 2: Analyze 检索与代码库理解**

Focus: FTS5 trigram + BM25, LanceDB + rerank, LSP References/CallHierarchy/DocumentSymbol, ImportGraph, and what the reference trees do beyond them.

- [x] **Step 3: Analyze Agent 执行引擎**

Focus: `loop/turnBudget.ts`, `stream/streamChatResponse.ts`, tool dispatch, subagents, plan mode, background jobs, interruption/recovery.

- [x] **Step 4: Analyze 上下文工程**

Focus: system-message layers, cache-prefix stability, compaction, context budget, rules/memory, token accounting.

- [x] **Step 5: Analyze 工具与能力面**

Focus: edit/write, search, shell/background, diagnostics, web, images, todo/plan; compare schema and description engineering.

- [x] **Step 6: Cross-check every finding against the current tree**

Re-open each cited line; mark a finding unconfirmed if the line moved or the behavior differs.

---

### Task 4: Complete the closed-source comparison

**Files:**
- Modify: `CLOSED-SOURCE-CAPABILITY-ANALYSIS-2026-10-25.md` (untracked)
- Read only: the installed IDE tree under `/usr/share/`, the npm-global agent package, and the official CLI package under the Node global prefix.

**Interfaces:**
- Consumes: Task 3's report structure.
- Produces: a capability table covering prompts, tool inventory/schemas, context/permission policy, retrieval/index behavior, and the gaps TNT still has.

- [x] **Step 1: Inventory the agent CLI distribution**

Resolve the real entry file behind the global bin, then inventory its system prompt strings, tool names and schemas with `rg -a`/`strings`; do not execute it.

- [x] **Step 2: Inventory the official CLI distribution**

Inspect the npm package and its platform binary with `rg -a`/`strings` for the same five categories; record the version.

- [x] **Step 3: Reconcile with the already-finished IDE and npm-distribution passes**

Fold the earlier IDE retrieval/agent findings into the same table; list only differences that are still open.

- [x] **Step 4: Write the delta**

For each TNT gap, give the mechanism, the TNT entry point, and whether it is transferable, adaptable, or needs original work.

---

### Task 5: Measure the real-key cache behavior

**Files:**
- Modify only if the data justifies it: `packages/openai-adapters/src/apis/cachePolicy.ts` and its tests.
- Run: `packages/openai-adapters/src/test/anthropic-caching.live.test.ts`
- Run: `packages/openai-adapters/src/test/anthropic-caching-scenarios.live.test.ts`
- Run: `packages/openai-adapters/src/test/deepseek-cache.live.test.ts`

**Interfaces:**
- Consumes: a key the owner supplies or explicitly authorizes.
- Produces: per-provider cache-read numbers for two consecutive rounds and, if measured, a justified default breakpoint budget.

> Blocked on 2026-10-26: `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` and `OPENAI_API_KEY` are unset in this session and the config key was not read. Re-run when a key is supplied.

- [ ] **Step 1: Ask for the key/authorization**

Do not read `~/.tnt/config.yaml` or any env file for the key. Use an environment variable the owner sets for the run.

- [ ] **Step 2: Run two consecutive rounds at the current defaults**

```bash
cd packages/openai-adapters
ANTHROPIC_API_KEY=... npx vitest run src/test/anthropic-caching.live.test.ts
ANTHROPIC_API_KEY=... npx vitest run src/test/anthropic-caching-scenarios.live.test.ts
DEEPSEEK_API_KEY=... npx vitest run src/test/deepseek-cache.live.test.ts
```

Record prompt, cache read, cache write and hit rate. Repeat the Anthropic pair once with `CONTINUE_CLI_CACHE_RETENTION=long`.

- [ ] **Step 3: Compare the breakpoint budgets**

Run the direct route three times with `CONTINUE_CLI_ANTHROPIC_BREAKPOINTS=2`, `=3` and `=4`, keeping every other variable fixed. Keep the current default unless the measured hit rate moves by more than the noise floor.

- [ ] **Step 4: Record the result**

Add the measured numbers to the analysis report. If a default changes, update `cachePolicy.ts` and its tests in the same commit and state the measurement in the message.

---

### Task 6: Audit the remaining P2 items and produce their sub-plan

**Files:**
- Create: `docs/superpowers/plans/2026-10-27-p2-followups.md`
- Read: the files named below.

**Interfaces:**
- Consumes: the handoff's §4.3 P2 list.
- Produces: one TDD task per still-open item, each with its own failing test and file list.

- [x] **Step 1: Audit full-screen Static**

Read `packages/cli/src/ui/components/MainContent.tsx`, `ScreenContent.tsx` and the streaming renderer; mark done/partial/open with evidence.

- [x] **Step 2: Audit two-axis termination and preemption**

Read `loop/turnBudget.ts`, `stream/streamChatResponse.ts`, and the usage callbacks; mark the status of consecutive-failure and total-budget termination plus token preemption.

- [x] **Step 3: Audit system-message merge-patch**

Read `stream/systemPromptRound.ts` and `services/SystemMessageService.ts`; determine whether section-level updates already exist.

- [x] **Step 4: Audit context-budget injection and changed-files reinsertion**

Read `stream/requestPreparation.ts`, `cache/*`, and the hook/reminder paths; record what is already visible to the model.

- [x] **Step 5: Audit the recorded-replay layer and Windows headless e2e**

Read `test-utils/`, `e2e/` and the CI workflow; list the missing fixtures/platforms.

- [x] **Step 6: Write the sub-plan**

For every open item, write a task with exact files, a failing test, the minimal implementation, the gate commands, and a commit message.

---

## Self-Review

- **Spec coverage:** install/config noise (Task 1), workflow fix and run (Task 2), four open dimensions (Task 3), closed-source completion (Task 4), cache A/B (Task 5), P2 audit (Task 6). Delivery/push is Task 1.
- **Placeholder scan:** the only intentionally unspecified input is the owner-supplied key in Task 5 and the manual-analysis prose in Task 3; both are marked as inputs, not left as “TODO”.
- **Type/name consistency:** the workflow's return value is renamed `summary` in both the declaration and the return; `report()` is used only after the join in Task 2.
