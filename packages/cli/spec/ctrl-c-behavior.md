# Ctrl+C exit behavior

`enableSigintHandler()` in `src/index.ts` installs the SIGINT handler that governs
leaving the interactive app. It is a two-stage exit over a 1 second window.

## First press

- Records the time of the press.
- Sets the exit-message flag. While the flag is set, the left side of the status bar
  shows the `status.exit` message instead of its usual parts
  (`BottomStatusBar.tsx`).
- Schedules the flag to clear after 1 second.

The app does not exit and no tool call is interrupted by this press.

## Second press within 1 second

- Unmounts the TUI through the registered `setTUIUnmount` callback.
- Calls `gracefulExit(0)`.

## Press after the window

A press more than 1 second after the first is treated as a new first press: the message
appears again and the window restarts. Leaving therefore takes two presses inside one
second.

## Source

- Handler and window: `enableSigintHandler()` in `src/index.ts`
- Message rendering: `shouldShowExitMessage()` in `src/index.ts`, read by
  `BottomStatusBar.tsx`
- Shutdown: `gracefulExit()` in `src/utils/exit.ts`
