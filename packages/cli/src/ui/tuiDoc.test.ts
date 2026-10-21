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
    const colours = /currentMode === "plan" \? "blue" : "green"/.test(mode);
    expect(colours).toBe(true);
    expect(/\[plan\]/.test(flat)).toBe(true);
    expect(/\[auto\]/.test(flat)).toBe(true);
    expect(/blue/.test(flat) && /green/.test(flat)).toBe(true);
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
