import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { safeExtractTarball } from "./safeTarball.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-safe-tar-"));
  fs.mkdirSync(path.join(root, "source", "package"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function archive(entries: string[]): Promise<string> {
  const file = path.join(root, "archive.tgz");
  await tar.c({ file, cwd: path.join(root, "source"), gzip: true }, entries);
  return file;
}

describe("safeExtractTarball", () => {
  it("extracts ordinary npm package files", async () => {
    fs.writeFileSync(path.join(root, "source/package/file.txt"), "content");
    const file = await archive(["package"]);
    await safeExtractTarball(file, path.join(root, "target"));
    expect(
      fs.readFileSync(path.join(root, "target/package/file.txt"), "utf8"),
    ).toBe("content");
  });

  it("rejects symbolic links before writing any target files", async () => {
    fs.writeFileSync(path.join(root, "source/package/first.txt"), "content");
    fs.symlinkSync("../../outside", path.join(root, "source/package/link"));
    const file = await archive(["package"]);
    await expect(
      safeExtractTarball(file, path.join(root, "target")),
    ).rejects.toThrow(/entry type|link/i);
    expect(fs.existsSync(path.join(root, "target"))).toBe(false);
  });

  it("rejects hard links", async () => {
    fs.writeFileSync(path.join(root, "source/package/first.txt"), "content");
    fs.linkSync(
      path.join(root, "source/package/first.txt"),
      path.join(root, "source/package/second.txt"),
    );
    const file = await archive(["package"]);
    await expect(
      safeExtractTarball(file, path.join(root, "target")),
    ).rejects.toThrow(/entry type|link/i);
  });

  it("rejects files outside the package prefix", async () => {
    fs.writeFileSync(path.join(root, "source/outside.txt"), "content");
    const file = await archive(["outside.txt"]);
    await expect(
      safeExtractTarball(file, path.join(root, "target")),
    ).rejects.toThrow(/outside the package/i);
  });

  it("bounds uncompressed bytes before extraction", async () => {
    fs.writeFileSync(path.join(root, "source/package/file.txt"), "1234567890");
    const file = await archive(["package"]);
    await expect(
      safeExtractTarball(file, path.join(root, "target"), { maxBytes: 5 }),
    ).rejects.toThrow(/size limit/i);
    expect(fs.existsSync(path.join(root, "target"))).toBe(false);
  });

  it("bounds the number of entries", async () => {
    fs.writeFileSync(path.join(root, "source/package/file.txt"), "content");
    const file = await archive(["package"]);
    await expect(
      safeExtractTarball(file, path.join(root, "target"), { maxEntries: 1 }),
    ).rejects.toThrow(/entry limit/i);
  });

  it("refuses an existing destination symlink without changing its target", async () => {
    fs.writeFileSync(path.join(root, "source/package/file.txt"), "new");
    const file = await archive(["package"]);
    fs.mkdirSync(path.join(root, "outside"));
    fs.symlinkSync(
      path.join(root, "outside"),
      path.join(root, "target"),
      "dir",
    );
    await expect(
      safeExtractTarball(file, path.join(root, "target")),
    ).rejects.toThrow(/symbolic link/i);
    expect(fs.readdirSync(path.join(root, "outside"))).toEqual([]);
  });
});
