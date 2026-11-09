# TNT client integration

How an editor or desktop client hosts TNT without forking the engine or the UI.

## Architecture

TNT has one engine, one protocol and one web UI. A host is a thin adapter around
those three pieces.

```
VS Code webview  --+
JetBrains JCEF   --+-- HTTP + WebSocket --> tnt serve --+
Electron window  --+                                   +--> workspace engines
Browser tab      --+                                   |
                                                       +--> tnt app-server --stdio
TUI ----------------------------- in-process engine
```

- **One engine.** The agent loop, tools, permissions, sessions and providers live in
  `packages/cli/src`. A host never reimplements the loop.
- **One protocol.** The session/turn model is the ZCode RPC schema in
  `packages/zcode-ui/shared/src`, transported as binary WebSocket frames at `/ws`.
  The app-server speaks the same schema over NDJSON on stdio.
- **One web UI.** `packages/zcode-ui/web` is the only browser UI. Its build
  (`packages/zcode-ui/web/dist`, copied to `dist/webui`) is what the daemon serves.
  Hosts embed that build; they do not write a second UI.
- **Hosts are adapters.** A host starts the daemon, loads the shared build, supplies
  a native `IPlatformService` where it can, and implements native editor actions
  (diffs, decorations, quick pick, context menus) with its own APIs.

The TUI is the same engine with an in-process frontend. It is not a separate
protocol implementation.

## The `tnt serve` daemon

```text
tnt serve [--port N] [--host 127.0.0.1] [--workspace PATH]
          [--json] [--handshake-file PATH] [--no-tui]
```

Daemon mode is selected by any of `--json`, `--handshake-file`, `--workspace` or
`--no-tui`. A bare `tnt serve` keeps the legacy HTTP server's behavior for
existing callers.

Defaults:

| Setting       | Default                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Bind address  | `127.0.0.1` only. `--host` accepts `127.0.0.1` or `localhost`.                                                                  |
| Port          | `0` (an ephemeral port chosen by the OS). The handshake reports it.                                                             |
| Workspace     | `--workspace`, or the process working directory. It is resolved to an absolute, symlink-free path and becomes the daemon's cwd. |
| Token         | The persistent token file under the global directory, mode `0600`. A restart keeps the same token.                              |
| TUI / browser | Neither. The daemon never opens a browser.                                                                                      |
| Lifecycle     | Runs until `SIGINT` or `SIGTERM`.                                                                                               |

The daemon does not require a configured model. The token route, the static shell
and `/api/server-info` come up without one. The first turn initializes
config/model lazily; if no model exists the turn fails with the app-server's
existing "no chat model" error instead of taking the process down. This is why
editor clients can start the daemon before the user finishes configuration.

### Handshake

With `--json`, exactly one line is written to stdout after the server is
listening. Nothing else is written to stdout in this mode; diagnostics go to the
log file under `<global dir>/logs/tnt.log`.

```json
{
  "type": "tnt-serve",
  "protocol": 1,
  "pid": 12345,
  "port": 47610,
  "url": "http://127.0.0.1:47610",
  "wsUrl": "ws://127.0.0.1:47610/ws",
  "tokenFile": "/home/user/.tnt/webui-token",
  "workspace": "/home/user/project"
}
```

| Field       | Meaning                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `type`      | Discriminator; always `tnt-serve`.                                                                          |
| `protocol`  | Handshake contract version. Currently `1`.                                                                  |
| `pid`       | Daemon process id, for status and shutdown.                                                                 |
| `port`      | Actual bound port, after the upward probe if the requested port was busy.                                   |
| `url`       | HTTP origin. Append `/#token=<token>` only for a human browser launch.                                      |
| `wsUrl`     | ZCode RPC endpoint. Add `?token=<token>` when the client cannot send a cookie or an `Authorization` header. |
| `tokenFile` | File holding the bearer token. The handshake never contains the token itself.                               |
| `workspace` | Absolute workspace directory the daemon serves.                                                             |

`--handshake-file PATH` writes the same JSON atomically: a temp file in the same
directory, then a rename, mode `0600`. A client polling the path sees either the
previous complete document or the new one, never a partial write.

### Lifecycle

1. A host spawns the daemon with `--json` and an absolute `--workspace`.
2. The host reads the handshake line (or the handshake file) and stores it.
3. The host connects to `wsUrl` with the token.
4. On quit, the host sends `SIGTERM`. The daemon closes the `/ws` host, disposes
   every per-workspace child engine and the local service bundle, then exits `0`.
   A second signal exits immediately. No child engine survives a clean shutdown.

The host should also treat the daemon's `exit` event as authoritative and remove a
stale handshake file.

## Authentication

The daemon binds loopback only. Every route except two sits behind the token gate:

| Route                  | Access                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /`                | Bootstrap page. Reads `#token=` client-side and posts it to the exchange.                          |
| `POST /webui-session`  | Token exchange. Sets the session cookie.                                                           |
| `GET /api/server-info` | Token required (Bearer or cookie).                                                                 |
| `/app/*`, SPA assets   | Token required.                                                                                    |
| `WS /ws`               | Token required before the upgrade is accepted. Bad or missing token -> HTTP 401, socket destroyed. |

The browser flow is:

1. The host opens `http://127.0.0.1:<port>/#token=<token>`. The URL fragment never
   reaches the server.
2. The bootstrap page posts the token to `/webui-session`.
3. The daemon validates it and sets `tnt_webui_token` as `HttpOnly; SameSite=Strict`.
4. The page reloads into the SPA; the SPA connects to the same origin's `/ws` with
   the cookie.

A non-browser host can skip the cookie entirely:

- HTTP: `Authorization: Bearer <token>`.
- WebSocket: `ws://127.0.0.1:<port>/ws?token=<token>`, or the same header/cookie.

Read the token from `tokenFile`; do not pass it on a command line, where it is
visible in the process list, and do not put it in logs.

## Per-workspace engines

One daemon owns one workspace. `WorkspaceEngines` serves the host workspace
in-process and spawns exactly one child engine per additional workspace:

```text
<node executable> <dist/tnt.js> app-server --stdio   (cwd = that workspace)
```

The registry disposes children when the workspace closes, when the idle timeout
expires, and when the daemon closes. A host should normally start **one daemon per
workspace** rather than sharing one daemon across unrelated trust boundaries.
Workspace path scoping for file and terminal services is enforced in
`packages/cli/src/webuiZcode/services/workspaceScope.ts`.

## Capability negotiation and versioning

There are two layers of versioning:

| Layer                 | Where                            | Rule                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon handshake      | `protocol` in the handshake JSON | Integer. Bump only for a breaking change to the handshake fields. Clients must ignore unknown fields and tolerate added optional fields.                                                                                                        |
| Session/turn protocol | ZCode V4 hello/clientHello       | The server declares its capabilities in `hello`; the client answers with `clientHello`. A client only advertises a capability after the server declares it. Additive fields are safe; a breaking schema change needs a protocol version change. |

The engine version (`tnt --version`) identifies the build. The handshake protocol
version identifies the integration contract. Do not infer one from the other.

A host must not assume a feature exists because a newer engine is running: read the
hello capabilities and hide or disable the corresponding surface when the server
does not advertise it.

## Host responsibilities

`IPlatformService` (in `packages/zcode-ui/shared/src/platform.ts`) is the
renderer-side contract for operations that need the host process. Some
capabilities in the table are RPC services rather than `IPlatformService` members;
the distinction matters when deciding where to implement them.

| Responsibility   | Contract                                                                                      | VS Code webview                                                       | JetBrains JCEF                         | Electron                                | TUI                        |
| ---------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------- | --------------------------------------- | -------------------------- |
| Terminal         | `ITerminalService` RPC                                                                        | Daemon provides the pty; host may mirror output into a terminal panel | Same; optional native terminal pane    | Same; optional native pane              | In-process ink terminal    |
| File dialogs     | `IPlatformService.selectDirectory`, `selectFile(s)`, `saveFile`                               | `showOpenDialog` / `showSaveDialog` via bridge                        | JCEF `FileChooser` via bridge          | Dialog module / `dialog.showOpenDialog` | Path typed into the TUI    |
| Secrets          | `ICredentialService` RPC (see note)                                                           | `vscode.SecretStorage` via a host service                             | JetBrains `CredentialStore`            | `safeStorage` / OS keychain             | Environment or config file |
| Notifications    | `IPlatformService.showTaskNotification`, `onTaskNotificationClick`                            | VS Code notification API                                              | JCEF notification / IDE notification   | Native Notification                     | TUI notice line            |
| Open external    | `IPlatformService.openExternal`                                                               | `vscode.env.openExternal` with an allowlist                           | `BrowserUtil.browse` with an allowlist | `shell.openExternal` with an allowlist  | Not used                   |
| Editor context   | `IPlatformService.openInEditor`, `getInstalledEditors`; host bridge for active file/selection | `vscode.window.activeTextEditor`, `workspace`                         | `FileEditorManager`                    | Host bridge                             | Not applicable             |
| Embedded browser | `IPlatformService.browserView*`, `onOpenBrowserUrl`, `onEmbeddedBrowserPermissionPrompt`      | `vscode.env` has no embedded browser in v1; omit the surface          | JCEF can host the browser              | `WebContentsView`                       | Not available              |

Note: `ICredentialService` is registered by the webui service collection but is
currently an unavailable stub. A host that needs native secret storage must
provide that channel; do not store secrets in the webview origin's storage. The
same applies to any service that returns `ZCODE_UNAVAILABLE`.

### Native actions that must not live in the webview

These are editor-native interactions. Implement them in the host, driven by engine
events or a host bridge. Do not emulate them with DOM overlays inside the shared
UI.

| Action                              | Where it belongs                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Inline diff and patch preview       | VS Code `TextDocumentContentProvider` + `vscode.diff`; JetBrains `DiffManager`; Electron editor component or OS diff tool |
| Decorations, diagnostics, gutters   | VS Code diagnostics/decorations API; JetBrains highlighting; host editor                                                  |
| Quick pick / command palette        | VS Code `QuickPick`; JetBrains `ChooseByName`/popup; Electron native menu                                                 |
| Context menus                       | VS Code `contributes.menus`; JetBrains action groups; Electron `Menu`                                                     |
| File/workspace open, reveal, rename | Host workspace APIs                                                                                                       |
| Keybindings and window commands     | Host keybinding and command registries                                                                                    |

The web UI can request these actions through a narrow bridge; it must not assume
they are available. A browser tab simply does not expose the corresponding
surface.

## Embedding recipes

### VS Code webview

Recommended shape:

1. Spawn `tnt serve --json --port 0 --workspace <folder.uri.fsPath>` from the
   extension. Read the handshake from stdout. If the extension wants a stable
   path, use `--handshake-file` under `context.globalStorageUri`.
2. Read the token from `tokenFile`.
3. Build a host entry that loads the shared UI from the extension's webview
   assets; do not copy the UI. The entry imports `bootstrapTntWebUi` from
   `packages/zcode-ui/web/src/webuiBootstrap.tsx` and supplies:
   - `wsUrl: handshake.wsUrl + "?token=" + encodeURIComponent(token)`
   - a native-backed `IPlatformService`
   - `initialWorkspaceAbsPath: handshake.workspace`

   The entry, the rest of `dist/webui`, and `webview.asWebviewUri` resources are
   served from `localResourceRoots`, with a CSP whose `connect-src` allows
   `ws://127.0.0.1:<port>`. The SPA then needs no HTTP request to the daemon: it
   already has the workspace path and authenticates the WebSocket with the query
   token. This reuses `bootstrapTntWebUi`; it is not a fork.

   Do not rely on loading the daemon origin in an iframe to carry the cookie: a
   `vscode-webview://` top-level document makes the loopback request cross-site,
   and the `SameSite=Strict` cookie is not a dependable auth path there. The
   query token on the WebSocket is.

4. Add a `postMessage` bridge for the actions the web UI needs from the
   extension. Validate every message and never let the webview name an arbitrary
   command to execute.

The host entry is the remaining adapter work. The stock browser entry
(`main.tsx`) uses `createWebPlatform()` and derives its URL from `window.location`;
it is the direct-origin entry used by a browser, Electron or JCEF, not the
webview-asset entry.

### Electron

1. Spawn the daemon (or construct `WebUiService` in the main process if the
   daemon lifecycle is yours).
2. Create `new BrowserWindow({ webPreferences: { contextIsolation: true,
nodeIntegration: false, sandbox: true, preload } })`.
3. Load `handshake.url + "/#token=" + token`. As a top-level page, the cookie
   exchange and `/ws` work without extra proxy code.
4. Expose a narrow `preload` API with `contextBridge.exposeInMainWorld`. Keep the
   token in the main process or in memory; do not write it to `localStorage`.
5. Use `setWindowOpenHandler` and `will-navigate` to block navigation away from
   the daemon origin, and route `openExternal` through an allowlist.
6. For a native platform, load a host entry built from `bootstrapTntWebUi` (same
   as the VS Code recipe) instead of the default browser entry.

### JetBrains JCEF

1. Spawn the daemon and read the handshake.
2. Create `JBCefBrowser` and load `handshake.url + "/#token=" + token`. JCEF is a
   top-level browser, so the cookie jar carries the session cookie to `/ws`.
3. Register a `CefMessageRouter` or `JBCefJSQuery` bridge for file chooser,
   notifications, editor context and open-external. Validate arguments in Kotlin
   and apply the IDE's own trust rules.
4. Implement diffs, quick pick and context menus with JetBrains actions. Do not
   draw them in the JCEF page.
5. Block external navigation and open links through `BrowserUtil.browse` after an
   allowlist check.

### Light VS Code Chat Participant

When the full web UI is too much, implement a `ChatParticipant` and bridge prompts
to the engine:

- One-shot or streaming: spawn `tnt -p --format stream-json "<prompt>"` and forward
  the lines to the participant stream.
- Structured tooling: speak the app-server NDJSON protocol with
  `tnt app-server --stdio`, or connect to the daemon's `/ws` and use the same
  session/turn RPC the web UI uses.

A Chat Participant is an adapter, not a second UI: it must consume the same engine
and must not grow its own session model.

## Security

- **Loopback only.** The daemon binds `127.0.0.1`. Do not expose it through a
  reverse proxy or change `--host` to a LAN address. The token is a bearer
  credential, not a substitute for TLS.
- **Token file.** `<global dir>/webui-token`, mode `0600`. Read it at runtime;
  never commit it, log it, or pass it as a command-line argument.
- **Origin and cookie model.** The exchange sets an `HttpOnly; SameSite=Strict`
  cookie. The server sends no permissive CORS headers. Do not add
  `Access-Control-Allow-Origin: *` or weaken `SameSite`; a token in a URL query is
  acceptable only for the WebSocket upgrade, where there is no cookie mechanism.
- **Workspace scoping.** One daemon per workspace. File and terminal paths are
  restricted to the workspace roots. Do not share a daemon between projects with
  different trust levels.
- **No cloud.** The daemon does not create an account, sync a workspace, or proxy
  through a hosted service. Model traffic goes wherever the user's config points.
- **Handshake file.** It contains the workspace path and pid, not the token.
  Treat it as sensitive local metadata and give it `0600`.
- **Webview navigation.** Block navigation and window opens that leave the daemon
  origin. Route every external URL through an allowlist.

## Divergence and licensing

The UI under `packages/zcode-ui` is vendored ZCode source, adapted in place.

- `packages/zcode-ui/UPSTREAM-DIVERGENCES.md` is the ledger of direct edits. Add an
  entry for every changed file, with the reason and the TNT-side contract it
  serves. A divergence must come with a test.
- `packages/zcode-ui/NOTICE.md` and `packages/zcode-ui/THIRD-PARTY-NOTICES.md` are
  distribution obligations. The CLI build copies them to `dist/NOTICE.md` and
  `dist/webui/THIRD-PARTY-NOTICES.md`.
- A host that bundles `dist/webui` must ship those notices unchanged and must not
  strip attribution from the served UI. The project is Apache-2.0; the vendored
  tree's notices are additive, not replaceable.

## What not to do

- **No second UI.** Do not build a per-host chat surface with its own session or
  turn model. If the shared UI lacks something, extend it on both sides or hide
  that surface.
- **No per-host UI forks.** Do not copy `packages/zcode-ui/web` into an extension
  and edit the copy. Use a host entry that calls `bootstrapTntWebUi` and keep the
  shared components shared.
- **No browser-only APIs in shared components.** `window`, `document`,
  `localStorage` and `navigator` belong behind the platform contract. A shared
  component that reaches for them breaks JCEF, Electron mains and tests.
- **No native actions faked in the webview.** Inline diffs, decorations, quick
  pick and context menus must use the host's APIs. DOM approximations drift from
  the editor and confuse the user.
- **No engine code in the host.** Starting a turn, resolving permissions,
  compacting history and persisting sessions belong to the engine. The host
  forwards intent and renders results.
- **No secrets in renderer storage.** Use the host credential channel or the
  daemon's config, never `localStorage` or a URL.
