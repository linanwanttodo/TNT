# TNT CLI architecture

Scope: `packages/cli`, `core/`, `packages/*`. The IDE extensions and `gui/` are not part of this
engine. Every number below is produced by a command in "How to verify", not by hand: if a command
stops agreeing with the text, the text is wrong.

## Layout

`src/` is grouped by layer; only entry points sit at the top level. The grouping is what
`src/architecture.test.ts` measures, so the directory names are load-bearing, not cosmetic.

| Path                                                                                                    | Role                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `index.ts`, `dev.ts`                                                                                    | bundled entry point and the tsx dev runner                                                                             |
| `agent/`                                                                                                | system prompt assembly (`systemMessage.ts` builds the prefix as named sections)                                        |
| `stream/`, `loop/`, `tools/`, `permissions/`, `cache/`, `plugins/`, `hooks/`, `subagent/`, `telemetry/` | the agent engine                                                                                                       |
| `commands/`, `ui/commands/`                                                                             | argv subcommands (`chat`, `serve`, `ls`, `review`, `checks`) and the slash-command pipeline - two separate dispatchers |
| `services/`                                                                                             | long-lived services resolved through `ServiceContainer`                                                                |
| `config/`, `session/`, `startup/`, `platform/`                                                          | config loading, session store, bootstrap, platform client                                                              |
| `i18n/`                                                                                                 | translations and locale switching                                                                                      |
| `utils/`                                                                                                | leaf helpers; it may not reach upward except through the exemptions the ratchet lists                                  |

## One engine, three surfaces

`stream/streamChatResponse.ts` runs the turn loop for all three surfaces: the Ink TUI
(`ui/hooks/useChat.ts`), headless `-p` (`commands/chat.ts`) and `tnt serve`. Per-turn guards live
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
- Carrying is declared by the adapter, not assumed from a provider name:
  `packages/openai-adapters/src/apis/base.ts` `carriesInHistorySystemMessages(model)` is implemented
  only by `OpenAIApi`'s chat route. `Anthropic`, `Bedrock`, `AiSdk`, `Cohere` and `Gemini` lift a
  single system message into their own field and filter the rest, so an append there would be
  dropped; forcing one through configuration is logged.
- `mode`, `sessionId` and similar CLI state are not part of the prefix identity
  (`cache/requestHeader.ts` `canonicalHeader`), because they never reach a provider.
- Switching permission mode mid-turn takes effect on the next tool round and is not announced:
  `stream/streamChatResponse.ts` re-reads `toolPermissions.getState().currentMode` per round (712
  for the prompt, 771 for the request header), so nothing freezes the mode and nothing prints that
  it moved. What keeps the cache is the shape of the sections instead - `auto` adds no section of
  its own and `plan` adds only the volatile `planMode` one - which is what
  `agent/systemMessage.sections.test.ts` holds. A turn that switches between `auto` and `agent`
  therefore rebills nothing, and immediate effect is what a switch is for.
- When the prefix does move, `cache/cacheBreakReport.ts` writes the reasons, both hit ratios and the
  named section changes (`describeSystemMessageTextChange` in `agent/systemMessage.ts`) to
  `cache-breaks/<session>/` beside the session store.
- Counts reported in a chunk that carries no choices - the trailing metadata event of a provider like
  Bedrock - are still metered: `stream/streamChatResponse.ts` reads `chunk.usage` ahead of the choice
  guard, and `e2e/headless-usage-only-chunk.test.ts` pins it through to the saved session.

## Tools and permissions

- Registration: `tools/builtInToolNames.ts` (names), `tools/allBuiltIns.ts` (instances, used for
  display names and policy lookups), `tools/index.tsx` `getAllAvailableTools` (what a run is
  actually offered, sorted by name because the tool list is part of the cached prefix).
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
on a `console.*` literal with words that never went through `t()`.

## How to verify

From `packages/cli`:

    npx tsc --noEmit
    npm run lint
    npx prettier --check "src/**/*.{ts,tsx}"
    npx vitest run
    npm run build
    npx vitest run --config vitest.e2e.config.ts

Two packages own their own gates, because the CLI neither runs their tests nor reads their sources:

    cd ../../core && npm run build && npx vitest run
    cd ../../core && npm test
    cd ../packages/openai-adapters && npm run build && npx vitest run

`core` has two runners and the vitest one sees only half the suite: `vitest.config.ts` includes
`**/*.vitest.ts` (109 files), while `npm test` runs jest over 59 `*.test.ts` files, so a green
`npx vitest run` there says nothing about the other half. The jest lane needs `npm test` rather than
a bare `npx jest` because the script sets `NODE_OPTIONS=--experimental-vm-modules`, without which the
setup file's `node-fetch` import fails and all 59 suites report a load error. In an environment with
no provider credentials it also needs `IGNORE_API_KEY_TESTS=true`, the switch `llm/llm.test.ts`
already documents, because that suite calls the live APIs and otherwise dies on 401. Measured at
this writing: vitest lane 447 suites / 1737 passed / 0 failed / 16 pending; jest lane 51 passed
suites / 8 skipped / 0 failed and 850 passed / 95 skipped.

The ratchet itself:

    npx vitest run src/architecture.test.ts

It counts production sources under `src/` (tests, `test-utils` and `__mocks__` excluded), freezes the
mutually importing group pairs in `KNOWN_MUTUAL_COUPLING` (22 pairs as of this writing, each listed by
name in the file), fails on a new pair, allows `utils ->` only for the four exemptions it names, and
fails if the scan finds fewer than 250 files so an empty scan cannot pass.

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
  is the owner's chosen format and is not shipped yet: it needs the token counts plumbed into
  `ui/components/BottomStatusBar.tsx`, and whether one line fits his terminal is a read-back, not a
  test.
- The `continue-cli` literal in `services/GitAiIntegrationService.ts` is a label handed to git-ai and
  is an external contract.
- Vendor cache behaviour (whether the provider bills what the prefix model predicts) needs a real key
  and two measured rounds; nothing here claims it.
