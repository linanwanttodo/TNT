# TNT CLI terminal UI spec

The CLI renders its interactive surface with Ink.

## Layout

The chat owns the terminal's alternate screen (`ESC[?1049h`), entered before
the first frame and restored on every exit path, so the shell's own screen and
scrollback are never rewritten. The frame is exactly the height of the
terminal: the transcript scrolls inside the app above a dock that stays pinned
to the bottom, so the composer, the status line and a pending permission
prompt can never scroll away from the reader
(`src/ui/utils/terminalScreen.ts`).

Scrolling is the app's: the mouse wheel, `PageUp`/`PageDown`, `Home` and `End`
move the transcript by whole rows through a viewport clipped against the dock.
The viewport measures the rendered transcript with `measureElement` instead of
estimating message heights, so every scroll is a row offset into real layout;
at the tail new rows keep arriving at the bottom, and while the reader is
scrolled back a `↓ Jump to latest message · Ctrl+End` hint sits above the dock.
That row is clickable as well as a keybinding target: a click on it calls the
same `jumpToBottom` the shortcut uses (`src/ui/components/Composer.tsx`).
Sending a message returns to the tail
(`src/ui/hooks/useChatViewport.ts`, `src/ui/components/ScrollView.tsx`,
`src/ui/hooks/useMouseEvents.ts`).

A root box as tall as the terminal makes Ink take its fullscreen branch and
call `clearTerminal` (`ESC[2J ESC[3J`); inside the alternate buffer those
clears are contained, which is what keeps the shell's scrollback intact on
exit. `/clear`, a reload and opening another session clear the app's own
screen.

The first screen's header sits in the terminal's top-left corner: a compact
four-row `TNT` wordmark in solid light blue, with the name and version
top-aligned to its right and the selected model one line below
(`src/ui/components/BrandBanner.tsx`). It belongs to the live frame and is
only rendered while the conversation has no non-system message, so the first
submitted message removes it instead of leaving the banner above the
transcript. A narrow terminal or `NO_COLOR` falls back to the two-line
half-block wordmark with the version beside it
(`src/startup/asciiArt.ts`).

## Streaming and the working spinner

The answer streams into the transcript as it arrives. Chunks never touch the
chat history - every history write persists the session - so the live text
renders from a throttled overlay (`STREAM_RENDER_INTERVAL_MS` in
`src/ui/hooks/useChat.stream.helpers.ts`) until the turn's message lands. The
working indicator renders after the live rows, directly below the newest
message, as a grey spinner with a `Thinking…` label and the elapsed time
(`src/ui/components/ActionStatus.tsx`, rendered at the end of
`src/ui/components/TranscriptContent.tsx`).

## Tool calls

Each tool call is a rounded frame whose border colour reports the state: the
accent while pending or running, the dim spine colour after a clean exit, red
after a failure and yellow when cancelled. The title sits inside the top
border bar: the status glyph, the tool name in the accent colour, its subject
in the secondary colour and a short `·` summary of what the call produced.
Output sits below it, folded to its last four rows with the number of hidden
rows above and a `click to expand` hint; clicking the panel shows the whole
output and the next click folds it again. A finished call folds itself, so the
transcript settles without the reader clicking anything. The markers are `✓`
done, `o` pending, `⊷` running, `x` failed and `-` cancelled
(`src/ui/components/ToolGroupDisplay.tsx`). Shell calls read as `$ command`.

## Permission prompt

A pending permission replaces the composer rows. The call's title sits on the
first row and the body hangs from a left guide. The body follows the tool: a
shell approval prints the whole command verbatim, newlines and indentation
included, with the working directory it will run in under it; an edit, write or
patch approval renders the engine's diff preview folded to eight rows that `e`
expands and folds; every other tool keeps the argument preview the engine
built. The choices below keep their numbers and shortcuts
(`src/ui/components/ToolPermissionSelector.tsx`).

## Messages

A user turn starts with a blue `>` and the prompt uses the primary text colour,
so the reader's own words do not recede behind the answer. A model turn starts
with a cyan `✦` and renders its markdown. Reasoning that arrives on the
provider's separate channel is stored beside the assistant message and renders
above the answer as the thought itself in the muted italic colour, keeping its
paragraph breaks, with no label or rule. A live thought streams open; when the
round ends the stored block folds behind a single `Thinking...` line. Clicking
one block toggles only that block, and `Ctrl+O` sets the default for every
finished block, the way Claude Code's `Thought for …` summaries work
(`src/ui/components/MemoizedMessage.tsx`,
`src/ui/components/ThinkingMessage.tsx`).

## Images

`Ctrl+V` in the composer attaches a clipboard image
(`src/ui/hooks/useUserInput.ts`). The buffer inserts an `[Image #N]`
placeholder and keeps the bytes in a map, bounded at 10 MB per image, 20
images and 50 MB total (`src/ui/TextBuffer.ts`); the paste handler reads the
clipboard directly when the key is pressed, because a background status probe
and the full read can use different backends on Linux. On send, each
placeholder is replaced with the image; sharp scales it to fit 1024×1024 and
re-encodes it as JPEG at quality 85, falling back to the original bytes when
sharp is unavailable (`src/ui/hooks/useChat.imageProcessing.ts`). There is no
clipboard marker in the status bar and no periodic clipboard polling; the
clipboard is only read for an explicit paste.

Linux reads images from `wl-paste` on Wayland or WSL and from `xclip` on X11,
then from a bundled X11 helper; the helper covers an XWayland desktop with no
clipboard utilities installed, while a pure Wayland session without XWayland
needs `wl-clipboard`. macOS uses `osascript`, Windows uses PowerShell, and both
fall back to the bundled helper. The prebuilds live in `native/<platform>/`
and are copied to `dist/native/` by the build
(`src/utils/clipboardImage.ts`, `src/utils/nativeClipboard.ts`).

## Composer rows

The session goal and the todo list render above the composer box, outside its
top border, not between the border and the input row. At most five unfinished
todos are drawn; completed items appear only in the `Todos done/total` count,
and unfinished items past the fifth collapse into a `· +N` counter on the same
header, so the panel cannot push the input up by more than six rows. With no
unfinished todo the panel draws nothing (`src/ui/UserInput.tsx`,
`src/ui/components/TodoIndicator.tsx`,
`src/ui/components/GoalIndicator.tsx`).

## Command palette

Typing `/` as the first character opens the command window above the composer
box, outside its border. It shows at most five entries with a sliding selection
and ▲/▼ overflow markers (`MAX_VISIBLE_COMMANDS` in
`src/ui/SlashCommandUI.tsx`), and the highlighted row draws its name and
description in blue, so the selection reads clearly without a marker or a
full-row colour band. The window follows the typed path:
a command with `subcommands` (for example `/language`) is completed with a
trailing space instead of running, and its children then replace the list under
a `-- /language --` header, filtered by the next token; picking one runs
`/parent child`. Enter runs a leaf only once a prefix has been typed, so a bare
`/` plus Enter never executes anything, and Esc closes the window at any level
(`src/ui/UserInput.tsx`).

## Status bar

Two rows sit under the composer (`src/ui/components/BottomStatusBar.tsx`).

The status bar is one row. Left to right:

- the workspace name: `remoteUrl` in remote mode, otherwise the last segment of the
  process working directory
- the git branch, when the process is in a repository and not in remote mode
- the prefix state, only when the last request invalidated or extended the cache prefix
- the count of running background jobs, clickable and collapsed per job kind, when
  any job is live

The right end holds the model name, the reasoning depth when the selected model declares
one, and the update state. The context occupancy, cache ratio, output tokens and cost
are not on the row: `/cost` prints them on demand
(`src/ui/commands/handlers/cost.ts`). The location side truncates first on a narrow
terminal; the bar never wraps onto a second row.

No GitHub owner or repository is displayed. The status bar resolves the branch only and
never looks up the remote.

## Mode badge

The composer's top border carries `[Manual]` in white, `[Accept edits]` in cyan, `[Plan]` in blue,
`[Auto]` in green, or `[Bypass permissions]` in red
(`src/ui/components/ModeIndicator.tsx`). Agent mode draws no badge and the plain border.
The mode does not change the status bar.
