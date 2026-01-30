# P2 Follow-ups Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. One writer only; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the open findings from the 2026-10-26 delta report into TDD-sized tasks, ordered by product impact.

**Architecture:** Each task reuses an existing subsystem: LSP manager for position queries, the tool-result image pipeline for Read, `transcriptSegments` for Static, `SystemMessageService` sections for merge-patch, the reminder tail for budget and changed-file notes, and the session store for tasks. No new index or orchestration engine.

**Tech Stack:** TypeScript, vitest, Ink, LSP, the existing `ToolResult` image pipeline.

**Spec:** `PRODUCT-GAP-ANALYSIS-2026-10-26.md` and `CLAUDE.md`/`AGENTS.md` project rules.

## Status (2026-10-26)

- Task 1 Definition: **done** (`d0422f850`). 40 tools, fingerprint `7adf6e7f8f221a81` after Task 2.
- Task 2 Read images: **done** (`b0462f417`). `Read` returns `ToolResult` for png/jpg/jpeg/webp/gif, 3 MB cap.
- Task 3 Static: **opt-in done, default stays the alternate screen** (owner-delegated 2026-10-26; visual verification is the owner's read-back). `TNT_ALT_SCREEN=0` now keeps the normal buffer and renders settled history through `<Static>`, leaving only the live tail in the frame; the default alternate-screen `ScrollView` path is unchanged. The content-level safe split is now wired too: `ui/utils/streamSplit.ts` keeps an unclosed fence live, settled prefixes move to their own rows, and only the tail redraws.
- Task 4 merge-patch: **decided skip** (owner-delegated 2026-10-26). `advanceSystemPrompt` already appends the whole changed prompt as an in-history update, and a section patch changes what the cached prefix and update list mean; shipping it without its own cache measurement would be a guess.
- Task 5 context budget: **already implemented**. `loop/contextBudget.ts` is wired through `state.contextBudget.reminder(...)` in `stream/streamChatResponse.ts:329`; no work needed.
- Task 6 changed-file diff: **done** (`098858b60`). `fileState` keeps bounded snapshots (24 files, 64 KB each); the note shows a capped line diff. A separate flake was fixed: the docs scan now skips a directory that vanished mid-scan.
- Task 7 retry classification: **already implemented**. `utils/exponentialBackoff.ts` has `isRetryable` and `retryAfterMs` (Retry-After parsing) plus the backoff wrapper.
- Task 8 task store: **decided skip** (owner-delegated 2026-10-26). `Todo` (session list) and `Checklist` (history marker) already cover task tracking; a third persistent store has no use case those two cannot serve.
- Task 9 Windows headless e2e: **done** (`5a69a2393`, `93a667d05`, `0d72dce20`). Exit flushes stdio first, the session helper reads the v2 `.jsonl` transcript, and CI runs the headless filter on Windows. A separate recorded-replay fixture layer was **not added**: the existing `headless-mock-llm` and sibling suites already replay scripted SSE frames.

## Global Constraints

- No reference-product names in code, comments, docs, filenames or commits.
- Conventional commits; gates before each commit: `npx vitest run`, `npx tsc --noEmit`, `npx eslint`.
- Every new user-visible string gets an `en` and `zh` entry.
- Tool additions update `ALL_BUILT_IN_TOOLS`, the name list, policies, the per-tool deferral set, `documentedSurface`, and the prefix fingerprint together.

---

### Task 1: Position-based Definition tool

**Files:**
- Modify: `packages/cli/src/lsp/manager.ts`
- Create: `packages/cli/src/tools/definition.ts`, `definition.test.ts`
- Modify: `tools/allBuiltIns.ts`, `tools/builtInToolNames.ts`, `tools/registry.ts`, `permissions/defaultPolicies.ts`, `permissions/autoMode.ts`, `tools/selection/deferral.ts`, `tools/documentedSurface.test.ts`, `tools/toolPrefixFingerprint.test.ts`, `test-fixtures/fake-lsp-server.mjs`

**Interfaces:**
- Produces: `LspManager.definitionAt(filePath: string, line: number, character: number, kind: "definition" | "implementation"): Promise<LspLocation[]>`
- Produces: tool `Definition`, params `{ file_path: string; line: number; character: number; kind: "definition" | "implementation" }`.

- [ ] **Step 1: Extend the fake server**

Add cases for `textDocument/definition` and `textDocument/implementation` returning one `Location` each, with deterministic line/character values.

- [ ] **Step 2: Write the failing tool test**

```ts
it("reports the definition the server returns", async () => {
  writePlugin();
  const result = await definitionTool.run({
    file_path: file(), line: 5, character: 3, kind: "definition",
  });
  expect(result).toContain("decl.ts:2:5");
  expect(result).not.toContain("file:///");
});
```

Also cover: no server, missing file, bad position, bad kind, and `implementation`.

- [ ] **Step 3: Implement `definitionAt` and the tool**

Request `textDocument/definition` or `textDocument/implementation` with the same 0-based position mapping as `referencesAt`; normalize `Location | Location[] | LocationLink` to `LspLocation[]`.

- [ ] **Step 4: Register and pin**

Add the tool to the built-in array, name list, workspace tools, allow policies, auto-safe set and deferred built-ins. Recompute the prefix fingerprint and update `ARCHITECTURE-tnt.md`.

- [ ] **Step 5: Gates and commit**

Run the four gates; commit as `feat(tools): resolve definitions and implementations through LSP`.

---

### Task 2: Read displays images

**Files:**
- Modify: `packages/cli/src/tools/readFile.ts`, `readFile.test.ts`
- Reuse: `stream/toolResultMedia.ts` (already attaches images to the observation)

**Interfaces:**
- `readFileTool.run` returns `ToolResult` for `.png`/`.jpg`/`.jpeg`: `{ content: "Read <path> (<WxH>).", images: [{ mimeType, data }] }`.
- Text files keep returning a string.

- [ ] **Step 1: Write the failing test**

Create a tiny PNG fixture (24-byte header), run the tool, assert `typeof result === "object"`, one image, PNG mime, and a text content that names the path.

- [ ] **Step 2: Implement size and type handling**

Sniff the extension; cap at 4.5 MB base64; for larger images return a text error that recommends a smaller crop. Reuse `pngSize` from `tools/imageCompression.ts` for PNG dimensions.

- [ ] **Step 3: Gates and commit**

`feat(tools): return image files as image content from Read`.

---

### Task 3: Stream Static, in two slices

**Files:**
- Modify: `packages/cli/src/ui/components/ScreenContent.tsx`, `ui/TUIChat.tsx`
- Create: `packages/cli/src/ui/utils/streamSplit.ts`, `streamSplit.test.ts`
- Reuse: `ui/utils/transcriptSegments.ts`

**Interfaces:**
- `splitForStreaming(text: string): { settled: string; live: string }` never splits inside an unclosed code fence.

- [ ] **Step 1: Write the failing split test**

```ts
expect(splitForStreaming("a\n\n```ts\nconst x = 1;")).toEqual({
  settled: "a",
  live: "\n\n```ts\nconst x = 1;",
});
```

- [ ] **Step 2: Implement the fence scanner** (line scan, toggles on ```).

- [ ] **Step 3: Write the failing Static wiring test**

Render `ScreenContent` with two settled transcript items and one live item; assert the settled text appears once and the live text is outside the static region (a test hook or a stable test id).

- [ ] **Step 4: Wire `splitTranscriptSegments` + `<Static>`**; keep the live tail in the normal frame.

- [ ] **Step 5: Commit** `feat(tui): render settled transcript rows through Static`.

---

### Task 4: System-message section merge-patch

**Files:**
- Create: `packages/cli/src/stream/systemPromptDiff.ts`, `systemPromptDiff.test.ts`
- Modify: `packages/cli/src/services/SystemMessageService.ts`, `stream/systemPromptRound.ts`

**Interfaces:**
- `diffSections(previous: string[], next: string[]): { added: string[]; removed: string[]; changed: { index: number; text: string }[] }`
- `SystemMessageService` exposes the diff on each build; the prompt round appends only changed sections.

- [ ] **Step 1: Failing test** for unchanged, added, removed and changed sections.
- [ ] **Step 2: Implement the pure diff.**
- [ ] **Step 3: Failing test** that a second build with one changed section produces one append, not a full rewrite.
- [ ] **Step 4: Wire it; keep the full rewrite path for a new series.**
- [ ] **Step 5: Commit** `feat(context): patch changed system-message sections`.

---

### Task 5: Context budget note

**Files:**
- Modify: `packages/cli/src/stream/toolDispatch.ts` or the tail-reminder source
- Test: `tools/contextBudget.test.ts` (new pure formatter)

**Interfaces:**
- `formatContextBudget({ used, limit }): string` returns `Context: 18.2k/200k (9%) left this turn.` or empty when no limit.

- [ ] **Step 1: Failing formatter test** with exact strings for a known limit and for no limit.
- [ ] **Step 2: Implement and append through `onTailReminder`** (never the head, to preserve the prefix).
- [ ] **Step 3: Commit** `feat(context): tell the model how much context remains`.

---

### Task 6: Changed-file diff snippets

**Files:**
- Modify: `packages/cli/src/agent/changedFiles.ts`, `changedFiles.test.ts`

**Interfaces:**
- `describeChangedFiles` keeps the path list and appends up to two hunks per file, capped at 40 lines total.

- [ ] **Step 1: Failing test** with a temp file changed after being seen; assert the note contains the path and a `-`/`+` line.
- [ ] **Step 2: Implement the diff read** with the existing file-state cache; a file that cannot be read keeps the path-only note.
- [ ] **Step 3: Commit** `feat(context): include changed-file hunks in the re-read note`.

---

### Task 7: Token preemption and classified retries

**Files:**
- Modify: `packages/cli/src/loop/turnBudget.ts`, `stream/streamChatResponse.ts`
- Test: `loop/turnBudget.test.ts`, `stream/streamChatResponse.retry.test.ts`

**Interfaces:**
- `TurnBudget.recordUsage(promptTokens: number, limit: number): void` tracks a token ceiling.
- `classifyRetry(error): "retry" | "wait" | "fatal"`; a wait carries `retryAfterMs`.

- [ ] **Step 1: Failing budget test** that a token ceiling ends the turn with `tokens_exhausted`.
- [ ] **Step 2: Failing retry test** for a 429 with `Retry-After` (wait), a 500 (retry) and a 400 (fatal).
- [ ] **Step 3: Implement the counters and the classifier; wire them into the existing retry loop.**
- [ ] **Step 4: Commit** `feat(loop): bound tokens and classify retries`.

---

### Task 8: Persistent task tools

**Files:**
- Create: `packages/cli/src/services/TaskStore.ts`, tests
- Create: `tools/taskCreate.ts`, `taskList.ts`, `taskUpdate.ts`
- Modify: registry, names, policies, deferral, fingerprint

**Interfaces:**
- Store at `$CONTINUE_GLOBAL_DIR/tasks.json`, atomic write.
- `TaskCreate(input): Task`, `TaskList(): Task[]`, `TaskUpdate(id, patch): Task`.
- States: `pending | in_progress | completed | blocked`; optional `owner`, `dependsOn`.

- [ ] **Step 1: Failing store test** for create/list/update and restart persistence.
- [ ] **Step 2: Implement the store and tools.**
- [ ] **Step 3: Register and pin the fingerprint.**
- [ ] **Step 4: Commit** `feat(tools): persist tasks across turns and sessions`.

---

### Task 9: Recorded replay and Windows headless coverage

**Files:**
- Create: `packages/cli/e2e/fixtures/recorded/*.jsonl`, `e2e/replay.test.ts`
- Modify: `.github/workflows/*`

- [ ] **Step 1: Record one headless turn's SSE frames** from a mock server.
- [ ] **Step 2: Replay against the built bundle** and assert identical content, tool calls and usage.
- [ ] **Step 3: Add a Windows headless job** to CI; no provider key.
- [ ] **Step 4: Commit** `test(e2e): replay a recorded turn and cover Windows headless`.

---

## Self-Review

- Coverage: R1 (Task 1), T1 (Task 2), C1 (Task 3), C2 (Task 4), C3 (Task 5), C4 (Task 6), E5 (Task 7), E2 (Task 8), C5 (Task 9). E1/E3/E4/T2/T3/T4 remain in the report's P2 backlog.
- Every task has a failing test, files, a minimal implementation and a commit.
- Types and tool names match across registration steps.
