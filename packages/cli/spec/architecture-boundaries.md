# Engine and UI boundaries

Status: implemented, 2026-10-22. Phases A-D have landed; the remaining debt is
named in each phase rather than left implicit.

This document records what the Codex CLI and Peri Code workspaces do at the
architecture level, which parts of that are worth copying into `tnt`, and the
order in which to land them. It is deliberately narrower than either reference:
`tnt` is one TypeScript package with three surfaces, not a Rust workspace with
dozens of crates.

## 1. What the references actually separate

### Codex CLI

- `codex-rs/protocol` defines the wire types and nothing else. Its README says
  it should have minimal dependencies and no material business logic.
- `codex-rs/core` is the engine. The UI drives it with submissions (`Op`) and
  receives events (`EventMsg`) through a queue pair. Any transport can carry
  the pair; the TUI is just one client.
- `codex-rs/tui` is an external client. It owns the app event loop, history
  cells, streaming presentation, keymaps, and the bottom pane. It does not
  execute tools.
- `app-server` re-exposes the same engine as JSON-RPC for IDE and other
  clients. Transport concerns live beside the server, not inside the core.
- Supporting crates split by job rather than by layer name: `apply-patch`,
  `sandboxing`, `shell-command`, `execpolicy`, `thread-store`, `config` and
  `config-schema`.

The transferable idea is not the crate count. It is that the engine has no
import of the UI, the UI has no import of the engine, and the only shared
vocabulary is a small typed event contract.

### Peri Code

- `docs/design/architecture.md` fixes a single dependency direction:
  Model -> Agent -> Runtime -> Controller -> ACP -> TUI, with Middleware and
  Resources injected from the side.
- Agent owns the session lifetime. Runtime is stateless apart from a
  `session_id -> SessionHandle` map. Controller composes resources and runtime.
- Every client (TUI, print, stdio, IDE) goes through ACP. ACP turns business
  events into protocol events and gates capabilities; it does not run the
  agent.
- The transcript is the runtime source of truth: message ids (UUID v7),
  append-only writes, two-phase staging for the assistant message plus its
  tool results, and compaction expressed as marks on a view instead of
  destructive edits.
- `UserInteractionBroker` unifies tool approval and user questions behind one
  request/response interface, so every front end answers the same way.
- Config is an immutable snapshot with a revision and compare-and-swap update,
  injected into consumers. There is no global read of mutable config in the
  middle of a run.
- The TUI is a projection: `acp_events` maps protocol events into a view
  model, the view model is cached, panels are registered in a table, and colors
  come from semantic theme tokens.

## 2. Where `tnt` stands today

The engine is already shared, even though the spec index still describes the
old approach:

- `src/stream/streamChatResponse.ts` is called by the TUI
  (`ui/hooks/useChat.stream.helpers.ts`), headless (`commands/chat.ts`),
  `tnt serve` (`commands/serve.helpers.ts`), subagents, review, and
  summarization.
- `ARCHITECTURE-tnt.md` calls this "one engine, three surfaces".
- `spec/index.md` used to say separate loop implementations were intentional.
  The implementation already followed the shared-engine design; the index is
  reconciled in the change that added this file.

The weak points are at the edges, not inside the loop:

1. The UI boundary is a callback bag. `StreamCallbacks` mixes content deltas,
   tool lifecycle, permission requests, and reminders. There is no event that
   says "this is a reasoning delta" or "this tool changed state".
2. The UI writes history. `useChat.stream.helpers.ts` and `useChat.ts` fall
   back to `setChatHistory` when `ChatHistoryService` is not ready, so two
   writers exist for the same transcript.
3. Reasoning is not a first-class stream value. `chunkProcessing.ts` ignores
   `delta.reasoning_content`, while `MemoizedMessage.tsx` recovers reasoning by
   matching `<think>` tags in assistant text. `core` already has
   `ThinkingChatMessage`, `ChatHistoryItem.reasoning`, and
   `role: "thinking"`; the CLI does not use them.
4. The transcript is a mutable array. Compaction rewrites it, and UI components
   read `ChatHistoryItem` directly, so there is no stable projection layer to
   test or cache.
5. Presentation decisions live in components: screen selection is an if/else
   chain in `ScreenContent.tsx`, and colors are literal strings such as
   `"gray"` and `"white"`.
6. `tnt serve` exposes a polling REST view model (`spec/wire-format.md`), not
   the engine event stream. It flattens tool state and cannot express reasoning
   or approvals without new endpoints.

## 3. Decision

Copy three ideas and leave the rest out.

1. A typed event contract between engine and surfaces. Keep it in `src/`
   without a new package, and allow it to start as an internal adapter over
   the existing callbacks.
2. A pure projection from transcript to view model in the UI. Components
   render rows; they do not inspect provider-specific message shapes.
3. First-class reasoning and tool lifecycle events, plus semantic theme tokens
   and a screen registry.

Do not copy the full Rust layering. Peri's seven layers and Codex's app-server
earn their cost with multiple processes and multiple languages. `tnt` has one
process today. A new layer must remove a real coupling in this package or it
does not get added.

## 4. Target boundaries

```
protocol/        AgentEvent, AgentCommand, ids. No imports from stream or ui.
engine/          stream/, loop/, compaction/, cache/, tools/, permissions/
                 Existing code moves here only after the boundary is proven.
session/         controller.ts (run lifecycle), transcript.ts (append-only)
surfaces/
  tui/           Current ui/, consumes only the controller and projection.
  headless/      commands/chat.ts adapter over the controller.
  serve/         HTTP/SSE adapter over the controller.
config/          schema plus an immutable run snapshot.
services/        Long-lived infrastructure. Unchanged role.
```

Dependency rule: `protocol <- engine <- session/controller <- surfaces`.
`ui` must not import `stream/streamChatResponse.ts`; `stream` must not import
`ui`. A grep test can enforce both directions.

The folder moves are deliberately last. The first phases add files and reduce
coupling without relocating 400 existing modules.

## 5. Phased plan

### Phase A: UI projection (no engine change, start here)

A1. Add `src/ui/projection/transcript.ts` (done).
Input: one `ChatHistoryItem` plus the live-stream flags. Output: one
`TranscriptRow` or null when the item carries nothing to show; currently
`system`, `compaction`, and `message` rows, with the message row carrying
`reasoning`, `toolStates`, and a streaming flag. `projectMessage` owns the
`<think>` fallback, the display formatting for non-text parts, and the
reasoning source order: `item.reasoning.text`, then a `role: "thinking"`
message, then the `<think>` fallback.

A2. Split rendering into row components (done).
`MemoizedMessage` is a dispatcher over projected rows; `ThinkingMessage`
and `ToolGroupDisplay` receive projection data instead of parsing messages.
The memo comparator uses a bounded tool-state signature.

A3. Reasoning fold is view state, not render state (done).
Implemented as a small external store (`ui/reasoningFold.ts`) because
Ctrl+O has no row to target. It toggles every reasoning block at once and
`ThinkingMessage` reads it. Per-row expansion is a later refinement.

A4. Add `src/ui/theme/tokens.ts` (done).
Semantic names: `text.primary`, `text.secondary`, `text.subtle`,
`status.success`, `status.error`, `status.warning`, `status.running`,
`status.idle`, `border.default`, `border.focus`, `accent`, `user`.
They map to Ink colour names in one place. No gradients and no hover
effects. The new components use them; `BottomStatusBar`,
`ToolPermissionRequest`, and `CompactionBoundary` still hold literals.

A5. Replace the `ScreenContent` if/else chain with
`src/ui/screens/registry.tsx` (done): a `ScreenDefinition` has an id and a
render function. The navigation context stores an id; the registry resolves
it. This mirrors Peri's `panel_registry.rs` without its rendering
machinery.

A6. Render the queued messages from `MessageQueue` as rows above the composer
(done). Each entry has an id; the queue emits enqueue, dequeue, remove, and
update events, and the view resyncs from a snapshot on any of them. Ctrl+X
removes the newest entry; Ctrl+R removes it and hands its text back to the
composer. The rows never write history; only the engine's dequeue does.

Acceptance: `npx tsc --noEmit`, projection unit tests, existing UI tests, and
no new import of `stream/` from `ui/` except the existing `executeStreaming`
seam.

### Phase B: event boundary

B1. Add `src/protocol/events.ts` and `src/protocol/commands.ts` (done).
Events: `turn.started`, `content.delta`, `reasoning.delta`,
`tool.started`, `tool.updated`, `tool.finished`, `permission.requested`,
`question.requested`, `notice`, `compaction.*`, `turn.completed`,
`turn.failed`, `turn.interrupted`, `queue.changed`, `session.changed`.
Commands: `prompt.submit`, `turn.interrupt`, `permission.respond`,
`question.respond`, `session.load`, `session.fork`.
Both carry `sessionId`, and events carry `turnId` plus a monotonic `seq`.
`EventGate` drops an event a surface has already passed.

B2. Add `src/stream/eventAdapter.ts` mapping `StreamCallbacks` to
`AgentEvent` (done). `onReasoning` and `onToolUpdate` are on
`StreamCallbacks`; `responseChunks.ts` forwards `reasoning_content` and
`toolExecution.ts` reports lifecycle changes. The `<think>` parser remains a
compatibility fallback in the projection.

B3. Add `src/session/controller.ts` (done). `startAgentTurn` owns one run's
abort controller and event sequence; `runAgentTurn` is the awaitable form.
It is the only production module that imports `streamChatResponse`, with the
summarizer as the documented exception. Queue and approval responses still
live in their existing owners and are reached through the interaction broker
in Phase D.

B4. Migrate the TUI, headless, serve, subagent, and review surfaces to the
controller (done). `serve.ts` adds `GET /events` as server-sent events while
keeping the polling endpoints for the current remote client.

B5. Keep `spec/index.md` and `ARCHITECTURE-tnt.md` aligned (done). Both name
the controller and the event contract, and `spec/wire-format.md` documents
`/events`.

Acceptance: the TUI, headless, and serve paths each run a turn through the
controller; a grep test allows `streamChatResponse` imports only in the
controller and the summarizer; event ordering tests pass.

### Phase C: transcript

C1. `src/session/transcript.ts` (done): `MessageId`, append and appendBatch,
a staging batch, `replace` with an explicit reason, and a compaction mark.
Ids are written onto the item as `messageId` so a persisted session reloads
with the same identity.
C2. `ChatHistoryService` is an adapter over the transcript (done). Append
methods use `Transcript.append`; the assistant message with tool calls is
staged and committed by the first tool result. The UI's `setChatHistory` is a
proxy to the service, so the service remains the only writer. The fallback
branches still exist for unit tests with an uninitialized service; they call
the same proxy rather than a second store.
C3. Compaction records a mark for the first retained message (done). The
existing compactor still produces the retained array; rewriting the compactor
to prune only at read time is deliberately left out, because the cached-prefix
tests pin the current byte layout.
C4. Replay test (done): a persisted history with `messageId` reloads with the
same ids, and compaction keeps the message bodies.

Acceptance: one writer per turn, prefix tests unchanged, replay test green.

### Phase D: config and interaction

D1. `src/config/snapshot.ts` (done): a frozen snapshot with a revision. The
controller captures it at run start and passes `mode` and `isHeadless` through
`StreamRunOverrides`; the engine no longer rereads the permission mode between
rounds. The system prompt is still resolved by the existing service at the
start of the run, then held by `systemPromptRound.ts`.
D2. `src/permissions/interactionBroker.ts` (done): one interface for
approvals and questions, with the live broker and a non-interactive broker.
The TUI answers both through it.
D3. `src/hooks/facets.ts` (done): every hook event maps to a named facet
(prompt, tool, guard, session, notification), so a new entry point extends a
facet instead of adding another mechanism.

## 6. Invariants

- The engine never imports `ui/`.
- The UI never writes the transcript; it sends commands.
- One run has one writer and one event sequence.
- Transcript writes are append-only; compaction changes views, not message
  bodies.
- Reasoning is a typed value, never inferred from assistant prose when a typed
  value exists.
- Every surface answers approvals and questions through the same broker.
- A run reads one config snapshot.

## 7. Verification

- `npx tsc --noEmit`
- `npx vitest run`
- `npx prettier --check "src/**/*.{ts,tsx}"`
- Import-direction test for `ui/` and `stream/`.
- Event ordering and projection snapshot tests.
- Replay test for transcript persistence.

## 8. Explicitly not doing

- No Rust-style multi-crate split.
- No new process or daemon for the TUI.
- The event contract is now also carried by the ACP edge. ACP itself is a
  supervisor plus one single-session worker process per editor session; the
  engine is not rewritten to be per-session. See [acp.md](./acp.md).
- No rewrite of compaction, tools, or permissions in the same phase as the UI
  projection.
- No gradient, hover, or decorative animation in the terminal UI.
