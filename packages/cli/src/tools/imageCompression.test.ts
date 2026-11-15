import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CommandRunner } from "./computerDriver.js";
import {
  compressScreenshot,
  DEFAULT_IMAGE_LIMITS,
  imageCompressionDeps,
  pngSize,
  type ImageLimits,
} from "./imageCompression.js";

function png(width: number, height: number, bytes = 24): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - 24))]);
}

function fakeRunner(options: { pngBytes?: number; jpegBytes?: number } = {}) {
  const calls: Array<{
    file: string;
    args: string[];
    input?: string | Buffer;
  }> = [];
  const run: CommandRunner["run"] = async (file, args, input) => {
    calls.push({ file, args, input });
    const at = args.indexOf("-resize");
    const [width, height] = args[at + 1].split("x").map(Number);
    const jpeg = args.includes("jpeg:-");
    return png(
      width,
      height,
      jpeg ? (options.jpegBytes ?? 300) : (options.pngBytes ?? 24),
    );
  };
  return { calls, run };
}

function limits(overrides: Partial<ImageLimits> = {}): ImageLimits {
  return { ...DEFAULT_IMAGE_LIMITS, ...overrides };
}

const previous = {
  runner: imageCompressionDeps.runner,
  hasCommand: imageCompressionDeps.hasCommand,
};

beforeEach(() => {
  imageCompressionDeps.hasCommand = () => true;
});

afterEach(() => {
  imageCompressionDeps.runner = previous.runner;
  imageCompressionDeps.hasCommand = previous.hasCommand;
});

describe("compressScreenshot", () => {
  it("leaves an image that already fits untouched", async () => {
    const commands = fakeRunner();
    imageCompressionDeps.runner = { run: commands.run };
    const image = png(1000, 800);

    const result = await compressScreenshot(image);

    expect(result).toMatchObject({
      width: 1000,
      height: 800,
      mimeType: "image/png",
      resized: false,
    });
    expect(result.buffer).toBe(image);
    expect(commands.calls).toEqual([]);
  });

  it("shrinks the longest edge and preserves the aspect ratio", async () => {
    const commands = fakeRunner();
    imageCompressionDeps.runner = { run: commands.run };

    const result = await compressScreenshot(
      png(400, 200),
      limits({ maxWidth: 200, maxHeight: 200 }),
    );

    expect(result).toMatchObject({
      width: 200,
      height: 100,
      mimeType: "image/png",
      resized: true,
    });
    expect(commands.calls[0]).toMatchObject({
      file: "magick",
      args: ["png:-", "-resize", "200x100", "png:-"],
    });
    expect(commands.calls[0].input).toBeDefined();
  });

  it("clamps the taller edge too", async () => {
    const commands = fakeRunner();
    imageCompressionDeps.runner = { run: commands.run };

    const result = await compressScreenshot(
      png(1000, 4000),
      limits({ maxWidth: 2000, maxHeight: 2000 }),
    );

    expect(result.width).toBe(500);
    expect(result.height).toBe(2000);
  });

  it("falls back to jpeg when the png is still over the payload cap", async () => {
    const commands = fakeRunner({ pngBytes: 900, jpegBytes: 300 });
    imageCompressionDeps.runner = { run: commands.run };

    const result = await compressScreenshot(
      png(400, 200),
      limits({ maxWidth: 200, maxBytes: 500 }),
    );

    expect(result).toMatchObject({
      mimeType: "image/jpeg",
      width: 200,
      height: 100,
      resized: true,
    });
    const jpegCall = commands.calls.find((call) =>
      call.args.includes("jpeg:-"),
    );
    expect(jpegCall?.args).toContain("-quality");
    expect(jpegCall?.args).toContain("80");
  });

  it("uses convert when magick is not installed", async () => {
    const commands = fakeRunner();
    imageCompressionDeps.runner = { run: commands.run };
    imageCompressionDeps.hasCommand = (name) => name === "convert";

    await compressScreenshot(
      png(400, 200),
      limits({ maxWidth: 200, maxHeight: 200 }),
    );

    expect(commands.calls[0].file).toBe("convert");
  });

  it("keeps a moderately large capture when no resizer is available", async () => {
    imageCompressionDeps.hasCommand = () => false;

    const result = await compressScreenshot(
      png(4000, 3000),
      limits({ maxWidth: 100 }),
    );

    expect(result).toMatchObject({ width: 4000, height: 3000, resized: false });
  });

  it("names the missing tool when the capture is too large to attach", async () => {
    imageCompressionDeps.hasCommand = () => false;
    const huge = png(4000, 3000, 7 * 1024 * 1024);

    await expect(
      compressScreenshot(huge, limits({ maxWidth: 100 })),
    ).rejects.toThrow(/ImageMagick/);
  });

  it("rejects bytes that are not a PNG", async () => {
    await expect(compressScreenshot(Buffer.alloc(30))).rejects.toThrow(/PNG/);
  });
});

describe("pngSize", () => {
  it("reads the IHDR dimensions", () => {
    expect(pngSize(png(1280, 720))).toEqual({ width: 1280, height: 720 });
  });
});
