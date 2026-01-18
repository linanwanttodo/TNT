import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `spec/tui.md` described the lower-left corner as the branch, then `owner/repo` when
 * columns allowed and the directory was a GitHub checkout, then the cwd outside git.
 * The shipped status bar has none of that: it shows the workspace name, the branch, the
 * prefix state and the compaction cost, and it never resolves the remote. A reader using
 * the page to find where something is drawn would look in the wrong corner.
 *
 * The claims the page makes are read back from the two components that render them. The
 * negative one (no owner/repo) is checked against the component as well, so adding such
 * a line without amending the page reddens here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");

const DOC = path.join(packageRoot, "spec", "tui.md");
const STATUS = path.join(here, "components", "BottomStatusBar.tsx");
const MODE = path.join(here, "components", "ModeIndicator.tsx");
const TRANSCRIPT = path.join(here, "components", "TranscriptContent.tsx");
const CHAT = path.join(here, "TUIChat.tsx");

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

const REPO_LOOKUP = /owner\/repo|gh repo|gh\s+repo/i;

describe("spec/tui.md agrees with the status bar and mode badge", () => {
  const doc = read(DOC);
  const flat = doc.replace(/\s+/g, " ");
  const status = read(STATUS);
  const mode = read(MODE);

  it("reads a page and components that render something", () => {
    expect(doc.length).toBeGreaterThan(300);
    expect(status.length).toBeGreaterThan(1_000);
    expect(/currentDirectory/.test(status)).toBe(true);
  });

  it("names the workspace source the status bar uses", () => {
    expect(
      /workspaceName = remoteUrl \?\? currentDirectory\(\)/.test(status),
    ).toBe(true);
    expect(doc).toContain("remoteUrl");
    expect(/currentDirectory|working directory/.test(flat)).toBe(true);
  });

  it("hides the branch in remote mode only while the source does", () => {
    const hides = /const branch = isRemoteMode \? null : getGitBranch\(\)/.test(
      status,
    );
    expect(/remote mode/.test(flat)).toBe(hides);
  });

  it("states the badge colours the component uses", () => {
    const colours =
      /default: \{ label: "Manual", color: "white" \}/.test(mode) &&
      /plan: \{ label: "Plan", color: "blue" \}/.test(mode) &&
      /bypassPermissions: \{ label: "Bypass permissions", color: "red" \}/.test(
        mode,
      );
    expect(colours).toBe(true);
    expect(/\[Manual\]/.test(flat)).toBe(true);
    expect(/\[Plan\]/.test(flat)).toBe(true);
    expect(/\[Bypass permissions\]/.test(flat)).toBe(true);
    expect(/blue/.test(flat) && /red/.test(flat)).toBe(true);
  });

  it("describes the alternate-screen viewport and its in-app scrolling", () => {
    const chat = read(CHAT);
    const viewport = read(path.join(here, "hooks", "useChatViewport.ts"));
    const scrollView = read(path.join(here, "components", "ScrollView.tsx"));
    const screen = read(path.join(here, "utils", "terminalScreen.ts"));
    const entry = read(path.join(here, "index.ts"));

    expect(/alternate screen/.test(flat)).toBe(/1049h/.test(screen));
    expect(/pinned to the bottom/.test(flat)).toBe(
      /height=\{rows\}/.test(chat),
    );
    expect(/useChatViewport/.test(chat)).toBe(true);
    expect(/measures the rendered transcript/.test(flat)).toBe(
      /measureElement/.test(scrollView),
    );
    expect(/mouse wheel/.test(flat)).toBe(/useMouseEvents/.test(viewport));
    expect(/move the transcript by whole rows/.test(flat)).toBe(
      /scrollTop/.test(viewport),
    );
    expect(/Jump to latest message/.test(flat)).toBe(
      /jumpToLatest/.test(read(path.join(here, "components", "Composer.tsx"))),
    );
    expect(/restored on every exit path/.test(flat)).toBe(
      /leaveAlternateScreen/.test(entry),
    );
  });

  it("keeps the intro out of the transcript once the conversation starts", () => {
    const transcript = read(TRANSCRIPT);

    expect(
      /only rendered while the conversation has no non-system message/.test(
        flat,
      ),
    ).toBe(/isEmptyConversation/.test(transcript));
    expect(/half-block wordmark/.test(flat)).toBe(
      /█/.test(read(path.join(here, "..", "startup", "asciiArt.ts"))) &&
        /MIN_WIDTH_FOR_ASCII_ART = 30/.test(
          read(path.join(here, "..", "startup", "asciiArt.ts")),
        ),
    );
    const banner = read(path.join(here, "components", "BrandBanner.tsx"));
    expect(/NO_COLOR/.test(flat)).toBe(/NO_COLOR/.test(banner));
  });

  it("describes the tool panels where they are built", () => {
    const group = read(path.join(here, "components", "ToolGroupDisplay.tsx"));

    expect(/rounded frame/.test(flat)).toBe(/borderStyle="round"/.test(group));
    expect(/border colour reports the state/.test(flat)).toBe(
      /borderColor/.test(group),
    );
    expect(/click to expand/.test(flat)).toBe(/click to expand/.test(group));
    expect(/folds itself/.test(flat)).toBe(/setExpanded\(false\)/.test(group));
    expect(/`✓` done/.test(flat)).toBe(/glyph: "✓"/.test(group));
  });

  it("describes the user and model prefixes where they are drawn", () => {
    const message = read(path.join(here, "components", "MemoizedMessage.tsx"));

    expect(/blue `>`/.test(flat)).toBe(/theme.user/.test(message));
    expect(/cyan `✦`/.test(flat)).toBe(
      /theme.accent/.test(message) && /✦/.test(message),
    );
    expect(/muted italic colour/.test(flat)).toBe(
      /<ThinkingMessage/.test(message),
    );
  });

  it("describes streaming, the spinner and the palette where they are built", () => {
    const chat = read(CHAT);
    const transcript = read(TRANSCRIPT);
    const helpers = read(path.join(here, "hooks", "useChat.stream.helpers.ts"));
    const palette = read(path.join(here, "SlashCommandUI.tsx"));
    const composer = read(path.join(here, "UserInput.tsx"));

    // The working indicator sits at the end of the transcript content, after
    // the newest row, and the transcript is above the dock.
    const spinnerInLiveFrame =
      transcript.indexOf("<QueuedMessages") <
        transcript.indexOf("<ActionStatus") &&
      chat.indexOf("<MainContent") < chat.indexOf("<Composer");
    expect(/working indicator renders after the live rows/.test(flat)).toBe(
      spinnerInLiveFrame,
    );
    expect(/throttled overlay/.test(flat)).toBe(
      /STREAM_RENDER_INTERVAL_MS/.test(helpers) && /streamingText/.test(chat),
    );
    expect(/at most five entries/.test(flat)).toBe(
      /MAX_VISIBLE_COMMANDS = 5/.test(palette),
    );
    expect(/never executes anything/.test(flat)).toBe(
      /slashCommandFilter !== ""/.test(composer),
    );
    // The palette's level model and its highlighted row are read from source.
    expect(/subcommands/.test(flat)).toBe(
      /subcommands\?: SlashSubcommand\[\]/.test(
        read(path.join(here, "commands", "types.ts")),
      ),
    );
    expect(/filled\s+background/.test(flat)).toBe(
      /backgroundColor=\{isSelected \? "#005f5f"/.test(palette),
    );
    expect(/-- \/language --/.test(flat)).toBe(
      /-- \$\{levelLabel\} --/.test(palette),
    );
  });

  it("claims no owner/repo line only while the component has none", () => {
    expect(REPO_LOOKUP.test(flat)).toBe(REPO_LOOKUP.test(status));
  });

  it("names the usage figures the status bar renders", () => {
    expect(/cacheHitRatio/.test(status)).toBe(/cache-hit ratio/.test(flat));
    expect(/t\("status\.output"\)/.test(status)).toBe(
      /output tokens/.test(flat),
    );
  });
});
