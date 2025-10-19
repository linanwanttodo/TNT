import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * Every test that renders an Ink tree and never unmounts it leaves the tree's
 * subscribers attached to the singleton service container, and the container
 * tolerates 50 handlers per event before it warns. That is why the suite has
 * been printing `51 toolPermissions:loading listeners added to
 * [ServiceContainer]` in every gate run: the accumulation is real, but it is
 * test hygiene, not a product leak, and a warning that fires for the wrong
 * reason is a warning nobody reads.
 *
 * These numbers are the balance of `render(` against `.unmount()` per file,
 * counted as text. A stray mention of either in a comment shifts a file's
 * allowance, which only ever makes that file's ceiling looser - so the guard
 * cannot fail on its own arithmetic, and translating this debt away one file
 * at a time never turns it red.
 */
const KNOWN_UNMOUNTED_RENDERS: Record<string, number> = {
  "src/ui/ColoredDiff.test.ts": 11,
  "src/test-utils/renderWithServices.tsx": 1,
  "src/ui/CtrlC.test.tsx": 4,
  "src/ui/CtrlCInputClearing.test.tsx": 2,
  "src/ui/EditMessageSelector.test.tsx": 8,
  "src/ui/IntroMessage.test.tsx": 6,
  "src/ui/MCPSelector.locale.test.tsx": 2,
  "src/ui/MarkdownRenderer.thinking.test.tsx": 3,
  "src/ui/SessionSelector.test.tsx": 3,
  "src/ui/SlashCommandUI.locale.test.tsx": 1,
  "src/ui/TUIChat.actionStatus.test.tsx": 4,
  "src/ui/TUIChat.basic.test.tsx": 4,
  "src/ui/TUIChat.compactionCancellation.test.tsx": 3,
  "src/ui/TUIChat.interruption.minimal.test.tsx": 5,
  "src/ui/TUIChat.layout.test.tsx": 1,
  "src/ui/TUIChat.planModeBug.test.tsx": 3,
  "src/ui/TUIChat.transcript.test.tsx": 1,
  "src/ui/ToolResultSummary.test.tsx": 1,
  "src/ui/UpdateNotification.test.tsx": 9,
  "src/ui/components/ChecklistDisplay.test.tsx": 4,
  "src/ui/components/CompactionBoundary.test.tsx": 2,
  "src/ui/components/GoalIndicator.test.tsx": 2,
  "src/ui/components/MemoizedMessage.formatDisplay.test.tsx": 8,
  "src/ui/components/SessionSelectorWithLoading.subagents.test.tsx": 1,
  "src/ui/components/SubagentBreadcrumb.test.tsx": 2,
  "src/ui/components/TUIChat.streamStopping.test.tsx": 2,
  "src/ui/hooks/useLocale.test.tsx": 1,
  "src/ui/utils/borderLine.test.ts": 3,
};

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * A mount does not have to sit in a test file to be debt: the whole suite's
 * accumulation lived in `src/test-utils/TUIChat.dualModeHelper.tsx`, and a scan
 * limited to `src/ui/*.test.tsx` could not see it. Both trees are checked, with
 * keys produced by the single expression below so the table and the assertions
 * can never disagree about what a path looks like.
 *
 * Two limits of counting text, both measured rather than assumed. A pass-through
 * helper that hands the tree back to its caller (renderWithServices returns
 * unmount inside its result) reads as one mount never released even though its
 * consumers print no MaxListeners warning at all, so its row is an allowance, not
 * a proven leak. And a wrapper is invisible on the other side: a caller of
 * renderWithServices matches neither pattern, so its own mount is counted only
 * where the real render call sits.
 */
const SCAN_TARGETS = [
  { dir: "src/ui", testFilesOnly: true },
  { dir: "src/test-utils", testFilesOnly: false },
];

function scannedFiles(dir: string, testFilesOnly: boolean): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__mocks__") {
        found.push(...scannedFiles(full, testFilesOnly));
      }
    } else if (
      /\.tsx?$/.test(entry.name) &&
      (!testFilesOnly || /\.test\.tsx?$/.test(entry.name))
    ) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Renders counted against the calls that give them back, per file. A stray
 * mention of either in a comment shifts that file's allowance and can only make
 * its ceiling looser, so this cannot fail on its own arithmetic.
 */
function unmountedRenders(): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const target of SCAN_TARGETS) {
    for (const file of scannedFiles(
      path.join(PACKAGE_ROOT, target.dir),
      target.testFilesOnly,
    )) {
      const source = fs.readFileSync(file, "utf-8");
      const imbalance =
        (source.match(/\brender\(/g) ?? []).length -
        (source.match(/\.unmount\(\)/g) ?? []).length;
      if (imbalance > 0) {
        counts[path.relative(PACKAGE_ROOT, file).split(path.sep).join("/")] =
          imbalance;
      }
    }
  }

  return counts;
}

describe("the Ink trees the UI tests leave mounted", () => {
  it("adds no file that renders without unmounting", () => {
    const offenders = Object.entries(unmountedRenders())
      .filter(
        ([relative, imbalance]) =>
          (KNOWN_UNMOUNTED_RENDERS[relative] ?? 0) < imbalance,
      )
      .map(([relative, imbalance]) => `${relative} ${imbalance}`);

    expect(offenders).toEqual([]);
  });

  it("keeps the frozen list down to the files that still overrender", () => {
    const present = unmountedRenders();

    expect(
      Object.keys(KNOWN_UNMOUNTED_RENDERS).filter(
        (relative) => !(relative in present),
      ),
    ).toEqual([]);
  });
});
