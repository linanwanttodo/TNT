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
- When the prefix does move, `cache/cacheBreakReport.ts` writes the reasons, both hit ratios and the
  named section changes (`describeSystemMessageTextChange` in `agent/systemMessage.ts`) to
  `cache-breaks/<session>/` beside the session store.

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
    cd ../packages/openai-adapters && npm run build && npx vitest run

The ratchet itself:

    npx vitest run src/architecture.test.ts

It counts production sources under `src/` (tests, `test-utils` and `__mocks__` excluded), freezes the
mutually importing group pairs in `KNOWN_MUTUAL_COUPLING` (21 pairs as of this writing, each listed by
name in the file), fails on a new pair, allows `utils ->` only for the four exemptions it names, and
fails if the scan finds fewer than 250 files so an empty scan cannot pass.

## Open by decision, not by oversight

- Three prompt-canon choices are the owner's: citation format, whether `Read` prints line numbers,
  and how auto mode is selected.
- `mode` stays out of the prefix identity until a sticky-prefix scheme needs it back.
- The `continue-cli` literal in `services/GitAiIntegrationService.ts` is a label handed to git-ai and
  is an external contract.
- Vendor cache behaviour (whether the provider bills what the prefix model predicts) needs a real key
  and two measured rounds; nothing here claims it.
