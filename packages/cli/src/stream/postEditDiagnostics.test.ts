import * as path from "path";

import { describe, expect, it, vi } from "vitest";

import {
  collectPostEditDiagnostics,
  editedPaths,
  postEditDiagnostics,
} from "./postEditDiagnostics.js";

function diagnostic(line: number, message: string) {
  return {
    range: { start: { line, character: 4 } },
    severity: 1,
    source: "ts",
    message,
  };
}

function manager(options: {
  servers?: number;
  diagnostics?: Record<string, ReturnType<typeof diagnostic>[]>;
  failStart?: boolean;
}) {
  return {
    ensureStarted: vi.fn(async () => {
      if (options.failStart) {
        throw new Error("lsp failed");
      }
      return options.servers ?? 1;
    }),
    collectDiagnostics: vi.fn(
      async (filePath: string) => options.diagnostics?.[filePath] ?? [],
    ),
  };
}

describe("editedPaths", () => {
  it("reads the path each file-changing tool names", () => {
    expect(editedPaths("Write", { filepath: "src/a.ts" })).toEqual([
      "src/a.ts",
    ]);
    expect(editedPaths("Edit", { file_path: "src/b.ts" })).toEqual([
      "src/b.ts",
    ]);
    expect(editedPaths("MultiEdit", { file_path: "src/c.ts" })).toEqual([
      "src/c.ts",
    ]);
  });

  it("reads every path a patch names, once", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "+a",
      "*** Update File: src/b.ts",
      "+b",
      "*** End Patch",
    ].join("\n");

    expect(editedPaths("ApplyPatch", { patch })).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("returns nothing for a tool that does not change files", () => {
    expect(editedPaths("Read", { filepath: "src/a.ts" })).toEqual([]);
    expect(editedPaths("Bash", { command: "ls" })).toEqual([]);
    expect(editedPaths("Edit", undefined)).toEqual([]);
    expect(editedPaths("ApplyPatch", { patch: "not a patch" })).toEqual([]);
  });
});

describe("collectPostEditDiagnostics", () => {
  it("says nothing when no language server is configured", async () => {
    const fake = manager({ servers: 0 });

    expect(
      await collectPostEditDiagnostics(["src/a.ts"], fake, "/workspace"),
    ).toBeUndefined();
    expect(fake.collectDiagnostics).not.toHaveBeenCalled();
  });

  it("formats the diagnostics a server published", async () => {
    // The product resolves the edit against the root before asking the server, and on
    // Windows that is a drive-qualified path; key the fake the same way.
    const file = path.resolve("/workspace", "src/a.ts");
    const fake = manager({
      diagnostics: { [file]: [diagnostic(2, "Type error")] },
    });

    const text = await collectPostEditDiagnostics(
      ["src/a.ts"],
      fake,
      "/workspace",
    );

    expect(text).toContain("Diagnostics after this edit (1):");
    expect(text).toContain("src/a.ts:3:5 error [ts]: Type error");
  });

  it("says nothing when the files are clean", async () => {
    const fake = manager({});

    expect(
      await collectPostEditDiagnostics(["src/a.ts"], fake, "/workspace"),
    ).toBeUndefined();
  });

  it("does not let a broken server fail the edit", async () => {
    const fake = manager({ failStart: true });

    expect(
      await collectPostEditDiagnostics(["src/a.ts"], fake, "/workspace"),
    ).toBeUndefined();
  });

  it("checks at most three files", async () => {
    const fake = manager({});
    const paths = ["a", "b", "c", "d"].map((name) => `src/${name}.ts`);

    await collectPostEditDiagnostics(paths, fake, "/workspace");

    expect(fake.collectDiagnostics).toHaveBeenCalledTimes(3);
  });

  it("caps the number of lines it returns", async () => {
    // The product resolves the edit against the root before asking the server, and on
    // Windows that is a drive-qualified path; key the fake the same way.
    const file = path.resolve("/workspace", "src/a.ts");
    const many = Array.from({ length: 30 }, (_, index) =>
      diagnostic(index, `problem ${index}`),
    );
    const fake = manager({ diagnostics: { [file]: many } });

    const text = await collectPostEditDiagnostics(
      ["src/a.ts"],
      fake,
      "/workspace",
    );

    expect(text?.match(/src\/a\.ts:/g)).toHaveLength(20);
  });
});

describe("postEditDiagnostics", () => {
  it("does not start a server for a tool that changes no file", async () => {
    await expect(
      postEditDiagnostics("Read", { filepath: "a.ts" }),
    ).resolves.toBeUndefined();
  });
});
