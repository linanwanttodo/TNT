# Agent Client Protocol (ACP)

Status: M1 plus the client-fs/MCP/auth slice implemented 2026-10-23. The
supervisor, per-session workers, session lifecycle, permissions, modes, model
selection, client-owned file reads/writes, per-session MCP servers and the ACP
v1 stable transport are covered by `e2e/acp.test.ts`.

## Layers

```text
editor / client
      │  ACP v1 over stdio (NDJSON JSON-RPC)
      ▼
ACP supervisor                         one per `tnt --acp`
      │  connection, session registry, list/delete/close, worker lifecycle
      ▼
ACP worker                             one per session
      │  cwd, services, model, mode, MCP set, permission/file bridges
      ▼
session/controller.ts                  one turn
      │  abort handle, ids, ordered event sequence
      ▼
stream/streamChatResponse.ts           agent loop
      │  provider calls, tools, compaction
      ▼
tools · permissions · services · hooks
      │
      ▼
session store                          JSONL transcript + metadata + lease
```

The supervisor never runs a turn and the worker never writes the editor's
stdout. The engine is reached only through `session/controller.ts`.

## Entry points

| Command                                                   | Purpose                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `tnt --acp`                                               | ACP supervisor; speaks NDJSON JSON-RPC on stdin/stdout    |
| `tnt --acp-worker --session-id <id> --session-cwd <path>` | internal single-session worker, spawned by the supervisor |

`--acp` accepts no prompt. Both ACP modes are treated as headless for stdout
interception: dependencies and the banner cannot write to stdout, protocol
messages go through the preserved stdout, and diagnostics go to stderr or the
log file. See [sessions.md](./sessions.md) for the transcript store.

Zed:

```json
{
  "agent_servers": {
    "TNT": {
      "command": "tnt",
      "args": ["--acp"]
    }
  }
}
```

## Supervisor and workers

The supervisor owns the client connection, the session registry and the
`session/list|delete|close` methods. Every ACP session is one worker process:

- `session/new`, `load` and `resume` spawn the worker with `--session-cwd` set
  to the session cwd; the worker `chdir`s there before loading config or tools.
- Each worker has its own TNT services, model, mode, MCP connections and
  globals, so sessions do not share state.
- Different sessions can run prompts concurrently. A second prompt on the same
  session is rejected while the first is active.
- The supervisor forwards `session/update`, `session/request_permission` and
  session lifecycle calls; a worker crash is reported and the session can be
  resumed on the next prompt.
- A worker never writes to the editor's stdout; its stdout is a pipe back to
  the supervisor.

This is the process-isolation equivalent of opencode's ACP-client-to-server
split and reasonix's per-session controller, chosen because TNT's engine still
has process-wide service singletons.

## Capabilities

`initialize` returns ACP v1 stable with:

- `loadSession: true`
- `sessionCapabilities: { list, delete, resume, close }`
- `promptCapabilities: { image: true, audio: true, embeddedContext: true }`
  (text and resource links are the ACP baseline; audio is wav/mp3)
- `mcpCapabilities: { http: true, sse: true }` (stdio is always available)
- `authMethods: []`, or a terminal `tnt-setup` method when the client advertises
  `auth.terminal`. The method opens the normal TNT setup in a terminal; the
  agent's `authenticate` has no additional agent method.

Audio is only meaningful when the configured model/provider accepts OpenAI
`input_audio`; a provider that does not may reject or omit it. ACP v1 has no
terminal stdin request, so input for an interactive command can only come from
the human typing in the editor's terminal, not from the agent.

## Lifecycle

| Method                      | Behaviour                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| `initialize`                | negotiates v1 and stores client capabilities                               |
| `authenticate`              | accepts a configured auth method; terminal setup is launched by the client |
| `session/new`               | creates a v2 session, a worker and a lease                                 |
| `session/load`              | binds a persisted session and replays its transcript                       |
| `session/resume`            | binds a persisted session without replay                                   |
| `session/list`              | reads the session meta cache, optionally filtered by cwd                   |
| `session/prompt`            | runs one turn and streams updates                                          |
| `session/cancel`            | aborts the active turn                                                     |
| `session/set_mode`          | switches one of the five TNT permission modes                              |
| `session/set_config_option` | switches the chat model (`configId: "model"`)                              |
| `session/close`             | stops the worker and releases the lease, keeping history                   |
| `session/delete`            | stops the worker and removes the session directory                         |

`session/new`, `load` and `resume` require an absolute cwd equal to the worker's
process cwd (the supervisor sets it). A mismatched cwd is an invalid-params
error. `additionalDirectories` entries must be absolute, existing directories;
they are added to the session's workspace roots for the write policy and are
returned in `session/list` while the session is live.

## Prompt content

Text, resource links and embedded resource text become text parts. An image
block becomes an `imageUrl` data URL; an audio block becomes an OpenAI
`input_audio` part with `wav` or `mp3` format. Image/audio parts are persisted in
the transcript and replayed as `user_message_chunk` content on `session/load`.
Audio support depends on the selected model/provider accepting `input_audio`;
Anthropic and Gemini paths do not process it as audio.

## Streaming updates

The engine's `AgentEvent` is the only input. The worker maps:

| Engine event      | ACP update                                                                |
| ----------------- | ------------------------------------------------------------------------- |
| `content.delta`   | `agent_message_chunk`                                                     |
| `reasoning.delta` | `agent_thought_chunk`                                                     |
| `tool.started`    | `tool_call` with the engine's stable `toolCallId`                         |
| `tool.finished`   | `tool_call_update` (completed/failed, output content)                     |
| `notice`          | `notice`, only when the client advertised `session.notices`               |
| `compaction.*`    | `compaction_update`, only when the client advertised `session.compaction` |

Intermediate `tool.updated` events are not forwarded; the start and finish
events already carry the lifecycle the client renders. Tool call ids are
threaded through `StreamCallbacks` and `AgentEvent` so the start and finish
updates match.

Two updates are derived from session state rather than one engine event:

- every finished `Todo` result becomes a complete `plan` update, with done
  entries marked `completed` and the rest `pending` at `medium` priority; an
  empty list clears the plan, and `session/load` replays the latest plan;
- after a prompt settles, the worker sends `usage_update` with the history's
  token count, the model's context limit and the session's cumulative USD cost
  when it is non-zero. `session/load` sends the same snapshot after replaying
  the transcript; `session/resume` sends no updates.

## Permissions

`session/request_permission` is the engine's ask path. The worker sends the
tool call and three options (`allow_once`, `allow_always`, `reject_once`) to the
editor; the answer resolves the engine's `toolPermissionManager` request.
`allow_always` also records a session-scoped approval. A cancelled or failed
request is a refusal, never a quiet approval.

The worker runs with `isHeadless: false` for permissions, even though its
console is headless; otherwise ask tools would be dropped. Modes map as:

`default` → Manual, `acceptEdits` → Accept edits, `plan` → Plan,
`auto` → Auto, `bypassPermissions` → Bypass permissions.

## Client file service

When the client advertises `fs.readTextFile` and/or `fs.writeTextFile`, the
worker installs a `WorkspaceFileService`. `Read`, `Write`, `Edit`, `MultiEdit`
and `ApplyPatch` then use it: reads see the editor's unsaved buffer, edits and
patches apply against that content, and writes update the buffer. A client
request that fails falls back to the saved file on disk. Paths sent to the
client are absolute. An `ApplyPatch` Delete section still removes the saved file
locally, because ACP's file service has no delete request; list/search/glob and
the shell tools remain local because they need directory access rather than a
text file.

## Per-session MCP servers

`mcpServers` on `session/new`, `load` and `resume` are mapped to TNT's MCP
config shape (stdio `command`/`args`/`env`; HTTP/SSE `url`/`headers`) and
connected through `MCPService.addServer` before the first prompt. One worker
owns one session, so the server set is isolated from every other session. A
server that fails to connect is logged and does not remove the rest.

## Client terminal

When the client advertises `terminal`, the Bash tool runs commands through
`terminal/create`, reads `terminal/output` and waits for
`terminal/wait_for_exit`. A command that exits is released immediately. A
command that exceeds its timeout is not killed: the terminal stays open,
`BackgroundJobService` registers a polled job, and `CheckBackgroundJob` refreshes
`terminal/output` until the exit status appears and then releases the terminal.
`session/close` and `session/delete` cancel and release any terminals still
owned by that session.

ACP v1 has no terminal stdin request. The agent cannot type into the terminal,
so an interactive prompt can only be answered by the human in the editor's
visible terminal; the Bash result names the background job and says the terminal
remains open. The shell and arguments come from the same `getShellCommand` the
local Bash tool uses.

## Authentication

If the client advertises `auth.terminal`, `initialize` returns a `tnt-setup`
terminal method (`args: []`) that launches the normal TNT setup. Without that
capability the method list is empty; `session/new` still reports the local
config/model error when the agent is unconfigured.

## Security

- Session ids are validated before they become paths; a traversal id is
  rejected.
- The worker cwd must match the session cwd and must exist.
- Project config/hooks are only loaded when the normal TNT trust rules allow
  them; ACP does not silently auto-trust a project. Use the existing
  `--trust-project` / `TNT_TRUST_PROJECT=1` path or trust the project once.
- The supervisor does not expose an HTTP listener.

## Tests

- `npx vitest run src/acp src/tools/workspaceFiles.test.ts
src/tools/terminalRunner.test.ts src/permissions/workspacePath.test.ts`
  covers update mapping, the permission bridge, auth method selection, MCP
  config mapping, the file-service fallback, the terminal runner and extra
  workspace roots.
- `npx vitest run --config vitest.e2e.config.ts e2e/acp.test.ts` covers a prompt,
  two concurrent sessions, load/resume/delete, a tool permission request,
  client-owned file reads/writes, per-session MCP discovery, foreground Bash in
  the client terminal, additional workspace roots, image/audio prompts with
  replay and `session/cancel` against the built `dist/tnt.js` and a mock model
  server.
