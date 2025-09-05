import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { ContextItemWithId } from "core/index.js";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { changedSinceSeen } from "../tools/fileState.js";

import { expandMentions } from "./atMentions.js";

let dir: string;

function makeFile(relative: string, content: string): string {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/** Everything except the block that reports what could not be attached. */
function attached(result: { contextItems: ContextItemWithId[] }) {
  return result.contextItems.filter(
    (item) => item.name !== "unattached mentions",
  );
}

beforeEach(() => {
  dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "tnt-mentions-")),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("expandMentions", () => {
  it("attaches a mentioned file and records it as read", () => {
    const file = makeFile("src/a.ts", "export const a = 1;\n");

    const result = expandMentions("explain @src/a.ts quickly", dir);

    expect(attached(result)).toHaveLength(1);
    expect(result.contextItems[0]?.name).toBe("src/a.ts");
    expect(result.contextItems[0]?.content).toBe("export const a = 1;\n");
    expect(result.notes).toEqual([]);

    // The mention stands in for Read, so the file is known - and a later change
    // to it is still detectable.
    expect(changedSinceSeen(file)).toBe(false);
    fs.writeFileSync(file, "export const a = 222;\n");
    expect(changedSinceSeen(file)).toBe(true);
  });

  it("honours a line range", () => {
    makeFile("big.ts", ["l1", "l2", "l3", "l4"].join("\n"));

    const result = expandMentions("look at @big.ts:2-3", dir);

    expect(result.contextItems[0]?.name).toBe("big.ts:2-3");
    expect(result.contextItems[0]?.content).toBe("l2\nl3");
  });

  it("attaches a directory as a listing", () => {
    makeFile("pkg/one.ts", "1\n");
    makeFile("pkg/two.ts", "2\n");

    const result = expandMentions("@pkg/ where is it", dir);

    expect(result.contextItems[0]?.name).toBe("pkg/");
    expect(result.contextItems[0]?.content).toBe("one.ts\ntwo.ts");
  });

  it("keeps prose punctuation out of the path", () => {
    makeFile("note.md", "hello\n");

    const result = expandMentions("read @note.md.", dir);

    expect(result.notes).toEqual([]);
    expect(result.contextItems[0]?.name).toBe("note.md");
  });

  it("reports what it could not attach without editing what the user typed", () => {
    makeFile("real.ts", "ok\n");
    const prompt = "compare @real.ts with @missing.ts";

    const result = expandMentions(prompt, dir);

    expect(attached(result).map((item) => item.name)).toEqual(["real.ts"]);
    expect(result.notes[0]).toContain("@missing.ts");
    expect(result.notes[0]).toContain("not found");
    const report = result.contextItems.find(
      (item) => item.name === "unattached mentions",
    );
    expect(report?.content).toContain("@missing.ts");
  });

  it("refuses a binary file", () => {
    makeFile("blob.bin", "\u0000\u0001binary");

    const result = expandMentions("@blob.bin", dir);

    expect(attached(result)).toEqual([]);
    expect(result.notes[0]).toContain("binary file");
  });

  it("truncates a long file and says so", () => {
    makeFile(
      "long.ts",
      Array.from({ length: 2_500 }, (_, i) => `l${i}`).join("\n"),
    );

    const result = expandMentions("@long.ts", dir);

    expect(result.contextItems[0]?.description).toContain(
      "first 2000 of 2500 lines",
    );
    expect(result.contextItems[0]?.content.split("\n")).toHaveLength(2_000);
  });

  it("caps how much one prompt can pull in", () => {
    for (let i = 0; i < 10; i++) {
      makeFile(`f${i}.ts`, `export const n = ${i};\n`);
    }
    const prompt = Array.from({ length: 10 }, (_, i) => `@f${i}.ts`).join(" ");

    const result = expandMentions(prompt, dir);

    expect(attached(result)).toHaveLength(8);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toContain("more than 8 mentions");
  });

  it("spends one shared budget across the prompt", () => {
    const big = "x".repeat(130_000);
    for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      makeFile(name, big);
    }

    const result = expandMentions("@a.ts @b.ts @c.ts @d.ts", dir);

    const contents = attached(result).map((item) => item.content.length);
    expect(contents).toEqual([100_000, 100_000, 50_000]);
    expect(attached(result)[2]?.description).toContain(
      "cut at the 250,000-character budget",
    );
    expect(result.notes[0]).toContain("already fills 250,000 characters");
  });

  it("does not attach twice what the interface already attached", () => {
    const picked = makeFile("picked.ts", "const picked = 1;\n");
    const already: ContextItemWithId[] = [
      {
        id: { providerTitle: "file", itemId: picked },
        name: "picked.ts",
        description: "attached in the UI",
        content: "const picked = 1;\n",
        uri: { type: "file", value: `file://${picked}` },
      },
    ];

    const result = expandMentions("what about @picked.ts", dir, already);

    expect(result.contextItems).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("does not treat an address or an email as a path", () => {
    const result = expandMentions("ssh user@host and git@github.com:x/y", dir);

    expect(result.contextItems).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});
