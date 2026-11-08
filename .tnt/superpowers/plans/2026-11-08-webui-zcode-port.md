# WebUI ZCode Desktop Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TNT's webui frontend with ZCode's desktop UI verbatim (vendored package closure), drive it over ZCode's WebSocket RPC contract, and back the service layer with TNT's engine.

**Architecture:** Ten ZCode packages are vendored under `packages/zcode-ui/` with `@zcode/*` names unchanged. The browser entry (`packages/zcode-ui/web`) connects via `connectViaWebSocket` to a new `/ws` upgrade route on TNT's existing express server, which exposes a `ServiceCollection` over `@zcode/rpc`'s `SocketProtocol`/`ChannelServer` (pattern copied from ZCode's `packages/server/src/http.ts`). Engine-independent services (file, git, terminal, settings, broadcast) reuse their vendored implementations; `IZCodeAgentService` is implemented by TNT in `packages/cli/src/webuiZcode/` against TNT's engine singletons for the host workspace, and additional workspaces are served by spawned `tnt app-server --stdio` child processes speaking the same protocol.

**Tech Stack:** TypeScript (TNT 5.8 for CLI code; vendored packages carry their own TS 6), React 19, Vite, Tailwind 4, `@zcode/rpc` ChannelServer, express 5 + `ws`, vitest.

**Spec:** `.tnt/superpowers/specs/2026-11-08-webui-zcode-port-design.md`

## Global Constraints

- Node `>=24` everywhere: `packages/cli/package.json` engines, `scripts/install.sh` `REQUIRED_NODE_VERSION="24.0.0"`, `.nvmrc`, CI matrices (`.github/workflows/cli-pr-checks.yml`, `cli-release.yml`).
- `packages/zcode-ui/*` is vendored: no prettier/eslint/tsc coverage from TNT guards; each vendored package installs with npm and builds with its own `typescript@^6.0.2`.
- No root `workspaces` field; zcode-ui packages are self-contained installs chained into `build:local-deps`.
- Vendored package names stay `@zcode/*`; `workspace:*` dependency values become `file:../<name>`.
- No cloud-dependent features: subscription/billing/Stripe/cloud content/account OAuth/marketing — not implemented, not stubbed with fake success (unsupported errors only).
- UI files remain byte-identical except `packages/zcode-ui/web/src/main.tsx` (entry trim) and its `vite.config.ts`.
- TNT guard tests stay green; vendored trees are excluded from their scan sets explicitly, not by deletion.
- All new TNT code lives under `packages/cli/src/webuiZcode/` and must pass `npm run lint`.

## Review Focus

- WS upgrade without a valid token must be rejected (401/close), not upgraded and then gated.
- A web client reconnecting after server restart must get a fresh `ServiceCollection` scope, not stale subscribers.
- Two workspaces running turns concurrently must never share session state (sessions, queues, abort signals).
- UI calls to unimplemented services must surface a visual empty/error state, never hang forever.
- Permission answers arriving after timeout must not approve a later, unrelated request.

---

## Task 1: Vendor the ZCode package closure

**Files:**

- Create: `packages/zcode-ui/{shared,model-option-map,rpc,client,provider,provider-node,zcode-cua,services,ui,web}/` (copied trees)
- Create: `packages/zcode-ui/NOTICE.md`, `packages/zcode-ui/THIRD-PARTY-NOTICES.md` (copied from ZCode root)
- Modify: `.gitignore`, `packages/cli/.prettierignore`, `packages/cli/eslint.config.js`
- Test: `packages/cli/src/zcodeUiVendor.test.ts`

**Interfaces:**

- Produces: importable packages `@zcode/{shared,rpc,client,provider,provider-node,zcode-cua,services,ui}` installed under each consumer's `node_modules`, exposing `./src/*.ts` via `exports`.

- [ ] **Step 1: Copy the ten packages verbatim**

```bash
cd /home/lin/All_projects/GithubProjects/continue
mkdir -p packages/zcode-ui
for p in shared model-option-map rpc client provider provider-node zcode-cua services ui web; do
  cp -a /home/lin/All_projects/GithubProjects/test-continue/ZCode/packages/$p packages/zcode-ui/$p
  rm -rf packages/zcode-ui/$p/node_modules packages/zcode-ui/$p/dist
done
cp /home/lin/All_projects/GithubProjects/test-continue/ZCode/NOTICE.md packages/zcode-ui/NOTICE.md
cp /home/lin/All_projects/GithubProjects/test-continue/ZCode/THIRD-PARTY-NOTICES.md packages/zcode-ui/THIRD-PARTY-NOTICES.md
```

- [ ] **Step 2: Rewrite workspace protocols to file: links**

For every `packages/zcode-ui/*/package.json`, replace each `"@zcode/<name>": "workspace:*"` with `"@zcode/<name>": "file:../<name>"`. Run:

```bash
cd packages/zcode-ui
python3 - <<'EOF'
import json, pathlib
for manifest in pathlib.Path(".").glob("*/package.json"):
    data = json.loads(manifest.read_text())
    for key in ("dependencies", "devDependencies"):
        deps = data.get(key) or {}
        for name, value in list(deps.items()):
            if name.startswith("@zcode/") and value == "workspace:*":
                deps[name] = "file:../" + name.split("/", 1)[1]
    manifest.write_text(json.dumps(data, indent=2) + "\n")
EOF
grep -rn "workspace:\*" */package.json || true
```

Expected: no `workspace:*` matches remain.

- [ ] **Step 3: Install and build each vendored package in dependency order**

```bash
cd packages/zcode-ui
for p in model-option-map rpc shared provider provider-node zcode-cua services ui client web; do
  (cd "$p" && npm install --no-audit --no-fund) || exit 1
done
# Typecheck the packages that define a compile step; services/node.ts is the real gate.
(cd services && npx tsc --noEmit -p tsconfig.json)
(cd ui && npx tsc --noEmit -p tsconfig.json)
(cd web && npx tsc --noEmit -p tsconfig.json)
```

Expected: all three typechecks pass (or, where upstream tsconfig lines are incompatible with npm layout, add a vendored-local `tsconfig.vendor.json` extending it with `"references": []`; record any such file in the commit message).

- [ ] **Step 4: Exclude vendored trees from TNT guards**

- `.gitignore`: no new rule needed; add nothing.
- `packages/cli/.prettierignore`: append `../../packages/zcode-ui/**`.
- `packages/cli/eslint.config.js` ignores: append `"../zcode-ui/**"` next to `node_modules`.
- Verify `packages/cli/src/namingLedger.test.ts` counting: vendored tree lives under `packages/zcode-ui`, a new area, so `FROZEN_LEDGER` gains `"packages/zcode-ui": <count>`. Count it in Step 5 and update the frozen map with a comment naming the area.

- [ ] **Step 5: Write the vendor guard test**

`packages/cli/src/zcodeUiVendor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.resolve(cliRoot, "..", "zcode-ui");

describe("vendored zcode-ui closure", () => {
  it("keeps every package manifest free of workspace protocol", () => {
    for (const name of fs.readdirSync(vendorRoot)) {
      const manifest = path.join(vendorRoot, name, "package.json");
      if (!fs.existsSync(manifest)) continue;
      expect(fs.readFileSync(manifest, "utf8")).not.toContain("workspace:*");
    }
  });

  it("matches the frozen naming ledger for the vendored area", () => {
    const total = fs
      .readdirSync(vendorRoot, { recursive: true })
      .filter((entry) => typeof entry === "string" && /\.(ts|tsx)$/.test(entry))
      .reduce((sum, entry) => {
        const text = fs.readFileSync(path.join(vendorRoot, entry), "utf8");
        return sum + (text.split("Continue").length - 1);
      }, 0);
    expect(total).toBe(<N>); // <N>: replace with the measured count
  });
});
```

- [ ] **Step 6: Run the guard test and the ledger update**

Run: `cd packages/cli && npx vitest run src/zcodeUiVendor.test.ts src/namingLedger.test.ts`
Expected: both pass; `FROZEN_LEDGER` contains the measured `packages/zcode-ui` count.

- [ ] **Step 7: Commit**

```bash
git add packages/zcode-ui packages/cli/.prettierignore packages/cli/eslint.config.js \
  packages/cli/src/zcodeUiVendor.test.ts packages/cli/src/namingLedger.test.ts
git commit -m "Vendor the ZCode UI package closure"
```

---

## Task 2: Build the vendored frontend into dist/webui

**Files:**

- Modify: `packages/cli/package.json` (scripts), `packages/cli/build.mjs`, `packages/cli/src/services/webuiDist.ts`, `packages/cli/src/services/WebUiService.test.ts` (and `webuiDist` tests if present)
- Create: `packages/zcode-ui/web/vite.config.ts` (trimmed), `packages/zcode-ui/web/index.html` (copied)
- Test: `packages/cli/src/services/webuiDist.test.ts` (new or extended)

**Interfaces:**

- Produces: `npm run build` copies `packages/zcode-ui/web/dist` into `packages/cli/dist/webui`; `webuiDistCandidates()` resolves it first.

- [ ] **Step 1: Copy and trim the web entry config**

Copy `index.html` and `vite/remoteFrontendVersion.mjs` from ZCode. Replace `packages/zcode-ui/web/vite.config.ts` with a minimal config: `plugins: [react(), tailwindcss()]`, alias `"@": resolve(__dirname, "../ui/src")`, `optimizeDeps.include` for react, `worker.rollupOptions.treeshake: false`, and `define` for `__ZCODE_VERSION__`/`__ZCODE_ENV__`/`__ZCODE_COMMIT__` only when referenced. Remove OAuth/share/proxy config.

- [ ] **Step 2: Write the failing dist-candidate test**

`packages/cli/src/services/webuiDist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { webuiDistCandidates } from "./webuiDist.js";

describe("webui dist candidates", () => {
  it("prefers the zcode-ui web build before the legacy tnt-webui install", () => {
    const [first, ...rest] = webuiDistCandidates(
      "/repo/packages/cli/dist/services",
      "/repo",
    );
    expect(first).toContain("zcode-ui");
    expect(
      rest.some((p) => p.includes("node_modules") && p.includes("tnt-webui")),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and see it fail (old candidates)**

Run: `cd packages/cli && npx vitest run src/services/webuiDist.test.ts`
Expected: FAIL, first candidate is `dist/webui`.

- [ ] **Step 4: Update candidates and build script**

`webuiDist.ts` returns, in order: `packages/cli/dist/webui`, `packages/zcode-ui/web/dist`, `node_modules/tnt-webui/dist`. `package.json` gains:

```json
"build:webui": "cd ../zcode-ui/web && npm install --no-audit --no-fund && npm run build"
```

and `build` becomes `npm run build:validate && npm run build:webui && npm run build:bundle`. `build.mjs` restores the dist copy block, reading `../zcode-ui/web/dist` and failing if `index.html` is absent.

- [ ] **Step 5: Run the test and a real build**

Run: `cd packages/cli && npx vitest run src/services/webuiDist.test.ts && npm run build`
Expected: test passes; build ends with `dist/webui/index.html` present.

- [ ] **Step 6: Commit**

```bash
git add packages/zcode-ui/web packages/cli/package.json packages/cli/build.mjs \
  packages/cli/src/services/webuiDist.ts packages/cli/src/services/webuiDist.test.ts
git commit -m "Build the zcode-ui web frontend into dist/webui"
```

---

## Task 3: Serve the UI shell over the new WS host with stub services

**Files:**

- Create: `packages/cli/src/webuiZcode/wsHost.ts`, `packages/cli/src/webuiZcode/serviceCollection.ts`, `packages/cli/src/webuiZcode/services/stubs.ts`
- Modify: `packages/cli/src/services/WebUiService.ts`, `packages/cli/package.json` (add `ws`)
- Test: `packages/cli/src/webuiZcode/wsHost.test.ts`

**Interfaces:**

- Produces: `startWebUiZcodeHost(options: { server: http.Server; token: string; services: ServiceCollection }): { close(): Promise<void> }`
- Produces: `buildZcodeServiceCollection(deps: { workspacePath: string }): ServiceCollection`
- Produces: `stubService<T>(channelName: string): T` — every method returns a rejected promise with `ZCODE_UNAVAILABLE` code.

- [ ] **Step 1: Add `ws` and write the failing upgrade-auth test**

Test with a raw `ws` client: connecting to `/ws` without the `tnt-webui-session` cookie or `?token=` must close with code 4401; with the token it must stay open and answer a ChannelServer `hello`.

- [ ] **Step 1b: Pin the reconnect and stub-behavior rules in tests**

- Two sequential connections must each get their own `ServiceCollection` scope: open A, close A, open B; assert B's agent service subscriptions start empty (no events from A) and A's channel is disposed (a request on A after close rejects).
- Every stub method must reject within the test timeout with a message starting `ZCODE_UNAVAILABLE:` — no promise may remain pending.

- [ ] **Step 2: Implement `wsHost.ts`**

Express continues serving HTTP; create `new WebSocketServer({ noServer: true })` and handle the `upgrade` event only for `pathname === "/ws"`, reusing `requestToken`/`tokenEquals` from `webuiAuth.ts` against the upgrade request's cookie/query. On success: wrap the socket exactly like ZCode's `packages/server/src/http.ts:wrapWebSocket` (binary frames → `VSBuffer`), `new SocketProtocol(socket)`, `new ChannelServer(protocol, "server")`, `services.exposeOnChannelServer(server)`, dispose on close.

- [ ] **Step 3: Implement `serviceCollection.ts` + stubs**

Register only descriptors the UI requires for first paint, with stubs: `IFileService`, `IGitService`, `ISettingService`, `ISystemService`, `ITerminalService`, `IBroadcastService`, `ICredentialService`, `IZCodeTaskService`, `IZCodeAgentService`, `IZCodeSessionService`, `IConversationShareService`, `IBotsService`, `IFileWatcherService`, `IOAuthService`, `IProviderSettingsService`, `IModelSelectionService`, `IUsageStatsService`, `ICodingPlanSubscriptionService`, `IClientConfigService`, `IClientScenesService`, `IOffPeakTaskService`, `IHighspeedCardService`, `ISkillsService`, `ISkillSyncService`, `IMcpSyncService`, `IPluginSyncService`, `IPluginsService`, `IPluginManagementService`, `ISubagentsService`, `ICommandsService`, `IHooksService`, `IMemoryService`, `IOutputStyleService`, `ISettingsSyncService`, `IFeedbackService`, `IPromptAttachmentTransferService`. Stub methods return `Promise.reject(new Error("ZCODE_UNAVAILABLE:<channel>"))`.

- [ ] **Step 4: Wire into `WebUiService.start`**

After `listen()`, attach the WS host to the created `http.Server` (change `listen` to return the server handle). `close()` also closes the WS host.

- [ ] **Step 5: Verify the UI shell renders**

Run: `cd packages/cli && npm run lint && npx vitest run src/webuiZcode/wsHost.test.ts`
Then `npm run build && node dist/tnt.js webui --no-open --port 47693` and open `http://127.0.0.1:47693/#token=...`; expect the ZCode frame with empty/error panes (stubs), no white screen.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json packages/cli/src/webuiZcode packages/cli/src/services/WebUiService.ts
git commit -m "Serve the ZCode UI shell over a websocket RPC host"
```

---

## Task 4: Trim the web entry to a direct connection

**Files:**

- Modify: `packages/zcode-ui/web/src/main.tsx`
- Create: `packages/zcode-ui/web/src/webuiBootstrap.ts`
- Test: manual smoke via `npx tsc --noEmit` and a browser check

**Interfaces:**

- Produces: `bootstrapTntWebUi({ wsUrl, platform }): Promise<IServiceAccessor>` using `connectViaWebSocket`.

- [ ] **Step 1: Replace `bootstrapWebApp` branches**

Keep only the final branch: resolve `wsUrl = wss://<host>/ws`, `connectViaWebSocket`, `createWebPlatform()`, theme init, `installDocumentHiddenMotionPause`, `setStreamClientId`; render `Root` with `services`, `platform`, `initialWorkspaceAbsPath` from `GET /api/server-info` (fallback: none), `allowOpenWorkspace`, `preferDirectoryBrowser`, `supportsEmbeddedBrowser={false}`, `allowRemoteWorkspace={false}`. Delete OAuth/share/remote-control imports and routes.

- [ ] **Step 2: Typecheck and build**

Run: `cd packages/zcode-ui/web && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: clean; `dist/index.html` exists.

- [ ] **Step 3: Commit**

```bash
git add packages/zcode-ui/web/src
git commit -m "Trim the zcode-ui web entry to a direct websocket connection"
```

---

## Task 5: TNT app-server stdio protocol (engine host for extra workspaces)

**Files:**

- Create: `packages/cli/src/commands/appServer.ts`, `packages/cli/src/appServer/transport.ts`, `packages/cli/src/appServer/protocol.ts`, `packages/cli/src/appServer/sessionRegistry.ts`
- Modify: `packages/cli/src/index.ts` (register hidden `app-server` command)
- Test: `packages/cli/src/appServer/protocol.test.ts`

**Interfaces:**

- Consumes: `@zcode/shared` `zcodeProtocolMethods`, `zcodeProtocolSchemas`, `V4_METHODS`.
- Produces: NDJSON request/response over stdin/stdout; methods in this task: `runtime/capabilities`, `session/lifecycle/getState`, `session/lifecycle/changed` notification.

- [ ] **Step 1: Write the failing round-trip test**

Spawn the built CLI (`node dist/tnt.js app-server --stdio`) with a fixture cwd; write `{"id":1,"method":"runtime/capabilities","params":{}}`; expect a JSON line with `result` and `capabilities.version`.

- [ ] **Step 2: Implement transport + dispatch**

`transport.ts`: line-buffered NDJSON reader/writer (`JSON.parse` per line, size cap 16 MiB). `protocol.ts`: method table dispatch, request id echo, error envelope `{ code, message }`, notification pushes. Unknown methods answer `method-not-found` (ZCode's skew rule). `index.ts` registers `app-server [--stdio]` hidden, delegating to `commands/appServer.ts`.

- [ ] **Step 3: Implement lifecycle methods**

`session/lifecycle/getState` returns `{ state: "available", cwd: process.cwd() }`; emit `session/lifecycle/changed` on SIGINT/SIGTERM; flush before exit.

- [ ] **Step 4: Run tests, build, commit**

Run: `cd packages/cli && npx vitest run src/appServer/protocol.test.ts && npm run lint && npm run build`

```bash
git add packages/cli/src/appServer packages/cli/src/commands/appServer.ts packages/cli/src/index.ts
git commit -m "Add the app-server stdio protocol host"
```

---

## Task 6: Session lifecycle over the app-server

**Files:**

- Create: `packages/cli/src/appServer/session.ts`, `packages/cli/src/appServer/snapshot.ts`
- Modify: `packages/cli/src/appServer/protocol.ts`
- Test: `packages/cli/src/appServer/session.test.ts`

**Interfaces:**

- Consumes: `src/session/index.ts` (`createSession`, `loadSessionById`, `resumeSession`, `saveSession`), `src/session/store.ts` (`SessionStore`).
- Produces: `session/create`, `session/resume`, `session/list`, `session/read`, `session/messages`, `session/close`, `session/setModel`, `session/titleUpdated` notification, snapshot in `ZCodeSessionStateSnapshot` shape (`protocol` literal `{name: ZCODE_PROTOCOL_NAME, version: ZCODE_PROTOCOL_VERSION}`).

- [ ] **Step 1: Map TNT `Session` → ZCode snapshot**

`snapshot.ts` exports `toZcodeSessionInfo(session: Session): ZCodeSessionInfo` and `toZcodeMessages(session: Session): ZCodeMessageWithParts[]`. Chat history items map: user → `userInput` message with `text` part; assistant text → `text` part; reasoning → `reasoning` part; tool calls → `tool` parts keyed by `toolCallId`; system → `text` part with `synthetic: true`. Write table-driven tests with a fixture session containing all item kinds.

- [ ] **Step 2: Implement CRUD methods and tests**

Test create → list contains it → read matches snapshot → close marks closed → list excludes it (archived semantics as ZCode list). Use a temp `TNT_GLOBAL_DIR`.

- [ ] **Step 3: Run, lint, commit**

```bash
cd packages/cli && npx vitest run src/appServer/session.test.ts && npm run lint
git add packages/cli/src/appServer
git commit -m "Serve session lifecycle through app-server"
```

---

## Task 7: Turns, streaming events, v4 conversation frames

**Files:**

- Create: `packages/cli/src/appServer/turns.ts`, `packages/cli/src/appServer/events.ts`, `packages/cli/src/appServer/v4.ts`
- Modify: `packages/cli/src/appServer/protocol.ts`
- Test: `packages/cli/src/appServer/turns.test.ts`, `packages/cli/src/appServer/events.test.ts`

**Interfaces:**

- Consumes: `src/services/TurnRunnerService.ts` (`turnRunnerService`, `RunTurn`), `src/stream/messageQueue.ts` (`messageQueue`), `src/protocol/eventBus.ts` (`publishAgentEvent`, `subscribeAgentEvents`), `src/stream/streamChatResponse.ts` (existing TUI turn entry via `TurnRunnerService.setDefaultRunTurn`).
- Produces: `session/send` (enqueue + drain), `session/subscribe` → `session/event` notifications (legacy), `v4/conversation/subscribe` ack + `v4` frame notifications, `v4/command` handling `sendText`, `stop`, `compact`, `renameSession`, `deleteSession`, `resolveInteraction`.

- [ ] **Step 1: Write the failing event-translation test**

Feed a captured TNT `AgentEvent` sequence (assistant delta, tool call started/result, turn end) into `translateAgentEvent`; expect the emitted `ZCodeSessionEvent` list: `part.delta` → `part.upserted` → `tool.updated` → `turn.completed` with envelope `{ eventId, sessionId, seq, timestamp }`, monotonically increasing `seq`.

- [ ] **Step 2: Implement `events.ts`**

Map: `assistant.delta`→`part.delta`; `tool.started`→`tool.updated` (`state:"running"`); `tool.result`→`tool.updated` (`state:"completed"/"error"`); turn lifecycle→`turn.started`/`turn.completed`/`turn.failed`; `session.changed`→`session.updated`; permission request→`permission.requested`; quiz question→`userInput.requested`. Unknown events are dropped with a debug log (never fatal).

- [ ] **Step 3: Implement `turns.ts` and `v4.ts`**

`session/send` and `sendText` normalize to `messageQueue.enqueueMessage({ text, ... })` then `turnRunnerService.startDraining()` if idle. `stop` aborts the active turn's `AbortController` exposed by `TurnRunnerService`. `v4/conversation/subscribe` returns ack and subscribes the connection's emitter to the session's translated events; frames are emitted as `v4` topic wire frames with `conversationTopic(sessionId)`, `rowId` per message/part upsert.

- [ ] **Step 4: End-to-end test through the app-server**

Send `sendText`, assert ordered stream: `turn.started` → `part.delta`… → `part.upserted` → `turn.completed`; then `stop` mid-turn asserts `turn.completed` with `interrupted` reason.

- [ ] **Step 5: Run, lint, commit**

```bash
cd packages/cli && npx vitest run src/appServer && npm run lint
git add packages/cli/src/appServer
git commit -m "Stream turns and v4 conversation frames through app-server"
```

---

## Task 8: Interaction bridge — permissions and questions

**Files:**

- Create: `packages/cli/src/appServer/interactions.ts`
- Modify: `packages/cli/src/appServer/protocol.ts`
- Test: `packages/cli/src/appServer/interactions.test.ts`

**Interfaces:**

- Consumes: `src/permissions/permissionManager.ts` (`toolPermissionManager.on("permissionRequested")`, `approveRequest`, `rejectRequest`), `src/services/QuizService.ts` (`quizService.on("questionRequested"/"questionAnswered")`, `answerQuestion`), `src/permissions/interactionBroker.ts`.
- Produces: notifications `interaction/requestPermission` and `interaction/requestUserInput`; v4 `resolveInteraction` command maps `optionId` to allow/deny/remember; `userInput.requested` session event for questions.

- [ ] **Step 1: Permission round-trip test**

Mock `toolPermissionManager.requestPermission`; expect the notification with `{ requestId, toolCallId, toolName, input, options:[allow_once, allow_always, deny] }`; answer via `resolveInteraction`; expect the pending promise resolves approved/rejected accordingly, and a late duplicate answer is a no-op (returns false).

- [ ] **Step 2: Question (TUI relay) round-trip test**

Trigger `quizService` `questionRequested`; expect both a `userInput.requested` event and an `interaction/requestUserInput` notification; answer through the protocol; expect `quizService.answerQuestion` called once and `questionAnswered` emits `userInput.resolved`.

- [ ] **Step 3: Wire the in-process TUI relay**

When `/webui` runs inside a TUI process, the app-server child is not involved for the host workspace; `WebUiService` continues `listenForQuestions` but publishes through the same translated channel. Delete `webuiSlashMessage`-only routes once no longer referenced (Task 12 verifies).

- [ ] **Step 4: Run, lint, commit**

```bash
cd packages/cli && npx vitest run src/appServer/interactions.test.ts && npm run lint
git add packages/cli/src/appServer
git commit -m "Bridge permissions and questions through app-server"
```

---

## Task 9: Register the real engine-independent services

**Files:**

- Modify: `packages/cli/src/webuiZcode/serviceCollection.ts`
- Create: `packages/cli/src/webuiZcode/services/local.ts`
- Test: `packages/cli/src/webuiZcode/serviceCollection.test.ts`

**Interfaces:**

- Consumes (vendored): `createFileService` (`@zcode/services/file/fileService.js` → import via `@zcode/services/node` export if browser-safe), `createGitService`, `createTerminalService`, `createSettingService`, `createSystemService`, `createFileWatcherService`, `createBroadcastService`.
- Produces: same `buildZcodeServiceCollection` with these real instances instead of stubs.

- [ ] **Step 1: Write the failing registration test**

Assert `collection.get(IFileService)` resolves `readdir` on a temp dir; `IGitService.getRepositorySummary` on a temp git repo; `ITerminalService.open` spawns a pty that echoes `hello` (skip on win32 if pty feature missing); `ISettingService.get()` returns an object.

- [ ] **Step 2: Implement `local.ts` and register**

Instantiate once per host process, not per connection (services hold pty/fs state). `terminalService` needs `settingService`.

- [ ] **Step 3: Run, lint, commit**

```bash
cd packages/cli && npx vitest run src/webuiZcode/serviceCollection.test.ts && npm run lint
git add packages/cli/src/webuiZcode
git commit -m "Register real file, git, terminal and settings services"
```

---

## Task 10: Plugin marketplace and plugin management (real)

**Files:**

- Create: `packages/cli/src/webuiZcode/services/plugins.ts`
- Modify: `packages/cli/src/webuiZcode/serviceCollection.ts`
- Test: `packages/cli/src/webuiZcode/services/plugins.test.ts`

**Interfaces:**

- Consumes: `src/services/webuiMarketplace.ts`, `src/services/webuiPlugins.ts` (`listInstalledPlugins`), TNT plugin loader in `src/plugins/`.
- Produces: `IPluginsService` and `IPluginManagementService` implementation: `list`, `overview`, `install`, `uninstall`, `update`, `setEnabled`, marketplace add/remove/update, restore builtin. Results shaped `ZCodePluginsListResult` etc. (vendored schemas).

- [ ] **Step 1: Write the failing test**

Given a fixture plugin dir, `listPlugins({workspacePath})` returns installed plugin entries; `installPlugin` with a local marketplace entry copies and reports success; `uninstallPlugin` removes it; `restoreBuiltinPlugin` re-materializes a bundled plugin.

- [ ] **Step 2: Implement mapping to TNT's plugin loader**

Reuse TNT loader APIs; for marketplace sources not available in TNT, return `ZCODE_UNAVAILABLE` errors (never fake success). Progress notifications emitted as `onDynamicPluginOperationProgress` events.

- [ ] **Step 3: Run, lint, commit**

```bash
cd packages/cli && npx vitest run src/webuiZcode/services/plugins.test.ts && npm run lint
git add packages/cli/src/webuiZcode
git commit -m "Implement plugin marketplace services"
```

---

## Task 11: Multi-workspace engines

**Files:**

- Create: `packages/cli/src/webuiZcode/workspaceEngines.ts`
- Modify: `packages/cli/src/webuiZcode/serviceCollection.ts`, `packages/cli/src/appServer/*` (client mode)
- Test: `packages/cli/src/webuiZcode/workspaceEngines.test.ts`

**Interfaces:**

- Consumes: `@zcode/client` `connectViaProtocol`, `@zcode/rpc` `SocketProtocol`; `ZCodeStdioTransport` pattern from vendored services (or a small NDJSON client).
- Produces: `WorkspaceEngines` registry: `get(workspacePath): Promise<IServiceAccessor-like>`; host workspace served in-process; other workspaces spawn `tnt app-server --stdio` (`ZCODE_AGENT_SERVER_COMMAND=process.execPath`, args `["<dist/tnt.js>","app-server","--stdio"]`, cwd = workspace).

- [ ] **Step 1: Write the failing two-workspace test**

Open workspaces A and B; create a session in each; send a prompt in A; assert B's session list and events are untouched and A's stream completes. Assert one child process per non-host workspace and that closing a workspace disposes it.

- [ ] **Step 2: Implement registry and lifecycle**

Idle child timeout (10 min), crash restart on next use, per-workspace `connectionScope` (copy ZCode's `createZCodeAgentConnectionScope` usage from `packages/server/src/http.ts`).

- [ ] **Step 3: Run, lint, commit**

```bash
cd packages/cli && npx vitest run src/webuiZcode/workspaceEngines.test.ts && npm run lint
git add packages/cli/src/webuiZcode packages/cli/src/appServer
git commit -m "Serve multiple workspaces with per-workspace agent processes"
```

---

## Task 12: Retire the old REST/SSE contract and finish guards

**Files:**

- Delete: `packages/cli/src/services/webuiRoutes*.ts`, `webuiSessionStore.ts`, `webuiSlashMessage.ts`, `webuiPages.ts` (replaced by static index), related tests
- Modify: `packages/cli/src/services/WebUiService.ts`, `src/commands/webui.ts`, docs, `.github/workflows/*`, `scripts/install.sh`, `.nvmrc`, `packages/cli/package.json`
- Test: full suite

**Interfaces:**

- Produces: `/webui` and `tnt webui` entry points unchanged; only static + `/ws` + `/api/server-info` routes.

- [ ] **Step 1: Delete old routes and update `WebUiService`**

Keep: static serving, auth gate, session exchange, `/api/server-info`, WS host. Remove SSE and REST route registration. Update `webuiPages.ts` fallback to a minimal "no client" page (already exists).

- [ ] **Step 2: Node 24 floor**

Update engines, `.nvmrc` (`v24.0.0`), `scripts/install.sh` (`REQUIRED_NODE_VERSION="24.0.0"`), CI matrices (`24`), README install note.

- [ ] **Step 3: Guard and docs**

Run `npm run lint`, `npx vitest run` (full), `npm run format:check`, `npm run build`. Fix expected failures: `slashCommandsDoc` (unchanged), `docsAccuracy` (paths), `readme.test`, `namingLedger`, `zcodeUiVendor`.

- [ ] **Step 4: Manual acceptance pass (spec acceptance 1–10)**

Run the checklist from the spec against a real browser; record screenshots for the three named screens.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Retire the legacy webui REST surface and raise the node floor"
```

---

## Self-Review Notes

- Spec coverage: vendoring (Task 1), build/serve (Tasks 2–3), UI shell (Task 4), agent service in-process and subprocess (Tasks 5–8), real services incl. plugin marketplace and terminal (Tasks 9–10), multi-workspace (Task 11), deletion/guards/node floor (Task 12). Sidebar browser: v1 hidden (`supportsEmbeddedBrowser={false}`, Task 4); CDP channel is explicitly post-v1 per spec and not in this plan.
- Stub contract: every stub rejects with `ZCODE_UNAVAILABLE`; Task 12 verifies no UI-hanging path.
- Type consistency: `buildZcodeServiceCollection` defined in Task 3 and reused verbatim in Tasks 9–11; `translateAgentEvent` defined in Task 7 and reused by Task 8; `WorkspaceEngines.get` defined in Task 11.
