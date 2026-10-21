# TNT CLI terminal UI spec

The CLI renders its interactive surface with Ink.

## Layout

The interactive surface is a fixed-height viewport. The transcript occupies the
rows above the pinned status bars and composer; a spacer below the transcript
pushes short content to the top of that area, so a fresh screen shows the banner
at the top and the composer at the bottom, with the empty space between them.
When the transcript outgrows the viewport the spacer is zero, the oldest rows
clip at the top, and the newest content stays next to the composer. PgUp and
PgDn move the transcript by half a screen; scrolling back to the end resumes
following new output (`src/ui/TUIChat.tsx`,
`src/ui/components/TranscriptContent.tsx`, `src/ui/utils/viewport.ts`).

While the view is scrolled up, a centred `↓ Jump to latest message · Ctrl+End`
hint sits on the last row of the viewport, directly above the composer; End and
Ctrl+End return to the live tail, and submitting a message returns there too.
The first screen's banner is a two-line half-block wordmark with the version
beside it (`src/startup/asciiArt.ts`).

## Streaming and the working spinner

The answer streams into the transcript as it arrives. Chunks never touch the
chat history - every history write persists the session - so the live text
renders from a throttled overlay (`STREAM_RENDER_INTERVAL_MS` in
`src/ui/hooks/useChat.stream.helpers.ts`) until the turn's message lands. The
working spinner renders in the transcript flow, directly below the newest
message, not pinned above the composer
(`src/ui/components/ActionStatus.tsx` inside the viewport in
`src/ui/TUIChat.tsx`).

## Command palette

Typing `/` as the first character opens the command window above the composer.
It shows at most five entries with a sliding selection
(`MAX_VISIBLE_COMMANDS` in `src/ui/SlashCommandUI.tsx`), filtered by the text
after the slash and sharing the composer's loaded command list. Enter completes
the highlighted name into the input; it runs the command only once a prefix has
been typed, so a bare `/` plus Enter never executes anything
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

The composer's top border carries `[Manual]` in gray, `[Accept edits]` in cyan, `[Plan]` in blue,
`[Auto]` in green, or `[Bypass permissions]` in red
(`src/ui/components/ModeIndicator.tsx`). Agent mode draws no badge and the plain border.
The mode does not change the status bar.
