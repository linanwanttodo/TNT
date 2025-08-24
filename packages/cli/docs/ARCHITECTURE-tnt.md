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
original mode, so replacing a file keeps its link and its permissions.

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
touch code.

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

Compaction trades against this: summarising history rewrites the prefix. That
cost is tracked separately - `SessionUsage.compaction` in `core/index.d.ts`,
accumulated in `src/session/index.ts`, and rendered next to the hit ratio in
`src/ui/components/BottomStatusBar.tsx`. Seeing both numbers on one line is the
point: compaction spending that erases cache reuse is not a saving.

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
  feedback, anything else is a non-blocking error. Config is merged from user,
  project and project-local files for both `.tnt/` and `.claude/`.

A hook or plugin script that throws never aborts the agent loop; failures are
reported and the turn continues.

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
`src/subagent/runContext.ts` narrows them into a new context: a restricted
delegate loses `Bash`, `Edit`, `Write`, `MultiEdit`, `ApplyPatch`, `Create`,
`Checklist` and `UploadArtifact`, every "ask" becomes a decision the child may
not make for itself, and the parent's own permissions object is left untouched,
so returning to the parent restores exactly what it had. The narrowing appends
its exclusions ahead of any star rule, because the checker takes the first
matching policy.

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

4. Plugin-declared settings are parsed but only a key whitelist is honoured in
   the settings cascade.
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
   model either, which is a deliberate boundary. Nothing in the retrieval
   workstream is unwired now; what is missing needs a real environment or an
   interface: an indexing progress UI, and a user-facing way to pick an
   embeddings model. One packaging note:
   `packages/cli/package-lock.json` was regenerated on 2026-10-14 - the
   old lock failed npm's own link validation, so `npm install` refused to run
   and a fresh clone could not set up - and `npm ci --dry-run` now passes,
   with the new runtime dependencies (`sqlite3` and the optional embedding
   stack) recorded. The locks of some sibling packages (`openai-adapters`)
   still contain pre-move paths from an earlier directory layout; whether
   they block their own installs has not been verified.
