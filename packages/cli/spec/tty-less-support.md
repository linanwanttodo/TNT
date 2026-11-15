# TTY-less Environment Support

## Overview

The TNT CLI supports running in TTY-less environments (environments without a terminal/TTY), which is essential for:

- VSCode and IntelliJ extensions using the `Bash` tool
- Docker containers without TTY allocation
- CI/CD pipelines
- Automated scripts and tools
- Background processes

## Architecture

### Mode Separation

The CLI has two distinct execution modes with complete separation:

1. **Interactive Mode (TUI)**: Requires a TTY, uses Ink for rendering
2. **Headless Mode**: Works in TTY-less environments, outputs to stdout/stderr

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                       │
│                         (src/index.ts)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
    ┌───────▼────────┐       ┌───────▼─────────┐
    │ Interactive    │       │   Headless      │
    │ Mode (TUI)     │       │   Mode (-p)     │
    │                │       │                 │
    │ • Requires TTY │       │ • No TTY needed │
    │ • Uses Ink     │       │ • Stdin/stdout  │
    │ • Keyboard UI  │       │ • One-shot exec │
    └────────────────┘       └─────────────────┘
```

### Safeguards Implemented

#### 1. **TTY Detection Utilities** (`src/utils/cli.ts`)

```typescript
// Check if running in TTY-less environment
export function isTTYless(): boolean;

// Check if environment supports interactive features
export function supportsInteractive(): boolean;

// Check if prompt was supplied via CLI arguments
export function hasSuppliedPrompt(): boolean;
```

#### 2. **Stdin Reading Protection** (`src/utils/stdin.ts`)

Prevents stdin reading when:

- In headless mode with supplied prompt
- `FORCE_NO_TTY` environment variable is set
- In test environments

This avoids blocking/hanging in TTY-less environments where stdin is not available or not readable.

#### 3. **TUI Initialization Guards** (`src/ui/index.ts`)

The `startTUIChat()` function now includes multiple safeguards:

- **Headless mode check**: Throws error if called in headless mode
- **TTY-less check**: Throws error if no TTY is available
- **Raw mode test**: Validates stdin supports raw mode (required by Ink)
- **Explicit stdin/stdout**: Passes streams explicitly to Ink

```typescript
// Critical safeguard: Prevent TUI in headless mode
if (isHeadlessMode()) {
  throw new Error(
    "Cannot start TUI in headless mode. This is a programming error - " +
      "startTUIChat should not be called when -p/--print flag is used.",
  );
}

// Critical safeguard: Prevent TUI in TTY-less environment
if (isTTYless() && !customStdin) {
  throw new Error(t("ui.ttyLess"));
}
```

#### 4. **Headless Mode Validation** (`src/commands/chat.ts`)

Ensures headless mode has all required inputs:

```typescript
if (!prompt) {
  throw new Error(t("cli.headlessNeedsPrompt"));
}
```

#### 5. **Logger Configuration** (`src/utils/logger.ts`)

When headless mode runs without any TTY, it sets UTF-8 as the default encoding
on stdout and stderr. It does not touch stream buffering.

## Usage Examples

### From VSCode/IntelliJ Extension

```typescript
import { exec } from "child_process";

exec('tnt -p "Analyze the current git diff"', (error, stdout) => {
  if (error) throw error;
  console.log(stdout);
});
```

### From Docker Container

```bash
# Without TTY allocation (-t flag)
docker run --rm my-image tnt -p "Generate a README"
```

### From CI/CD Pipeline

```yaml
- name: Run TNT CLI
  run: |
    tnt -p "Review code changes" --format json
```

### From Automated Script

```bash
#!/bin/bash
# Non-interactive script
tnt -p "Generate commit message for current changes" --silent
```

## Termination reasons and exit codes

A headless run reports how its turn ended twice: as the `reason` on the
`turn-end` event with `--format stream-json`, and as the process exit status. A
turn that stopped early still printed the work it produced, so the status is the
signal a script can branch on without parsing output.

There is no round limit by default: the loop keeps going while the model asks
for tools. `--max-steps <count>` imposes one. `--request-timeout <seconds>`
bounds the headless turn's wall clock; the default is 300 seconds
(`src/commands/headlessTimeout.ts`), and `0` disables the deadline.

The deadline aborts the provider request in flight and carries that abort into
tool execution: a shell command that is already running is stopped, and a call
that has not started is reported as not executed instead of spawning work the
run no longer wants. Two things still finish under their own limits: a tool that
ignores the abort (tool timeouts are per call — a foreground shell command
defaults to 180 seconds and caps at 600), and a command running in an editor
terminal, which the runner owns and this process cannot interrupt. Post-turn work
that answers for the turn (schema repair, session title generation) is skipped
once the turn was cut short.

| Reason                    | Exit | Partial output kept | Trigger                                                                                     |
| ------------------------- | ---- | ------------------- | ------------------------------------------------------------------------------------------- |
| `no_tool_calls`           | 0    | n/a - complete      | The model replied without asking for a tool.                                                |
| `user_abort`              | 0    | yes                 | The caller aborted the run, including Ctrl+C.                                               |
| `hook_stop`               | 0    | yes                 | A caller-supplied hook asked for the turn to end.                                           |
| `tool_stop`               | 0    | yes                 | A tool reported that the turn should not continue.                                          |
| `max_steps`               | 1    | yes                 | The explicit `--max-steps` ceiling was reached; without that flag this reason cannot occur. |
| `loop_detected`           | 1    | yes                 | The assistant's output started repeating itself.                                            |
| `compaction_circuit_open` | 1    | yes                 | Automatic compaction failed to shrink the history too many times in a row.                  |
| `stream_stall`            | 1    | yes                 | The response stream kept ending before the round finished and retrying stopped helping.     |
| `context_unrecoverable`   | 1    | yes                 | The conversation no longer fits the context window and compaction could not recover it.     |
| `request_timeout`         | 1    | yes                 | The `--request-timeout` deadline expired; the run stops at the next round boundary.         |

The exit status is computed from the reason alone: the four normal endings are
`0` and every other reason is `1`. Interactive mode does not use this mapping
and keeps its own behaviour.

A truncation is visible in machine-readable output as well: with
`--format stream-json` the `turn-end` event carries the reason and the final
`result` line has `subtype: "error"`; with `--format json` the document carries
`status: "error"` and the notice as `error`.

## Environment Variables

- `FORCE_NO_TTY=true`: prevents stdin reading
- `TNT_TEST=true`: marks a test environment, prevents stdin reading

The stdin reader also returns immediately under a test runner (`NODE_ENV=test`,
`VITEST=true`, or a set `JEST_WORKER_ID`), and when `-p` was given a prompt. A
missing or unreadable stdin resolves to no input rather than hanging.

## Testing

### TTY-less Test

```typescript
const result = await runCLI(context, {
  args: ["-p", "Hello, world!"],
  env: {
    FORCE_NO_TTY: "true",
  },
});
```

### Expected Behavior

- ✅ Should not hang on stdin
- ✅ Should not attempt to initialize Ink
- ✅ Should output results to stdout
- ✅ Should exit cleanly

## Error Messages

### Attempting TUI in TTY-less Environment

The start-up guard throws `t("ui.ttyLess")`; the raw-mode guard throws
`t("ui.rawModeRequired")`. Both messages end with the `-p` command to use instead.

### Missing Prompt in Headless Mode

The chat command throws `t("cli.headlessNeedsPrompt")`, which names the accepted forms:
`-p "prompt"`, piping stdin, and `-p --agent <file>`.

## Troubleshooting

### CLI Hangs in Docker/CI

**Cause**: CLI attempting to read stdin in TTY-less environment

**Solution**: Ensure using `-p` flag with a prompt:

```bash
tnt -p "your prompt" --config config.yaml
```

### "Cannot start TUI" Error

**Cause**: Attempting interactive mode in TTY-less environment

**Solution**: Use headless mode:

```bash
tnt -p "your prompt"
```

### Raw Mode Error

**Cause**: Terminal doesn't support raw mode (required by Ink)

**Solution**: Use headless mode instead of interactive mode

## Design Principles

1. **Fail Fast**: Detect environment early and fail with clear messages
2. **Explicit Separation**: No code path should allow Ink to load in headless mode
3. **No Blocking**: Never block on stdin in TTY-less environments
4. **Clear Errors**: Provide actionable error messages with examples
5. **Testing**: Comprehensive tests for TTY-less scenarios

## Test coverage

`e2e/headless-minimal.test.ts` runs the CLI with `-p` and a supplied prompt in
an environment without a TTY. `src/utils/stdin.test.ts` pins the early returns
for the test-runner and `FORCE_NO_TTY` cases. `src/ui/ttyLessDoc.test.ts` reads
this page against the implementation.

## Related Files

- `src/utils/cli.ts` - TTY detection utilities
- `src/utils/stdin.ts` - Stdin reading protection
- `src/ui/index.ts` - TUI initialization guards
- `src/commands/chat.ts` - Mode routing and validation
- `src/utils/logger.ts` - Output configuration
- `test-utils/cli-helpers.ts` - Test support
- `e2e/headless-minimal.test.ts` - TTY-less tests
