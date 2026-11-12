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
top-aligned to its right (`src/ui/components/BrandBanner.tsx`). The selected
model is in the status row, not the header. It is the first row of the
transcript and stays there as the conversation grows, scrolling up with the
content the way the reference CLI's header does. A narrow terminal or
`NO_COLOR` falls back to the two-line half-block wordmark with the version
beside it (`src/startup/asciiArt.ts`).

## Terminal title

The tab title carries the static `✳` prefix. While a turn runs it alternates
`⠂` and `⠐` every 960 ms; an idle title never animates. The title is written as
OSC 0, sanitised of C0 controls and DEL, cut to 100 characters, and restored to
the idle prefix on exit (`src/ui/terminalStatusLight.ts`).

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

Each tool call is a row beginning with a status dot in a fixed two-column
gutter: dim while queued, blinking to a space every 600 ms while running, green
after a clean exit, red after a failure and dim when cancelled. The tool name is
bold in the accent colour, followed by its subject in the secondary colour and a
short `·` summary of what the call produced. Output hangs below the call behind
a gutter of two spaces, `⎿` and one space; it is folded to its last four rows
with the number of hidden rows above and a `click to expand` hint; clicking the
panel shows the whole output and the next click folds it again. A finished call
folds itself, so the transcript settles without the reader clicking anything
(`src/ui/components/ToolGroupDisplay.tsx`). Shell calls read as `$ command`.

## Messages

A user turn starts with the same muted `>` pointer the composer uses, and the
message text uses the primary text colour, so the reader's own words do not
recede behind the answer. A model turn renders its markdown with no glyph. Reasoning that arrives on the
provider's separate channel is stored beside the assistant message and renders
above the answer as the thought itself in the muted italic colour, keeping its
paragraph breaks, with no label or rule. A live thought streams open; when the
round ends the stored block folds behind a single `Thinking...` line. Clicking
one block toggles only that block, and `Ctrl+O` sets the default for every
finished block (`src/ui/components/MemoizedMessage.tsx`,
`src/ui/components/ThinkingMessage.tsx`).

## Agent questions

A pending question replaces the composer rows with a rounded card. One tab per
question sits on the first row, marked `○` while unanswered and `✓` once
answered; `Tab`, `Shift+Tab` and the left/right arrows move between questions.
The question is bold under a `?`, options below it use the `❯` pointer for the
focused row, and a final `Other` row becomes free text as soon as it is
selected or typed into. A multi-select question marks rows with `[✓]`/`[ ]`
and `Space` toggles them; an empty submission prints a required warning. A
question with no options is pure free text and accepts Enter for its default.
`Esc` (or `Ctrl+C`) cancels the whole set (`src/ui/components/QuizPrompt.tsx`).

## Permission prompt

A pending permission replaces the composer rows. The call's title sits on the
first row and the body hangs from a left guide. The body follows the tool: a
shell approval prints the whole command verbatim, newlines and indentation
included, with the working directory it will run in under it; an edit, write or
patch approval renders the engine's diff preview folded to eight rows that `e`
expands and folds; every other tool keeps the argument preview the engine
built. The choices below keep their numbers and shortcuts
(`src/ui/components/ToolPermissionSelector.tsx`).

## Composer

The input is framed by a full-width rule above and a full-width rule below,
with no side rails, as in the reference CLI. The mode badge is embedded in the
top rule, and both rules' colour reports the mode. The prompt marker is `❯` in
the subtle text colour, `$` in shell mode and `◉` in remote mode; while a turn
runs the marker dims instead of moving. The session goal and the todo list
render above the top rule, not between it and the input. At most five
unfinished todos are drawn; completed items appear only in the
`Todos done/total` count, and unfinished items past the fifth collapse into a
`· +N` counter on the same header, so the panel cannot push the input up by
more than six rows (`src/ui/UserInput.tsx`,
`src/ui/components/TodoIndicator.tsx`,
`src/ui/components/GoalIndicator.tsx`).

`Ctrl+F` opens history search as one muted row above the composer; the query,
the match position and the keys are in that row. `Ctrl+V` attaches a clipboard
image. A post-turn suggestion sits faint in the empty composer and `Tab`
accepts it.

## Suggestion overlay

One list floats above the composer for the token under the cursor. A `/` token
shows slash commands; an `@` token shows files, subagents and MCP resources
from every connected server, in that group order. Rows carry Claude Code's
type marks: `+` for a file, `*` for an agent, `◇` for an MCP resource, and
commands are plain `/name`. Filtering is case-insensitive over each row's name
and description; an empty query after `@` shows the top-level directories and
files to descend into.

Five rows are visible at a time and the window slides to keep the selection in
view, with an `n/total` counter once the list is longer. `Up`/`Down` move,
`Enter`/`Tab` accept, and `Esc` closes the list without changing the text. A
slash command completes rather than runs until a prefix has been typed; a
parent with `subcommands` completes with a trailing space and its children then
replace the list under a `-- /parent --` header, where accepting runs
`/parent child`. An accepted `@` row replaces the token with `@value` and one
separating space; a directory row keeps the path open with no trailing space,
and a file row is read and attached. `Ctrl+R` refreshes the file index while
the `@` list is open (`src/ui/UserInput.tsx`,
`src/ui/components/SuggestionOverlay.tsx`, `src/ui/suggestionSources.ts`).

The two established pickers remain the fallback until the assistant context
loads (`src/ui/SlashCommandUI.tsx`, `src/ui/FileSearchUI.tsx`).

## Plugin details

Selecting a plugin in the plugins browser opens a details view. It prints the
name, marketplace, version, status, description, author, source and, when an
update exists, `from -> to`. A `Will install:` block lists the commands,
agents, skills and MCP servers the plugin contributes, or states that the
manifest cannot be read. The action row follows the install state: install,
update, enable/disable, uninstall and back. Installed plugins carry a status
cell in the list (enabled, disabled, update available, pending, error), and a
failed catalog load prints a warning banner naming the marketplaces that did
not answer (`src/ui/PluginDetailsView.tsx`, `src/ui/PluginsBrowser.tsx`).

## Subagent tree

Delegated agents render under the composer as a box-drawing tree: `├─` for a
sibling and `└─` for the last row, a type badge, an optional description, the
tool-use and token counts known from the child transcript, and a `⎿`
continuation carrying the run's status line. Running agents stay visible;
finished and failed rows fold into a one-line summary once the turn ends or
their finish ages out, with the failure count appended when any failed
(`src/ui/components/SubagentTree.tsx`, `src/ui/subagentTree.ts`).

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

## Status bar

Two rows sit under the composer (`src/ui/components/BottomStatusBar.tsx`).

The status bar is one row. Left to right:

- the workspace name: `remoteUrl` in remote mode, otherwise the last segment of the
  process working directory
- the git branch, when the process is in a repository and not in remote mode
- the prefix state, only when the last request invalidated or extended the cache prefix
- the count of running background jobs, clickable and collapsed per job kind, when
  any job is live

The right end holds the model name and the reasoning depth when the selected model
declares one. The update badge appears only while an update is available or being
applied; the installed version is not repeated here, the header carries it. The
context occupancy, cache ratio, output tokens and cost are not on the row: `/cost`
prints them on demand (`src/ui/commands/handlers/cost.ts`). The location side
truncates first on a narrow terminal; the bar never wraps onto a second row.

No GitHub owner or repository is displayed. The status bar resolves the branch only and
never looks up the remote.

## Mode badge

The composer's top rule carries `[Auto]` by default; Shift+Tab can select
`[Manual]`, `[Accept edits]`, `[Plan]`, or `[Bypass permissions]`. Every badge colour comes from the active
theme - the primary text colour, the focus border, the accent, the success
and the error colour - so a palette change reaches the badge instead of
leaving a fixed ANSI name behind
(`src/ui/components/ModeIndicator.tsx`). Agent mode draws no badge and the
plain rule. The mode does not change the status bar.
