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

There is no `core/continueServer` reference anywhere under `src/`. The only
outbound hosts are model providers, `api.workos.com` for optional account auth,
and `github.com` for tool and plugin fetches. `api.continue.dev` does not appear
in `packages/cli/src` or in `core`.

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

`src/tools/todo.ts` gives the model an explicit, ordered work list that survives
compaction, rather than relying on prose in the system prompt to hold state. It
is allowed in every mode, including `plan`.

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
  model reaches them through the read-only `Diagnostics` tool, which lets it
  check its own edit instead of guessing.
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

1. Marketplace plugins install from a relative path, `github:`, `git:` or
   `npm:` source; a plugin declared with any other scheme is refused rather
   than guessed at, and `url:`-style plugin descriptors are not implemented.
   Entry dependencies install first, once each, with a cycle refused and a
   cross-marketplace dependency allowed only when the declaring manifest lists
   that marketplace. `/plugin marketplace refresh` re-reads a marketplace and
   updates the installed plugins whose version moved, deciding "changed" from
   a digest stored at the last read; it will not remove an installed plugin
   whose entry disappeared, since that stays a user decision.

2. `lspServers` drives a real client. The model reaches it through two
   read-only tools: `Diagnostics` returns what a server published for a file
   (opening it, or pushing the new text when it changed) and `FindSymbol`
   answers where a name is declared through `workspace/symbol`, which a text
   search cannot answer on its own. `/diagnostics <file>` stays for the user,
   and server failures are logged rather than thrown. Missing: hover,
   completion and rename are not exposed, and servers still start lazily on
   first use rather than at session start.

3. Output styles resolve in this order: the session choice made with
   `/output-style <plugin:style>`, then an `outputStyle` key in one of the six
   settings files, then a style a plugin forces on. The remaining gap is that
   the command writes only the session, so setting a project default still
   means editing a settings file by hand.

4. Plugin-declared settings are parsed but only a key whitelist is honoured in
   the settings cascade.
5. Vendor-side cache behaviour is not verified on this machine. Proving that a
   provider accepts these cache parameters needs a real API key and two
   consecutive rounds of the same prompt against the same model; until then no
   claim about provider acceptance is recorded here.
