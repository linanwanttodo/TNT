# TNT CLI architecture

Scope: `packages/cli`, `core/`, `packages/*`. The IDE extensions and the GUI under `ide/` are not part of this
engine. The systematic reference - modes, cache-prefix engineering, hooks, subagents, known gaps - is
`docs/ARCHITECTURE-tnt.md`; this file is the rulings ledger and the numbers. Every number below is produced by a command in "How to verify", not by hand: if a command
stops agreeing with the text, the text is wrong.

## Layout

`src/` is grouped by layer; only entry points sit at the top level. The grouping is what
`src/architecture.test.ts` measures, so the directory names are load-bearing, not cosmetic.

Test helpers do not belong in a layer the bundle is built from, so none live under `src/` any
more: every helper and this directory's README sit at the package root as `test-utils/`. Three
helpers that no suite, mock specifier or config glob named were deleted rather than left to rot in
there. `tsconfig.build.json` includes `src/**` alone, so a helper is out of the build the moment it
moves - which is why its `src/test-utils` exclude is gone now that the directory is;
`tsconfig.json` names both roots, so the type gate still reads every helper, and
`architecture.test.ts` refuses any production import of one.

| Path                                                                                                    | Role                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `index.ts`, `dev.ts`                                                                                    | bundled entry point and the tsx dev runner                                                                             |
| `acp/`                                                                                                  | ACP supervisor, one worker per session, update and permission bridges                                                  |
| `agent/`                                                                                                | system prompt assembly (`systemMessage.ts` builds the prefix as named sections)                                        |
| `stream/`, `loop/`, `tools/`, `permissions/`, `cache/`, `plugins/`, `hooks/`, `subagent/`, `telemetry/` | the agent engine                                                                                                       |
| `commands/`, `ui/commands/`                                                                             | argv subcommands (`chat`, `serve`, `ls`, `review`, `checks`) and the slash-command pipeline - two separate dispatchers |
| `services/`                                                                                             | long-lived services resolved through `ServiceContainer`                                                                |
| `config/`, `session/`, `startup/`, `platform/`                                                          | config loading, session store, bootstrap, platform client                                                              |
| `i18n/`                                                                                                 | translations and locale switching                                                                                      |
| `utils/`                                                                                                | leaf helpers; it may not reach upward except through the exemptions the ratchet lists                                  |

## One engine, four surfaces

`stream/streamChatResponse.ts` runs the turn loop for all four surfaces: the Ink TUI
(`ui/hooks/useChat.ts`), headless `-p` (`commands/chat.ts`), `tnt serve`, and each
ACP session worker. Every surface reaches
it through `session/controller.ts`, which is the only production importer of the loop (the
summarizer is the documented exception). The controller stamps each turn with a session id, a turn
id, and a monotonic sequence, then maps `StreamCallbacks` to the typed events in
`protocol/events.ts` through `stream/eventAdapter.ts`. `tnt serve` exposes that contract at
`GET /events` as server-sent events while keeping the polling endpoints for the current remote
client. `tnt --acp` runs a supervisor that spawns one single-session worker process per editor
session; the supervisor forwards the same event contract as ACP session/update and forwards
permission answers through the same `toolPermissionManager`.

The transcript in `session/transcript.ts` owns message identity and the staging batch behind
`ChatHistoryService`: append methods assign ids, an assistant message with tool calls is staged
until its first tool result commits it, and a compaction records a mark on the retained window.
Replay keeps the ids because they are written onto the persisted item. One request's
streaming-and-tool-batch seam is `stream/processStreamingResponse.ts`. The loop's own decisions
live beside it: `systemPromptRound.ts` advances the cached system-prompt state, `requestPreparation.ts`
runs the pre-API compaction and the cache-prefix verdict, and `roundOutcome.ts` classifies an early
stream end. The remaining helper modules split by job (`permissionFlow.ts`, `chunkProcessing.ts`,
`usageTelemetry.ts`, `toolExecution.ts`, `responseChunks.ts`). Per-turn guards live
next to it as their own trackers (`loop/turnBudget.ts`, `loop/toolFailureTracker.ts`,
`loop/terminalStop.ts`, `loop/contextBudget.ts`, `loop/todoReminder.ts`) and are passed in through `StreamCallbacks`, so no surface re-implements a
stop condition. Compaction is driven by measured provider usage (`compaction/measuredContext.ts`,
keyed by the prompt cache key) and receives its summarizer from the engine
(`stream/summarizeWithEngine.ts`) instead of importing it, which is what keeps `compaction` and
`stream` from depending on each other.

A bounded headless run reports itself honestly: the loop ends with the
`request_timeout` termination reason, which the abort marker (`REQUEST_TIMEOUT_ABORT` in
`loop/termination.ts`, carried on `signal.reason`) is what separates from a person pressing
Ctrl+C; `--format json` and stream-json both end with an error result and the process exits 1.
Headless only, the turn also carries a wall-clock bound. By construction it spans every tool round of one prompt - `commands/chat.ts` arms the timer around the single `streamChatResponse` call that contains that loop, and each round checks `signal.aborted` before issuing another request (measured by `e2e/headless-request-timeout-multiround.test.ts`, where every round is shorter than the bound and the turn still ends in `request_timeout`): `commands/headlessTimeout.ts` resolves it
(flag `--request-timeout`, then `TNT_HEADLESS_TIMEOUT`, then 300 s, and 0 means no bound) and
`commands/chat.ts` arms it on the same `AbortController` the loop already holds, so the engine needs
no knowledge of it. `e2e/headless-request-timeout.test.ts` pins it against a provider that never
answers. The bound's scope is guarded by where it is armed, not by a test that waits 300 s:
`commands/headlessBoundScope.test.ts` scans every production source and accepts `armTimeout` in
`commands/chat.ts` alone, so neither the TUI (a person is reading and approving inside the turn)
nor `tnt serve` (which keeps its own inactivity shutdown) can acquire a wall clock by accident.

Esc is counted from bytes, not from events: a real terminal can deliver a quick double tap as one
`\x1b\x1b` read, and Ink 6.8 folds that into a single `escape` event carrying the second byte, so the
double-Esc shortcut in `ui/UserInput.tsx` counts the ESC bytes in the event (`escapePresses`) instead
of waiting for a second event inside a 500 ms window. Waiting for the event alone made the shortcut
depend on how the terminal buffered the keystrokes.

A block of text in the transcript is sized from the terminal, not from a constant:
`ui/utils/blockBudget.ts` gives one block `min(40, floor(rows / 2))` lines, never fewer than one.
What does not fit is saved beside the session (`block-overflow/<session>/`, named for its own
content so a re-render does not rewrite it, pruned to the 50 newest) and the block prints
`[+3 lines → <path>]` in its place. When the save fails the notice is a bare `... +3 lines`,
because a count is a fact and a path is a promise. `ui/ToolResultSummary.tsx` applies this to
command output; the subagent block still shows the tail of a run that is ongoing, where the
newest lines are the point.

Whether those two layouts read well in a real terminal is not settled here: the budget and the
file are pinned by tests, the wrapping is not, and `useTerminalSize` falls back to 24 rows when
the terminal cannot be measured.

## The cached prefix

The prefix is assembled in build order, each part announced so it can be attributed later:

1. `base` (the CLI's own text) - `agent/systemMessage.ts`
2. `planMode` - only in plan mode, text shared with the `plan` profile (`agent/promptProfiles.ts`)
3. `promptProfile` - the task-shaped axis, skipped when the mode already supplied the plan text
4. `headless`, `jsonOutput` - output shape
5. `outputStyle` - a plugin-forced or session-chosen style (`ui/commands/handlers/outputStyle.ts`)
6. `userRules` - last, so a user's own file edits move only the tail

- A mid-session change is delivered as an appended system message when the endpoint can carry one
  and rewritten otherwise: `stream/systemPromptPolicy.ts` decides, `cache/prefixState.ts` classifies
  the result (`full` / `passthrough` / `invalidated` plus reasons).
- Two numbers govern breakpoints and they are not the same number. The provider's ceiling is four per
  request across system, tools and messages, and a fifth is a 400 rather than a marker it quietly drops;
  it lives in `ANTHROPIC_MAX_CACHE_BREAKPOINTS` (`AnthropicUtils.ts`). What this project sends is two -
  the newest turn plus one on the head of the prefix, which is the last tool when a request carries tools
  and the last system block when it does not - because each extra breakpoint bills a cache write at about
  1.25x for a span a kept one already covers; it lives in `ANTHROPIC_BREAKPOINTS_KEPT` (`cacheControl.ts`).
  Both routes narrow to it before anything goes out: the Anthropic route with
  `capBreakpointsForAnthropic(pruned, ANTHROPIC_BREAKPOINTS_KEPT)` in `_convertBody`, and the OpenRouter
  route - which runs a strategy, tops the trailing turns up from what the body already spent
  (`countCacheBreakpoints`) and then mirrors markers back onto the OpenAI-shaped parts - with the same
  call before that mirror. The strategies may still place up to four while they work; the cap is what
  decides which of them survive. `anthropicCacheBreakpointCap.test.ts` counts finished bodies at all three
  points (per strategy, the mutated OpenAI body, and the direct route's `_convertBody` output, where a
  request built with `cachingStrategy: "none"` must ship zero), each with a floor assertion so an empty
  body cannot pass a "at most two" claim.

- Carrying is declared by the adapter, not assumed from a provider name:
  `packages/openai-adapters/src/apis/base.ts` `carriesInHistorySystemMessages(model)` is implemented
  only by `OpenAIApi`'s chat route. `Anthropic`, `Bedrock`, `AiSdk`, `Cohere` and `Gemini` lift a
  single system message into their own field and filter the rest, so an append there would be
  dropped; forcing one through configuration is logged.
- `mode`, `sessionId` and similar CLI state are not part of the prefix identity
  (`cache/requestHeader.ts` `canonicalHeader`), because they never reach a provider.
- Switching permission mode mid-turn takes effect on the next tool round and is not announced:
  `stream/streamChatResponse.ts` re-reads `toolPermissions.getState().currentMode` per round (172
  for the prompt, 231 for the request header), so nothing freezes the mode and nothing prints that
  it moved. What keeps the cache is the shape of the sections instead - `auto` adds no section of
  its own and `plan` adds only the volatile `planMode` one - which is what
  `agent/systemMessage.sections.test.ts` holds. A turn that switches between `auto` and `agent`
  therefore rebills nothing, and immediate effect is what a switch is for.
- The static spine of the system message is the other half of that prefix: `cb1d697770476189` for the
  TUI (4180 characters), `868e0297acbc3bfe` with JSON output (4596), `2882d228b73d731a` headless
  (4724), `6792d7012e30c376` headless + JSON (5140). Only what the builder marks non-volatile is
  digested - `base`, `headless`, `jsonOutput` - so plan text, a chosen profile, a plugin output
  style, the user's rules and the environment block stay outside it.
  `agent/systemPrefixFingerprint.test.ts` freezes these and reads this file for the same strings.
- **Prefix changelog, 2026-10-18:** the `<env>` block (working directory, whether
  the directory is a git repo, platform, today's date) and the `<context name="gitStatus">` snapshot
  moved out of `base` into their own volatile `environment` section, appended last. They used to sit
  at the head of the prefix, so the entire cached prompt - guidance, tools, everything - was re-billed
  at midnight and again whenever an uncommitted file appeared or disappeared. This costs one cold
  start per session and after it a status or date change moves only the tail. The guard proves the
  split holds: adding and removing an untracked file no longer moves any of the four digests, while
  rewording one clause in `base` moves all of them.

- The built-in tool list is billed inside that prefix too, and its current shape is
  `33221c2477cc087b` over 39 tools and 30973 characters (name + description + parameter schema, in
  `tools/stableOrder.ts` order). All 39 are in `ALL_BUILT_IN_TOOLS`: the four the request
  assembles from `src/tools/index.tsx`'s own arrays (`CheckBackgroundJob`, `EnterPlanMode`,
  `ExitPlanMode`, `Glob`) joined the registry on 2026-10-20, so the digest and the
  default-deny name list now read the same set. `ToolSearch` joined on 2026-10-22 and is
  advertised only while something is deferred; since 2026-10-25 a fixed set of situational
  built-ins is deferred too, with a compact name/signature listing in its description.
  `Computer` joined on 2026-10-25 with the desktop driver, and `References` / `CallHierarchy` /
  `DocumentSymbol` joined the same day as the LSP-side reads of the call graph, and
  `ImportGraph` as the persisted module graph. `tools/toolPrefixFingerprint.test.ts`
  freezes it and reads this file for the same digest, so the text cannot move without a line here: a
  reworded description is not a copy edit, it cold-starts the first request of every new session. The
  same guard discovers every `Tool` this directory exports, so declaring a built-in tool that the
  digest does not reach is refused rather than forgotten. Changing the prefix on purpose means
  updating the digest, the two counts and this sentence together.

- When the prefix does move, `cache/cacheBreakReport.ts` writes the reasons, both hit ratios and the
  named section changes (`describeSystemMessageTextChange` in `agent/systemMessage.ts`) to
  `cache-breaks/<session>/` beside the session store.
- Counts reported in a chunk that carries no choices - the trailing metadata event of a provider like
  Bedrock - are still metered: `stream/processStreamingResponse.ts` reads `chunk.usage` ahead of the
  choice guard, and `e2e/headless-usage-only-chunk.test.ts` pins it through to the saved session.

## Tools and permissions

- Registration: `tools/registry.ts` composes what exists (capability gates and the stable order the
  request is billed in), `tools/mcp.ts` owns MCP naming and translation, and `tools/index.tsx` is the
  public facade that parses, converts and executes a call. Names: `tools/builtInToolNames.ts`;
  instances for display and policy lookups: `tools/allBuiltIns.ts`.
- Selection: `tools/selection/` owns what one request advertises. `deferral.ts` decides whether MCP
  schemas are replaced by `ToolSearch` (a tenth of the model's window, or an explicit
  `CONTINUE_CLI_DEFER_MCP_TOOLS`), `requestTools.ts` applies the policy table and asks for the
  window, and `search.ts` is the catalog tool itself. The stream engine only asks for the answer.
- Policy: `permissions/defaultPolicies.ts` holds the agent, plan and auto lists. Plan mode scopes
  writes to documentation (`permissions/documentPath.ts`) rather than refusing them.
- Two independent guards make an omission impossible: `permissions/toolPolicyCoverage.test.ts`
  fails on a tool with no policy in either mode list and on a policy naming a tool nobody is
  offered (unless declared conditional), and `tools/toolGuidance.test.ts` pins the working rules
  that ship inside tool descriptions.
- Writes are bounded twice: `permissions/workspacePath.ts` is consulted by the policy layer
  (`workspaceOnly`, judging every path a patch names) and by the tools themselves;
  `tools/fileState.ts` refuses to overwrite a file that changed since it was read.
- Approval keys are per tool and per resolved path (`permissions/sessionApprovals.ts`), so an
  approved edit never becomes an approved overwrite. `ApplyPatch` is the multi-file case: one call,
  one approval, and every file planned before anything is written.
- Concurrency is declared as data in `tools/specs/concurrency.ts`; a keyed call that cannot name a
  resource takes the global slot.

## Hooks and plugins

- Hook config precedence (lowest first): `~/.claude/settings.json`, `~/.tnt/settings.json`,
  `.claude/settings.json`, `.tnt/settings.json`, then the `.local.json` variants.
- Exit codes: 0 proceeds, 2 blocks with stderr as feedback, anything else is a non-blocking error.
  JSON handlers may return `hookSpecificOutput`. A hook that crashes must not cancel the decision a
  healthy hook made in the same event (`hooks/hookRunner.ts`).
- Lifecycle events fire on every surface, including `tnt serve` and the non-TUI compaction path
  (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreCompact`, `Notification`).
- Installed is not enabled: `plugins/pluginEnablement.ts` filters through `enabledPlugins` in the
  settings cascade, and a cross-marketplace dependency is never auto-installed.

## i18n

`i18n/index.ts` types the table as `Record<TranslationKey, string>`, so a missing translation is a
compile error rather than an English leak. `ui/commands/handlers/localeCoverage.test.ts` switches
locale and asserts rendered Chinese; `commands/outputCopy.test.ts` scans `src/commands/**` and fails
on a `console.*` literal with words that never went through `t()`, or on a `throw new …Error("…")`
whose message is still raw; `i18n/untranslatedOutput.test.ts` covers the rest of `src`, including
the `safeStdout`/`safeStderr` writers in `startup/init.ts` that neither of the other two can see.

## How to verify

From `packages/cli`:

    npx tsc --noEmit
    npm run lint
    ../../node_modules/.bin/prettier --check "src/**/*.{ts,tsx}" "test-utils/**/*.{ts,tsx}"
    npx vitest run
    npm run build
    npx vitest run --config vitest.e2e.config.ts
    npx vitest run --config vitest.e2e.config.ts e2e/acp.test.ts

The ACP case needs the built `dist/tnt.js` and covers a prompt, two concurrent
sessions, load/resume/delete, a permission request and an ACP session cancel notification against
a mock model server.

Two packages own their own gates, because the CLI neither runs their tests nor reads their sources:

    cd ../../core && npm run build && npx vitest run
    cd ../../core && npm test
    cd ../packages/openai-adapters && npm run build && npx vitest run

`core` has two runners and the vitest one sees only half the suite: `vitest.config.ts` includes
`**/*.vitest.ts` (112 files), while `npm test` runs jest over 59 `*.test.ts` files, so a green
`npx vitest run` there says nothing about the other half. The jest lane needs `npm test` rather than
a bare `npx jest` because the script sets `NODE_OPTIONS=--experimental-vm-modules`, without which the
setup file's `node-fetch` import fails and all 59 suites report a load error. In an environment with
no provider credentials it also needs `IGNORE_API_KEY_TESTS=true`, the switch `llm/llm.test.ts`
already documents, because that suite calls the live APIs and otherwise dies on 401. The counts are
read from the runners, not from this note: `npx vitest run` prints the vitest lane and
`IGNORE_API_KEY_TESTS=true npm test` the jest lane.

The ratchet itself:

    npx vitest run src/architecture.test.ts
    npx vitest run src/tools/documentedSurface.test.ts

Cross-cutting suites, each naming the claim it enforces rather than the module it
lives beside:

- `src/moduleDocsAccuracy.test.ts` - every path the remaining module documents (`spec/`,
  `BUILD.md`, the READMEs) names exists, every `npm run` script it names is one the package
  declares, every markdown link target resolves, every file in `spec/` is linked
  from `spec/index.md`, and no document carries a U+FFFD - a character that was already
  lost when the file was read, and a build output is excused only while a
  document still mentions it.
- `src/docsAccuracy.test.ts` - every path, place and `npm run` command the two
  architecture notes name resolves, except the named external locations, build
  outputs and removals.
- `src/agentsDocAccuracy.test.ts` - the commands, scripts and paths `AGENTS.md` tells
  an agent to use are ones this package really has, and it counts its suite with a
  command rather than a saved number.
- `src/tools/builtInToolNames.test.ts` - the permission layer's name list equals
  `ALL_BUILT_IN_TOOLS`, in both directions.
- `src/hooks/hookEventCoverage.test.ts` - every Claude-Code hook event the types declare is
  fired by production code. The four it used to excuse are gone: `WorktreeCreate` and
  `WorktreeRemove` fire from review's worktree lifecycle (2026-10-20), and
  `TeammateIdle`/`TaskCompleted` were deleted with the team and task concepts they
  described, along with the "configured but never fires" warning that only they used.
- `src/permissions/policyNameCoverage.test.ts` - no tool has a policy that the
  default-deny sweep cannot see. The four names it used to allow were added to the
  sweep on 2026-10-20, so the allowance is empty and a fifth is still refused.
- `src/permissions/dynamicPolicyReachability.test.ts` - a tool that evaluates its
  own permission is reachable through the copy the check reads.
- `src/tools/toolDisplayNames.test.ts` - the label a tool declares is the label the
  UI resolves for it.
- `src/tools/toolPrefixFingerprint.test.ts` - the billed tool prefix is the digest
  named in this file, over the number of tools it names, and no built-in tool this
  package exports sits outside that digest.
- `src/i18n/index.test.ts` - every dictionary key has a Chinese value that differs
  from its English one.
- `src/i18n/unusedKeys.test.ts` - and no key is carried that no caller asks for,
  with the one dynamic key prefix it must skip named and re-checked.

It counts production sources under `src/` (tests, `test-utils` and `__mocks__` excluded), freezes the
mutually importing group pairs in `KNOWN_MUTUAL_COUPLING` (the file's own list is the count), fails on
a new pair, allows `utils ->` only for the four exemptions it names, and fails if the scan finds fewer
than 250 files so an empty scan cannot pass.

## Open by decision, not by oversight

- The three prompt-canon choices are closed: citations are a bare `path:line` (readable, greppable,
  no fence), `Read` keeps its line-number prefix because a citation has to be checkable, and mode
  selection is the immediate, unannounced behaviour described above. The prefix cost of the
  numbering is measured and recorded at `tools/readFile.ts` (`+9.57%` on a 2,000-line file). The
  ruling is that the caps are judged on what is actually sent: the refusal stays a judgement on the
  raw bytes on disk, so no readable file becomes refused, while the numbered body is trimmed to the
  same character cap from the tail and the bounds sentence says how much came back. A saturated read
  therefore gives roughly 9.6% less body than it used to.
- The four-group context-usage line (`ctx 18.2k/200k (9%) · cache r/w 92% · out 1.4k · cost $0.31`)
  is the owner's chosen format and is now shipped. The formatter is `ui/utils/contextUsageLine.ts`
  and its test reproduces that string character for character; `ui/components/BottomStatusBar.tsx`
  gives it the second row of the bar, alone, and feeds it the token count the composer already
  computes, the model's context limit through `getModelContextLimit`, the session cache ratio, the
  session output count and the cost group from `costLineText`. Two halves stay his: the shipped
  labels are the localized `status.context` / `status.cache` / `status.output` / `status.cost`
  rather than his compact `ctx` / `cache r/w` / `out`, and whether the row fits his terminal is a
  read-back, not a test.
- The `continue-cli` literal in `services/GitAiIntegrationService.ts` is a label handed to git-ai and
  is an external contract.
- Both architecture notes claim that every path they name exists. `src/docsAccuracy.test.ts` runs
  that claim: it collects every backticked path with a source extension from `ARCHITECTURE-tnt.md`
  and `docs/ARCHITECTURE-tnt.md`, resolves it against the package, the repository, `core` and
  `packages`, and refuses anything it cannot find unless it is one of the four named external
  locations (settings paths and the files a plugin ships) or one of the named build outputs the
  notes describe (`dist/index.js`, `dist/tnt.js`). Measured on the shipped tree, no documented
  path is unaccounted for, and dropping an entry from either list reddens the guard. It holds extension-less mentions - a place - to the same bar, with one
  inversion: a path the notes name in order to say it is gone (`src/test-utils`) must stay gone. And every
  `npm run <script>` the notes print has to be a script the package that line changes into actually
  declares. What it checks is reproducible rather than quoted: `npx vitest run src/docsAccuracy.test.ts` counts the
  mentions and refuses any that resolve to neither the tree nor a named exception.
- Core keeps autocomplete capabilities that nothing calls: four hand-tuned FIM templates
  (`codestralFimTemplate`, `qwenCoderFimTemplate`, `starcoder2FimTemplate`,
  `gptAutocompleteTemplate`), `shouldLanguageSpecificPrefilter`, `getDiffSnippets` and
  `isMidlineCompletion`. They stay declared and unwired rather than wired or deleted, because core is
  shared with the IDE extensions and no real model is reachable here to tell a fix from a regression.
  `core/unreadDeclarations.vitest.ts` makes that choice countable: it asks `tsc --noUnusedLocals` for
  every unread name, asserts the seven are among them, and refuses any change to the frozen 56-name
  list that is not a deliberate edit. The guard is compiler-driven because a text scan counts a name
  mentioned in prose as a read - written that way, it missed all seven.
- Vendor cache behaviour (whether the provider bills what the prefix model predicts) needs a real key
  and two measured rounds; nothing here claims it.

### Which prettier the format gate uses

The format gate above runs the **repository root's** prettier on purpose. `.husky/pre-commit`
executes `npx lint-staged` from the root, and the root's config formats with prettier 3.5.3,
while `packages/cli` declares `^3.6.2` and resolves 3.9.10. The two disagree about 28 files in
this package, and content written by the newer binary is rewritten back by the hook before the
commit lands - the hook then refuses the commit as empty. A gate that asserted the newer
format would be asserting something the repository cannot produce, so the command names the
binary that actually decides the shipped bytes.

Revisit when the root dependencies are next upgraded with authorization: once root prettier and
this package's declared range resolve to the same version, go back to `npx prettier --check`
and the 28-file reformat becomes an ordinary one-line commit.
