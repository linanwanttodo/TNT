# TNT CLI terminal UI spec

The CLI renders its interactive surface with Ink.

## Layout

Finished transcript items go to Ink's `<Static>` and stay in the terminal's
scrollback. On a fresh screen the transcript prints one terminal-height blank
anchor before the banner, so the banner and the live frame (status rows and
composer) end at the bottom of the screen instead of floating under it. Once
the transcript is longer than the screen, ordinary terminal scrolling keeps the
composer on the last row; the anchor is not reprinted
(`src/ui/components/StaticChatContent.tsx`).

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
