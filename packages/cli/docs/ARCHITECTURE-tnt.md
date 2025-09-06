# TNT architecture: what changed from Continue, and what was borrowed

Scope: `packages/cli` plus the `core/` engine it drives. The Ink TUI, the VS Code
extension and the IntelliJ plugin are parked under `ide/` and are not part of
this design.

Every statement here names a file that exists in this repository. Nothing is
described as working that is not wired up; open gaps are listed in section 8.

## 1. Process shape

Continue's core was written for an IDE host: a protocol server, a browser GUI
consumer, and a `core/continueServer` HTTP client for cloud features. TNT keeps
the engine but replaces the host with a terminal process.

| Path                                                                                                                                        | Role                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/index.ts`                                                                                                                              | commander entry point; headless, TUI and standard modes |
| `src/dev.ts`                                                                                                                                | tsx development runner, no build step                   |
| `src/startup/`                                                                                                                              | console interception, onboarding, banner, version       |
| `src/services/`                                                                                                                             | long-lived services resolved through `ServiceContainer` |
| `src/stream/`, `src/loop/`, `src/tools/`, `src/permissions/`, `src/cache/`, `src/plugins/`, `src/hooks/`, `src/subagent/`, `src/telemetry/` | agent engine                                            |

Long-lived resources are swept on the way out, not left to the operating
system: language servers, background jobs, review workers and MCP connections
each register a synchronous sweep on `exit`, because several code paths call
`process.exit` directly and would otherwise bypass the graceful shutdown that
flushes telemetry. The MCP and resource-monitoring sweeps go through
`utils/processShutdown.ts`, which attaches one set of process listeners per
process and keys each callback by owner, so constructing a service a second
time replaces its callback instead of stacking more handlers. A review worker
is also stopped as soon as it reports its result, since its work is finished at
that point.

There is no `core/continueServer` reference anywhere under `src/`. The only
outbound hosts are model providers, `api.workos.com` for optional account auth,
and `github.com` for tool and plugin fetches. `api.continue.dev` does not appear
in `packages/cli/src` or in `core`.

Writes that a crash would leave corrupt go through `core/util/atomicWrite.ts`:
session files, the global context, the config file and every file the edit
tools rewrite. It writes a uniquely named temporary file beside the target and
renames it over the real path, resolving symlinks first and carrying over the
original mode, so replacing a file keeps its link and its permissions. A
session file carries every optional `Session` field, not just the ordered core
keys: the goal, the output style, the delegation link and depth are read back
from the file, and the writer copies whatever else the session carries. A new
session is titled on the first assistant response in both the TUI and headless
runs; headless pays one extra non-streaming completion for it, which the e2e
suites pin so the cost stays visible. Switching conversations - the `tnt ls`
picker or the in-TUI selector - goes through `selectSession`, which also moves
the `SessionManager`, so new turns append to the session on screen instead of
to whatever session the process happened to start with. The id travels to the
TUI through typed options (`StartTUIChatOptions`), so a hop that drops it is a
compile error rather than a silent fallback to the newest session.

Atomicity covers the write, not the world around it. `src/tools/fileState.ts`
records what each file looked like the last time the model was shown it - by
`Read`, and by every write the agent itself makes, so its own edit never looks
like somebody else's change. `Edit` and `MultiEdit` refuse a file whose size,
mtime or inode moved since that record and `Write` refuses the same; a file that
was never read through TNT is still written, because no claim about its contents
was made. The deciding check sits in `run`, not in the preview: the replacement is
computed while planning, and a permission prompt can outlast that, so the bytes
about to be replaced are compared against the content the plan was built from. A
rewrite in the same millisecond that keeps the same size and inode stays
undetectable - content hashing would catch it at the cost of reading every target
twice per edit.

## 2. Mode axis

Three modes, fixed constants, no settings entry: `agent`, `plan`, `auto`
(`src/permissions/types.ts`). Shift+Tab cycles them
(`src/ui/hooks/useUserInput.ts`); `agent` renders no badge.

Policies are per-mode lists in `src/permissions/defaultPolicies.ts`, and a
policy can carry two argument-scoped constraints:

- `readOnlyOnly` - a terminal tool may run only commands that cannot write.
  Classification lives in `src/permissions/readOnlyCommand.ts`; anything the
  classifier does not recognize is refused rather than allowed.
- `docsOnly` - write tools are allowed only against documentation paths.
  `src/permissions/documentPath.ts` accepts `.md`, `.mdx`, `.markdown`, `.rst`,
  `.txt` in any directory and refuses everything else, including a call whose
  argument shape names no recognizable path.

Runtime enforcement is in `src/permissions/permissionChecker.ts`. When it
refuses, the reason string is carried to the model as the tool result message
(`src/stream/streamChatResponse.helpers.ts`), so the model can correct itself
instead of retrying blind. This is why `plan` can produce a written plan but not
touch code. A headless run cannot prompt, so its default policies allow what
the TUI asks about - Edit, MultiEdit, Write and Bash - and the request carries
those tools; `--ask` and `--exclude` still narrow a run, and a tool left on
`ask` in headless is withheld rather than silently allowed.

## 3. Todo layer

`src/tools/todo.ts` gives the model an explicit, ordered work list that
survives compaction. The list is not stored in a file: it is replayed from
the Todo tool results in the history, and compaction carries the current list
forward on its summary message (same payload format, readable to the model),
so the replay still reconstructs it once the tool results it came from have
been summarized away. Without the carry, a `Todo list` call after a
compaction answered with an empty list. It is allowed in every mode,
including `plan`.

## 4. Cache prefix engineering

Prompt cache reuse is the reason most of the request-shaping code exists.

- `packages/openai-adapters/src/apis/cacheControl.ts` applies provider-specific
  `cache_control` breakpoints, keeps at most `DEFAULT_MAX_CACHE_BREAKPOINTS`
  (4), prunes stale breakpoints with a sliding window, and strips reasoning
  blocks that would otherwise invalidate the prefix.
- `src/cache/prefixState.ts` classifies each request as `full`, `passthrough` or
  `invalidated` with reasons, and attributes a loss to either `prefix` (our
  shaping) or `provider` (vendor behaviour).
- `src/cache/promptCacheKey.ts` produces the key used to compare rounds.
- `src/stream/streamChatResponse.ts` logs per-request cache usage, so a hit-rate
  regression is attributable to a change rather than to the vendor.
- `src/agent/atMentions.ts` is what `@path` in a prompt means. All three surfaces
  expand it into context items on the user message before the first request, so
  the model reads the file the user pointed at instead of spending a round on
  `Read`: ranges (`@f.ts:10-20`), directories as a capped listing, and a per-file
  and per-prompt character budget so one prompt cannot pull the repository into
  the header. A mention that could not be honoured is reported to the model in its
  own block and the user's text is left exactly as typed, and the expansion records
  the file in `fileState`, so an edit after a mention is allowed while an outside
  change to it is still caught. Files the interface already attached are not paid
  for twice.
- `src/stream/toolResultStorage.ts` bounds what one tool answer costs for the rest
  of the session. A result over `CONTINUE_CLI_MAX_TOOL_RESULT_CHARS` (25,000 by
  default) is written whole under `tool-results/<session>/` beside the session
  store, and the model is handed a 2,000-character head plus that path, so the
  remainder stays reachable instead of being cut. The call is made once, when the
  result is created, which is what keeps the prefix intact - trimming old results
  later would rewrite every byte after them. The store keeps the newest 50 results
  per session, flattens a path-shaped call id into the directory rather than out of
  it, and when the write itself fails falls back to cutting at the inline budget, so
  a "shortened" answer is never longer than the original.

Compaction trades against this: summarising history rewrites the prefix. That
cost is tracked separately - `SessionUsage.compaction` in `core/index.d.ts`,
accumulated in `src/session/index.ts`, and rendered next to the hit ratio in
`src/ui/components/BottomStatusBar.tsx`. Seeing both numbers on one line is the
point: compaction spending that erases cache reuse is not a saving.

The threshold that triggers a compaction is a local estimate, so the provider can
still refuse. `src/utils/contextLength.ts` owns the vendor phrasings for that
refusal and both layers read it: the backoff stops retrying a request that will
never fit, and `classifyStreamError` names the round `context_overflow`, so the loop
compacts under force - skipping the estimate that just proved wrong - and resends,
bounded by `OVERFLOW_RECOVERIES` before it gives up quoting the provider. A refusal
for length used to be thrown, which ended the turn having spent the whole context
on a request that never ran.

## 5. Plugin and hook compatibility

The plugin layer reads the existing ecosystem layout instead of inventing one.

- `src/plugins/directories.ts` mirrors `~/.tnt/plugins/{known_marketplaces.json,
installed_plugins.json, marketplaces/<name>/, cache/<marketplace>/<plugin>/<version>/,
data/<plugin-id>/}` and reads `~/.claude/plugins/cache` as a second search
  root, so an existing install tree is discovered without migration.
- `src/plugins/manifest.ts` loads `.claude-plugin/plugin.json`, ids take the
  form `name@marketplace`, and `${CLAUDE_PLUGIN_ROOT}` plus a lazily created data
  directory are substituted into plugin content.
- `src/plugins/loader.ts` resolves hooks, commands, agents, skills, MCP servers,
  output styles and LSP server declarations, and blocks reserved marketplace
  names.
- `src/plugins/marketplaceRegistry.ts` and `marketplaceSources.ts` register a
  marketplace and fetch it from `directory`, `file`, `url`, `github`, `git` or
  `npm`. Git runs with credential prompts disabled and strict host key
  checking; an unchanged source reuses its checkout; a checkout that cannot be
  pulled is replaced. `src/plugins/marketplaceManager.ts` validates the fetched
  manifest before recording it, refusing a name that impersonates an official
  catalogue and a reserved name served from a non-official source.
  `src/lsp/` starts a plugin's declared language server over stdio, keeps
  request correlation and timeouts, and collects published diagnostics. The
  model reaches it through read-only tools: `Diagnostics` checks its own edit,
  `FindSymbol` locates a declaration, `Hover` reads a signature and `Completion`
  lists what can be written next. Servers are killed when the process exits,
  which is why a session cannot leave one running behind it.
  `/plugin marketplace add|list|remove` is the user-facing entry point, and
  `src/plugins/pluginInstall.ts` installs one plugin from a resolved
  marketplace into `cache/<marketplace>/<plugin>/<version>/`, which is exactly
  where `discoverInstalledPlugins` looks, then records it in
  `installed_plugins.json` as scope `user`.
- `src/hooks/` implements `command`, `http`, `prompt` and `agent` hook types with
  Claude Code exit-code semantics: 0 proceeds, 2 blocks and turns stderr into
  feedback, anything else is a non-blocking error. The two LLM-backed types
  resolve their declared `model` against the configured models - by entry name or
  model id - and an unset or unknown name runs the session's own model with the
  fallback logged, because a check that silently changed models is a different
  cost than the one the hook author asked for. Config is merged from user,
  project and project-local files for both `.tnt/` and `.claude/`. Lifecycle
  events fire in headless runs too: a `tnt -p` session emits SessionStart,
  UserPromptSubmit, Stop and SessionEnd around its turn, and a blocking
  UserPromptSubmit ends the run with a nonzero exit - the contract a CI job's
  hooks.json depends on (serve still fires the tool hooks only). A PreToolUse
  hook's stdout fields are honored beyond its exit code: the hook runs before
  the permission check, `permissionDecision: "allow"` skips the policy check
  for that call, and `updatedInput` replaces the arguments the check and the
  execution both see; `"ask"` is an escalation rather than a fallthrough, so a
  hook can force the human prompt for a call the policy would have allowed, and
  its reason rides at the front of the preview the prompt shows. An `"exclude"`
  still outranks the hook - a policy refusal is not reopened by an escalation,
  and in headless an escalation is refused because nobody is there to answer it.
  The same three events' `additionalContext` is a note to the model: the
  reference delivers it as its own meta message, but the chat protocol wants
  exactly one tool message per call, so it rides inside that call's result,
  attributed as `PreToolUse:<tool> hook additional context: ...`. A call that
  survives both checks and still needs the human fires a PermissionRequest hook
  first; only when that hook leaves the decision to the user does a Notification
  of type `permission_prompt` precede the prompt, so a notifier hook never
  reports a prompt that never opened.

A hook or plugin script that throws never aborts the agent loop; failures are
reported and the turn continues. A command hook that outlives its timeout is
failed, never read as a success from the killed process's missing exit code,
and it is killed together with the process group it started - the shell is
rarely the work - with its output capped, so a runaway hook cannot flood the
turn or leave background work behind.

## 6. Subagents

`src/subagent/depth.ts` fixes `DEFAULT_MAX_SUBAGENT_DEPTH = 1`: a subagent may
not dispatch another subagent. Deeper nesting multiplies system prompts and tool
definitions per request, which is the fastest way to lose the cache reuse
described in section 4.

The tool the model is offered is built from the registry entry with one
deliberate override: the agent-name parameter's description points at the
listing tool, which is a separate call. Everything else comes from the entry, and
a test pins that derivation so the schema the model sees cannot drift from the
one the registry describes.

Delegation is allowed in every mode, including plan mode, because the child
context narrows what the parent had: a delegate cannot exceed the restrictions
of the session that started it. Nothing is left to a default either: a tool with
no policy falls back to prompting, so a test checks that every tool a run is
actually offered has an explicit rule in both the agent and plan lists. It reads
the list a run is offered rather than the static registry, because the beta
gated tools are only built at runtime and an earlier version of the check could
not see them. Those tools are also registered, since other consumers read the
registry directly: an agent file that names the tools it may use excludes every
other built-in by name, and a tool missing from the registry would escape that
allowlist through the catch-all rule.

A delegation never inherits the parent's permissions unchanged.
`src/subagent/runContext.ts` narrows them into a new context under one of two
restrictions: `no-writes` excludes the file mutators and keeps `Bash`, `readonly`
excludes both. The distinction is what a verifier lives on - without the shell it
can only read code and guess - and the child is told which restriction applies,
because a tool it no longer has is otherwise invisible to it. Every "ask" becomes
a decision the child may not make for itself, and the parent's own permissions
object is left untouched, so returning to the parent restores exactly what it
had. The narrowing appends its exclusions ahead of any star rule, because the
checker takes the first matching policy.

`src/subagent/builtInAgents.ts` is what declares a restriction. A configured agent
is a model entry with the `subagent` role, which fits models a user chooses and not
a role defined by what it does, so built-ins are appended to the registry on top of
the model the session already runs, and a configured agent that takes the same name
wins - that is the user overriding a default. `verification` is the first: run the
build, the tests and the linters before claiming anything, paste the output that
was judged, and end with the verdict line the executor parses, with `PARTIAL`
reserved for a check the environment made impossible.

A delegated check should end in a finding the caller can branch on rather than a
paragraph it has to re-read. `src/subagent/verdict.ts` reads a stand-alone
`VERDICT: PASS|FAIL|PARTIAL` line out of the child's report - the last one wins,
so a report that quotes the format does not report a result - the executor
carries it on `SubAgentResult.verdict`, and the delegation tool writes it into
`<task_metadata>` alongside the status. Any declared agent can be written against
the same contract: an agent file, or a plugin's `agent` hook.

## 7. What is deliberately not translated

Only terminal copy goes through the translator. Three classes of string stay in
English on purpose:

1. HTTP payloads served by `tnt serve` and the platform client. They are a
   protocol, not prose; translating them would break clients and every test that
   pins the wire format.
2. Log lines written through `logger`. Log files are read by support and
   grepped by hand, so one language there beats two.
   Composed output is translated too, but as one key per block rather than per
   line: the `tnt serve` banner and the `tnt checks` summary each have a formatter
   (`src/commands/serve.help.ts`, `formatChecksSummary`) so the wording is
   testable without running the command, and the endpoint list keeps its column
   alignment inside a single translated value.
   The slash command surface follows the same rule: the `/help` screen,
   `/todos`, `/clear` and `/exit` copy, the `/skills` listing and the `/index`
   messages all come from the dictionary, so a locale change reaches every
   screen the commands print. The interactive panels follow it too: the MCP
   selector reads its header, menu, server detail view and status words from
   the dictionary, and its test renders the frame in `zh-CN` to pin that.

## 8. Verification gates

Three commands, run from `packages/cli`, must all pass before a commit:

```
npx tsc --noEmit
npx vitest run --reporter=json --outputFile=/tmp/tnt-vitest.json
npx prettier --check "src/**/*.{ts,tsx}"
```

`npm run build` is the fourth check for anything touching the bundle. Green
vitest does not imply a clean compile and vice versa; the two are verified
separately, because a missing import in code with no test coverage passes one and
fails the other.

Suite layout follows the module tree: every test sits next to its subject, and
cross-cutting suites are named by what they prove.

- `e2e/` drives the built binary (`npm run test:e2e`) and sits at the package
  root, outside `src/`.
- `smoke-api/` runs against a real provider (`npm run test:smoke-api`).
- `src/integration-tests/` holds the one suite that has no single CLI subject.
- `*.integration.test.ts` files sit beside their subject and run in the default
  pass.

`tsconfig.json` includes `src/**/*`, `e2e/**/*` and `smoke-api/**/*` so that the
suites outside `src/` are still type-checked. Hand-written mocks are only read
by vitest when they sit in `__mocks__` next to the mocked module.

## 9. Known gaps

Stated as gaps, not as intentions:

1. Marketplace plugins install from a relative path, `github:`, `git:`,
   `url:` or `npm:` source, and a catalogue written for the reference tool
   works too: an object source is accepted and a url source is fetched as a
   git repository, which is what the name means there. A `git-subdir` source
   clones and then keeps only the named directory, a `pip` source is refused
   by name because the reference does not support it either, and an unclaimed
   scheme is refused rather than guessed at. Entry dependencies install first,
   once each, with a cycle refused and a cross-marketplace dependency allowed
   only when the declaring manifest lists that marketplace.
   `/plugin marketplace refresh` re-reads a marketplace and updates the
   installed plugins whose version moved, deciding "changed" from a digest
   stored at the last read; it will not remove an installed plugin whose entry
   disappeared, since that stays a user decision.

2. `lspServers` drives a real client. The model reaches it through four
   read-only tools: `Diagnostics` returns what a server published for a file
   (opening it, or pushing the new text when it changed), `FindSymbol` answers
   where a name is declared, `Hover` reads the signature at a position and
   `Completion` lists what can be written there, so the set covers locating a
   symbol, reading its shape and seeing the members in scope. `/diagnostics
<file>` stays for the user, and server failures are logged rather than
   thrown. Missing: rename is not exposed, and servers still start lazily on
   first use rather than at session start.

3. Output styles resolve in this order: the session choice made with
   `/output-style <plugin:style>`, then an `outputStyle` key in one of the six
   settings files, then a style a plugin forces on. `/output-style save [name]`
   writes the choice into the project's `.tnt/settings.json` - keeping every
   other key in the file, written atomically - so setting a project default no
   longer means editing the file by hand; with nothing selected or named the
   command refuses rather than guessing, and clearing the session choice never
   touches the file.

4. Plugin-declared settings are the lowest layer of the settings cascade,
   matching the reference tool: the `settings` record of every installed
   plugin's manifest is merged (name order, a later plugin wins a key) with
   only allowlisted keys kept, and every one of the six settings files
   overrides it. The allowlist is deliberately one key - `outputStyle` -
   because a key only belongs there once something in the CLI reads it from
   the settings; the reference's own allowlist is likewise a single key
   (`agent`), which TNT still has no consumer for.
5. Vendor-side cache behaviour is not verified on this machine. Proving that a
   provider accepts these cache parameters needs a real API key and two
   consecutive rounds of the same prompt against the same model; until then no
   claim about provider acceptance is recorded here.

6. Retrieval over a large codebase is the largest missing piece, and its
   foundation now exists. `core` carries the whole stack - `CodebaseIndexer`,
   a vector index (LanceDB), a full-text index and tree-sitter chunking - and
   `src/retrieval/service.ts` hosts it for the CLI: it loads the same
   config.yaml through core's `ConfigHandler`, indexes the workspace through
   `FileSystemIde` (reporting the `cli` IDE type, so no editor defaults leak
   into the config) and answers `search()` from the full-text index.
   `src/retrieval/service.test.ts` proves the loop end to end - index a temp
   workspace, then find a symbol in it - and two core defects came out of
   that: the indexer refused to build anything without an embeddings model
   (full-text search needs none) and built the readers before the chunk index
   they read, so a first index of a workspace produced an empty full-text
   index. Both are fixed. The bundle can carry the service: the native pieces
   stay external and are declared as dependencies (`sqlite3` for the index
   store; onnxruntime and vectordb are optional and only load on the
   embeddings path), the ESM bundle derives `__dirname` from its own URL, and
   the build copies the tokenizer workers, the tree-sitter runtime and the 27
   grammars the chunker understands next to the bundle - all of them are
   loaded by path at runtime. A probe build with the service reachable ran the
   whole loop from `dist/index.js`; the bundle grows from 12.8 MB to about
   30 MB when the service is included. The model now reaches the index through
   `CodebaseSearch`, a read-only tool that takes a query and returns the best
   chunks with file paths and line ranges, capped per chunk and per call and
   divided by the parallel tool-call count; it builds the index on first use
   and reuses it afterwards, serializing concurrent first calls. The tool is
   in both permission lists, and the coverage guard in the test suite names it
   if a future policy edit drops it. Every write through the edit tools
   schedules a per-file refresh (`src/retrieval/writeRefresh.ts`), so a search
   never reads stale chunks for a file the agent just changed; the refresh
   runs only when the workspace already has an index, so a project that never
   searches never pays for indexing, and the import is lazy so a write does
   not load the index machinery or fail with it. `/index` rebuilds the index
   and `/index status` reports whether the workspace has one, both in the
   active locale; the rebuild is awaited, so a large workspace makes the
   command wait rather than pretend the work happened, and a progress UI and
   a config-without-a-codebase-provider refusal are the visible edges of that.
   With an embeddings model selected in the config, the indexer also builds
   the vector index and `search()` asks it too, merging its hits behind the
   full-text ones with duplicates dropped and the combined list capped
   (`mergeHits`). The vector half is proven offline in core with a
   deterministic fake provider (`core/indexing/LanceDbIndex.vitest.ts`), so no
   test ever downloads model weights; no test exercises a real embeddings
   model either, which is a deliberate boundary. A local embeddings model is
   selectable from the config on every host - `provider: transformers.js`
   under `roles: [embed]` needs no key and runs from the bundled weights - and
   `/index status` names that option whenever the index is full-text only.
   An index build runs in the background rather than freezing the command:
   `/index` starts it (a start that overlaps a running build joins it), and
   `/index status` reports the indexer's own progress line while it runs, the
   failure message when the indexer gave up, and the final state after that -
   a workspace that was never built still reads as "no index" until a build
   is started. `/index embed` is the picker: it lists the embed-role models,
   re-reading the config first so an edit to config.yaml is seen, and
   `/index embed <name>` stores the choice in the global context - where the
   config load and the editors both keep model selections - and drops the
   cached vector index, so the next search builds against the new model. A
   transformers.js entry is named by its config `name` and uses the bundled
   weights; its `model` field is not read, since downloads are off. One
   packaging note:
   `packages/cli/package-lock.json` was regenerated on 2026-10-14 - the
   old lock failed npm's own link validation, so `npm install` refused to run
   and a fresh clone could not set up - and `npm ci --dry-run` now passes,
   with the new runtime dependencies (`sqlite3` and the optional embedding
   stack) recorded. The locks of some sibling packages (`openai-adapters`)
   still contain pre-move paths from an earlier directory layout; whether
   they block their own installs has not been verified.

7. Sessions persist as one file per conversation plus a `sessions.json` list.
   The writer carries every optional `Session` field - the goal, the output
   style, the delegation link and depth - so the root list hides delegated
   transcripts, a resumed child keeps its depth, and resume restores goal and
   style; selecting a conversation (`tnt ls` or the in-TUI picker) loads it
   and moves the `SessionManager`, with the id travelling through typed
   options so a dropped hop is a compile error. A plain `--resume` opens the
   newest root conversation of the current directory only - crossing into
   another project's transcript is what the picker is for. A new session is
   titled on the first assistant response in both the TUI and headless runs.
   Known
   limit: `sessions.json` is a read-modify-write file, so two `tnt` processes
   saving in the same instant can lose one list entry - the session file
   itself is safe (atomic write) and stays loadable by id. `clearSession`
   remains a test reset helper: it deletes the session file but not its list
   entry.
