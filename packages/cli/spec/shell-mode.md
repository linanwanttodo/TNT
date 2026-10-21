# Shell Mode (CLI TUI)

In the interactive input, text whose leading whitespace is followed by `!` is a shell
command. `!git status` and ` !ls -la` both enter shell mode; the text after `!` is
trimmed and becomes the command. An input whose trimmed text is only `!` stays a normal
message.

## Indicator

The composer border turns yellow and the prompt becomes `$ `
(`src/ui/UserInput.tsx`).

## Submission

`handleBashModeProcessing` in `src/ui/hooks/useChat.shellMode.ts`:

1. Adds an assistant message carrying a tool call named `Bash` with
   `{"command": "<text after !>"}`, marked `calling`.
2. Returns `null`, so the text is not sent to the model.
3. Runs the command asynchronously through `runTerminalCommandTool`. On success the
   result is attached with status `done`; on failure the status is `errored` and the
   text is `Bash command failed: ...`.

The command runs directly from the TUI; shell mode does not consult the permission
policies. A single Ctrl+C shows the exit hint and does not stop the command; a second
Ctrl+C within one second exits the CLI.

## Exiting shell mode

- Submitting sends the command and the next input starts outside shell mode.
- Esc while the trimmed input is exactly `!` clears the input and exits.
- Editing the text so it no longer starts with `!` exits.

## Limits

Output is capped at 50,000 characters and 1,000 lines by default;
`CONTINUE_CLI_BASH_MAX_OUTPUT_CHARS` and `CONTINUE_CLI_BASH_MAX_OUTPUT_LINES` change the
caps.

The 180-second timeout measures inactivity: output resets it, so a long-running command
that keeps printing is not cut off. When it fires, the result carries
`[Command timed out after 180 seconds of no output]`. A timeout supplied to the tool is
capped at 600 seconds. `TEST_TERMINAL_TIMEOUT` replaces the window only when
`NODE_ENV=test`.

## Source

- `src/ui/hooks/useChat.shellMode.ts` - activation and tool-call lifecycle
- `src/tools/runTerminalCommand.ts` - execution, truncation and timeout
- `src/ui/UserInput.tsx` - indicator and Esc handling
