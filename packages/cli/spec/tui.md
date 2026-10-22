# TNT CLI terminal UI spec

The CLI renders its interactive surface with Ink.

## Layout

The interactive surface is a fixed-height viewport. The transcript occupies the
rows above the pinned status bars and composer, bottom-anchored: a fresh screen
shows the banner at the top and the composer at the bottom, and a long
transcript clips its oldest rows above the window. PgUp and PgDn scroll by
messages (a page is a third of the terminal rows) by hiding that many newest
messages from the end; the live tail keeps following new output, and hiding
even one message stops the streaming overlay and the working indicator until
the reader returns. End and Ctrl+End return to the tail, as does submitting a
message (`src/ui/TUIChat.tsx`, `src/ui/components/TranscriptContent.tsx`).

While the view is scrolled up, a centred `↓ Jump to latest message · Ctrl+End`
hint sits in the fixed dock directly above the composer.
The first screen's banner is an animated fire "TNT", centred in the terminal:
the letters read as a black silhouette while tall, thin blood-red tongues
climb around them and flicker through a character ramp (`.` to `@`),
coloured black-to-crimson with a rare pale ember (`src/ui/components/FireLogo.tsx`,
`src/ui/utils/fireLogo.ts`). A narrow
terminal, a pipe, or `NO_COLOR` falls back to the two-line half-block wordmark
with the version beside it (`src/startup/asciiArt.ts`).

## Streaming and the working spinner

The answer streams into the transcript as it arrives. Chunks never touch the
chat history - every history write persists the session - so the live text
renders from a throttled overlay (`STREAM_RENDER_INTERVAL_MS` in
`src/ui/hooks/useChat.stream.helpers.ts`) until the turn's message lands. The
working indicator renders in the transcript flow, directly below the newest
message, as a grey spinner with a `Thinking…` label and the elapsed time
(`src/ui/components/ActionStatus.tsx` inside the viewport in
`src/ui/TUIChat.tsx`).

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

The top row, left to right:

- the workspace name: `remoteUrl` in remote mode, otherwise the last segment of the
  process working directory
- the git branch, when the process is in a repository and not in remote mode
- the prefix state, only when the last request invalidated or extended the cache prefix
- the compaction cost, only when a compaction ran in this session
- an image-in-clipboard marker while one is present

The top row, right to left: the model name, then the reasoning depth when the selected
model declares one.

The second row is the usage line: context occupancy, the session cache-hit ratio, output
tokens, and cost when the session has spent anything. Occupancy and cache stay on their
own row because they are read as one figure.

No GitHub owner or repository is displayed. The status bar resolves the branch only and
never looks up the remote.

## Mode badge

The composer's top border carries `[Manual]` in white, `[Accept edits]` in cyan, `[Plan]` in blue,
`[Auto]` in green, or `[Bypass permissions]` in red
(`src/ui/components/ModeIndicator.tsx`). Agent mode draws no badge and the plain border.
The mode does not change the status bar.
