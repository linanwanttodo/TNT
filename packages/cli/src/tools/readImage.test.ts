import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFileTool } from "./readFile.js";

let dir: string;

function png(width = 1, height = 1): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-read-image-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Read on an image", () => {
  it("returns the bytes as image content instead of text", async () => {
    const file = path.join(dir, "shot.png");
    const bytes = png(800, 600);
    fs.writeFileSync(file, bytes);

    const result = await readFileTool.run!({ filepath: file });

    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.images).toEqual([
      { mimeType: "image/png", data: bytes.toString("base64") },
    ]);
    expect(result.content).toContain("image/png");
  });

  it("refuses an image too large for an inline request", async () => {
    const file = path.join(dir, "huge.png");
    fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024 + 1));

    const result = await readFileTool.run!({ filepath: file });

    expect(typeof result).toBe("string");
    expect(result).toContain("too large");
    expect(result).toContain("3 MB");
  });

  it("keeps text files as text", async () => {
    const file = path.join(dir, "note.txt");
    fs.writeFileSync(file, "hello\n");

    const result = await readFileTool.run!({ filepath: file });

    expect(typeof result).toBe("string");
  });
});
