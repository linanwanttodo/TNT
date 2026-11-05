import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

/**
 * The inventory is derived, not remembered. A file is an external-text sink
 * when it both draws text and reads one of the fields that only ever carry
 * text from outside this process; a file that merely declares the field or
 * passes it along cannot put bytes on the screen.
 *
 * Adding a component that renders tool output lands in this list by itself and
 * fails until it sanitizes or hands the text to a component that does.
 */
const EXTERNAL_FIELDS = [
  "toolState.output",
  "preview.content",
  "diffContent",
  "message.content",
  "normalizeThoughtLines(",
];

/**
 * Files that hand the text to a component which sanitizes it, with the
 * component they must name. The excuse is re-checked every run, so it cannot
 * outlive the delegation.
 */
const DELEGATES_TO: Record<string, string> = {
  "DiffViewer.tsx": "ColoredDiff",
  "ToolResultSummary.tsx": "ColoredDiff",
  "components/ToolPermissionSelector.tsx": "ToolDiffView",
};

/**
 * Files sanitized beyond what the derived rule asks for, with what makes them
 * safe today. `ActionStatus` only ever receives translated constants, so the
 * scan cannot see it as a sink; the entry keeps the boundary from rotting
 * rather than letting it quietly become one.
 */
const HARDENED: Record<string, string> = {
  "components/ActionStatus.tsx": "every call site passes t()",
};

function uiFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return uiFiles(full, base);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [path.relative(base, full)];
  });
}

describe("terminal text safety coverage", () => {
  const files = uiFiles(__dirname);
  const sources = new Map(
    files.map((file) => [
      file,
      fs.readFileSync(path.join(__dirname, file), "utf8"),
    ]),
  );

  const sinks = files.filter((file) => {
    const source = sources.get(file)!;
    if (!source.includes("<Text")) return false;
    return EXTERNAL_FIELDS.some((field) => {
      const lines = source.split("\n").filter((line) => line.includes(field));
      // A file that only names the field in its props type and hands it to a
      // child draws nothing itself, so it cannot be the sink.
      return lines.some(
        (line) => !line.includes("props.") && !/^\s*\w+\??: string/.test(line),
      );
    });
  });

  it("finds more than a handful of sinks, so the scan is not vacuous", () => {
    expect(sinks.length).toBeGreaterThan(5);
  });

  it("sanitizes or delegates in every external-text sink", () => {
    const unprotected = sinks.filter((file) => {
      const source = sources.get(file)!;
      if (source.includes("sanitizeTerminalText(")) return false;
      const delegate = DELEGATES_TO[file];
      return !delegate || !source.includes(`<${delegate}`);
    });
    expect(unprotected).toEqual([]);
  });

  it("keeps every hardening entry real and unneeded", () => {
    for (const [file, reason] of Object.entries(HARDENED)) {
      const source = sources.get(file);
      expect(source, `${file} no longer exists`).toBeDefined();
      expect(
        source!.includes("sanitizeTerminalText("),
        `${file} no longer sanitizes (${reason})`,
      ).toBe(true);
      // An entry that became a real sink must move to the derived list, not
      // hide behind a hardening note.
      expect(sinks, `${file} is now a derived sink`).not.toContain(file);
    }
  });

  it("keeps every delegation excuse true", () => {
    for (const [file, delegate] of Object.entries(DELEGATES_TO)) {
      const source = sources.get(file);
      expect(source, `${file} no longer exists`).toBeDefined();
      expect(
        source!.includes(`<${delegate}`),
        `${file} renders no ${delegate}`,
      ).toBe(true);
      // A file that sanitizes on its own needs no excuse, and keeping the
      // entry anyway would hide the next field it reads unsanitized.
      expect(source!.includes("sanitizeTerminalText(")).toBe(false);
    }
  });
});
