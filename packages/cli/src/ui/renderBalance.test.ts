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
  "src/ui/TUIChat.toolDisplay.test.tsx": 4,
  "src/ui/TUIChat.transcript.test.tsx": 1,
  "src/ui/ToolResultSummary.test.tsx": 1,
  "src/ui/UpdateNotification.test.tsx": 9,
  "src/ui/components/BottomStatusBarCtrlC.test.tsx": 8,
  "src/ui/components/ChecklistDisplay.test.tsx": 4,
  "src/ui/components/CompactionBoundary.test.tsx": 2,
  "src/ui/components/GoalIndicator.test.tsx": 2,
  "src/ui/components/MemoizedMessage.formatDisplay.test.tsx": 8,
  "src/ui/components/ModeIndicator.test.tsx": 6,
  "src/ui/components/SessionSelectorWithLoading.subagents.test.tsx": 1,
  "src/ui/components/SubagentBreadcrumb.test.tsx": 2,
  "src/ui/components/TUIChat.streamStopping.test.tsx": 2,
  "src/ui/hooks/useLocale.test.tsx": 1,
  "src/ui/utils/borderLine.test.ts": 3,
};

function uiTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...uiTestFiles(full));
    } else if (/.test.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function unmountedRenders(file: string): number {
  const source = fs.readFileSync(file, "utf-8");
  const renders = (source.match(/\brender\(/g) ?? []).length;
  const unmounts = (source.match(/\.unmount\(\)/g) ?? []).length;
  return renders - unmounts;
}

describe("the Ink trees the UI tests leave mounted", () => {
  it("adds no file that renders without unmounting", () => {
    const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

    const offenders = Object.entries(
      uiTestFiles(uiDir).reduce<Record<string, number>>((acc, file) => {
        const relative = path.relative(path.resolve(uiDir, "../.."), file),
          imbalance = unmountedRenders(file);
        if (imbalance > 0) {
          acc[relative] = imbalance;
        }
        return acc;
      }, {}),
    )
      .filter(
        ([relative, imbalance]) =>
          (KNOWN_UNMOUNTED_RENDERS[relative] ?? 0) < imbalance,
      )
      .map(([relative, imbalance]) => `${relative} ${imbalance}`);

    expect(offenders).toEqual([]);
  });

  it("keeps the frozen list down to the files that still overrender", () => {
    const uiDir = path.dirname(fileURLToPath(import.meta.url));
    const present = new Set(
      uiTestFiles(uiDir).map((file) =>
        path.relative(path.resolve(uiDir, "../.."), file),
      ),
    );

    expect(
      Object.keys(KNOWN_UNMOUNTED_RENDERS).filter(
        (relative) => !present.has(relative),
      ),
    ).toEqual([]);
  });
});
