import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "test-fixtures"].includes(entry.name)) {
        sourceFiles(full, found);
      }
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function relative(file: string): string {
  return path.relative(srcRoot, file).split(path.sep).join("/");
}

describe("engine and surface boundaries", () => {
  const files = sourceFiles(srcRoot);

  it("lets only the controller and the summarizer import the stream loop", () => {
    const allowed = new Set([
      "session/controller.ts",
      "stream/summarizeWithEngine.ts",
    ]);
    const importers = files.filter((file) =>
      /from\s+["'][^"']*streamChatResponse\.js["']/.test(
        fs.readFileSync(file, "utf8"),
      ),
    );

    expect(importers.map(relative).sort()).toEqual([...allowed].sort());
  });

  it("keeps the UI out of the engine's loop module", () => {
    const offenders = files.filter((file) => {
      const name = relative(file);
      if (!name.startsWith("ui/")) {
        return false;
      }
      return /from\s+["'][^"']*streamChatResponse\.js["']/.test(
        fs.readFileSync(file, "utf8"),
      );
    });

    expect(offenders.map(relative)).toEqual([]);
  });

  it("keeps the engine out of the UI", () => {
    const offenders = files.filter((file) => {
      const name = relative(file);
      if (!name.startsWith("stream/") && !name.startsWith("loop/")) {
        return false;
      }
      return /from\s+["'][^"']*\/ui\//.test(fs.readFileSync(file, "utf8"));
    });

    expect(offenders.map(relative)).toEqual([]);
  });
});
