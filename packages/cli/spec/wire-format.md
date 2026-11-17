# HTTP Wire Protocol: `tnt remote` <-> `tnt serve`

This document describes the HTTP protocol used for communication between the `tnt remote` client and `tnt serve` server

## Overview

The protocol uses a polling-based REST API where:

- The server (`tnt serve`) runs an Express HTTP server on port 3000
- The client (`tnt remote`) polls the server every 500ms for state updates
- All communication uses JSON payloads

## Endpoints

### `GET /state`

Returns the current chat state including message history and processing status.

**Response:**

```json
{
  "chatHistory": [
    {
      "role": "user" | "assistant" | "system",
      "content": "string",
      "isStreaming": boolean,
      "messageType": "tool-start" | "tool-result" | "tool-error" | "system",
      "toolName": "string",
      "toolResult": "string"
    }
  ],
  "isProcessing": boolean,
  "messageQueueLength": number
}
```

### `GET /events`

Streams the engine event contract as server-sent events. Each message carries
an `event:` line with the event type and a `data:` line with the JSON payload.
The payload includes `sessionId`, `turnId`, a monotonic `seq`, and a timestamp.
The polling `/state` endpoint remains for clients that do not consume events.

### `POST /message`

Sends a user message to the server. Messages are queued and processed sequentially.

**Request Body:**

```json
{
  "message": "string"
}
```

**Response:**

```json
{
  "queued": true,
  "position": number,
  "willInterrupt": boolean
}
```

**Special Cases:**

- Empty message (`""`) interrupts current processing
- Message `/exit` initiates server shutdown

### `GET /diff`

Returns the git diff between the current branch and main branch.

**Response (Success):**

```json
{
  "diff": "string"
}
```

**Response (Error):**

- 404: Not in a git repository
- 500: Git command failed

### `POST /exit`

Gracefully shuts down the server.

**Response:**

```json
{
  "message": "Server shutting down",
  "success": true
}
```

## Message Types

Messages in the chat history can have different types:

- **Regular messages**: Standard user/assistant messages
- **Tool messages**: Messages with `messageType` set to:
  - `tool-start`: Tool execution started
  - `tool-result`: Tool execution completed
  - `tool-error`: Tool execution failed
  - `system`: System messages

## Protocol Flow

1. **Client starts**: Begins polling `GET /state` every 500ms
2. **User sends message**: Client posts to `POST /message`
3. **Server queues message**: Returns queue position
4. **Server processes**: Updates state with streaming responses
5. **Client displays**: Shows updates from state polling
6. **Interruption**: Client sends empty message to interrupt
7. **Exit**: Client sends `/exit` or `POST /exit` to shutdown

## Implementation Files

### Server Implementation

- **Main server**: `src/commands/serve.ts:51-363`
  - Express server setup
  - Endpoint handlers
  - State management
  - Message processing

### Client Implementation

- **Remote chat hook**: `src/ui/hooks/useChat.ts:170-310`
  - State polling logic
  - Message sending
  - Interrupt handling

### Type Definitions

- **Display message types**: `src/ui/types.ts:1-16`
- **Server state interface**: `src/commands/serve.ts:20-33`

### Testing

- **Mock server**: `test-utils/mockRemoteServer.ts`
  - Complete mock implementation for testing
  - Simulates streaming and message processing

## Features

### Message Queueing

- Messages are queued and processed one at a time
- Queue position returned on message submission
- Supports interruption of current processing

### Streaming Support

- `isStreaming` flag indicates ongoing response
- Character-by-character updates for real-time display

### Auto-shutdown

- Server shuts down after timeout (default: 300 seconds)
- Configurable via `--timeout` flag

### Error Handling

- HTTP status codes for error conditions
- Graceful error messages in responses

## Security Considerations

- The server binds `127.0.0.1` by default (localhost only). `--host <addr>`
  selects the interface. A bind beyond loopback requires a token
  (`--token <value>` or `TNT_SERVE_TOKEN`): the run is refused instead of
  starting quietly anonymous, because an exposed port that can post prompts,
  answer permission requests and pause a run must not be anonymous
- When a token is configured, every route demands it ahead of every handler:
  `Authorization: Bearer <token>`, the webui token cookie, or `?token=` (the
  query form exists because EventSource cannot set request headers). An
  unauthenticated request answers 401 on every interface
- A browser page in the same machine can still reach a loopback port, so every
  request passes a browser-origin guard before any handler runs: a Host header
  naming anything but the loopback host on the served port is rejected (DNS
  rebinding), and a request whose Origin header is not a loopback origin is
  rejected (cross-site writes). Command-line clients send neither header and
  are unaffected
- File system access through tool execution

## Control endpoints

Two routes exist for clients that drive a session from outside the TUI. Nothing in
this package calls them; they are part of the HTTP surface a remote client uses.

- `POST /pause` - pauses the run that is in flight. Answers
  `{ success: false, message: "No active processing to pause" }` when nothing is
  processing, and refreshes the idle timer either way.
- `POST /permission` - answers a pending permission request. Body:
  `{ requestId, approved }`. Answers 400 `{ error: "No pending permission request" }`
  when there is nothing to answer.
