import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  native: vi.fn(),
}));

vi.mock("./clipboardCommand.js", () => ({
  runClipboardCommand: mocks.run,
}));
vi.mock("./nativeClipboard.js", () => ({
  getNativeClipboardImage: mocks.native,
}));
vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

let clipboardImage: typeof import("./clipboardImage.js");
let clipboard: typeof import("./clipboard.js");

beforeEach(async () => {
  vi.resetModules();
  mocks.run.mockReset();
  mocks.native.mockReset();
  mocks.native.mockResolvedValue(undefined);
  clipboardImage = await import("./clipboardImage.js");
  clipboard = await import("./clipboard.js");
});

describe("clipboard image reads", () => {
  it("reads a Wayland image through wl-paste", async () => {
    mocks.run.mockImplementation(async (command: string, args: string[]) => {
      if (command !== "wl-paste") return undefined;
      if (args[0] === "--list-types") {
        return Buffer.from("text/plain\nimage/png\n");
      }
      if (args[0] === "--type") return png;
      return undefined;
    });

    const image = await clipboardImage.readClipboardImage({
      env: { WAYLAND_DISPLAY: "wayland-0" },
      platform: "linux",
    });

    expect(image).toEqual({ bytes: png, mimeType: "image/png" });
  });

  it("returns null when Wayland has only text on the clipboard", async () => {
    mocks.run.mockResolvedValue(Buffer.from("text/plain\n"));

    const image = await clipboardImage.readClipboardImage({
      env: { WAYLAND_DISPLAY: "wayland-0" },
      platform: "linux",
    });

    expect(image).toBeNull();
  });

  it("falls back to xclip when wl-paste is unavailable", async () => {
    mocks.run.mockImplementation(async (command: string, args: string[]) => {
      if (command === "wl-paste") return undefined;
      if (command === "xclip" && args.includes("TARGETS")) {
        return Buffer.from("image/jpeg\n");
      }
      if (command === "xclip" && args.includes("image/jpeg")) return jpeg;
      return undefined;
    });

    const image = await clipboardImage.readClipboardImage({
      env: { WAYLAND_DISPLAY: "wayland-0" },
      platform: "linux",
    });

    expect(image).toEqual({ bytes: jpeg, mimeType: "image/jpeg" });
  });

  it("falls back to the bundled X11 helper when no tools are installed", async () => {
    mocks.run.mockResolvedValue(undefined);
    mocks.native.mockResolvedValue(png);

    const image = await clipboardImage.readClipboardImage({
      env: { DISPLAY: ":1" },
      platform: "linux",
    });

    expect(image).toEqual({ bytes: png, mimeType: "image/png" });
  });

  it("rejects an image format the providers do not accept", async () => {
    mocks.run.mockResolvedValue(undefined);
    mocks.native.mockResolvedValue(Buffer.from("BM000000000000000000000000"));

    const image = await clipboardImage.readClipboardImage({
      env: { DISPLAY: ":1" },
      platform: "linux",
    });

    expect(image).toBeNull();
  });

  it("uses the native helper for the cheap status probe when tools are absent", async () => {
    mocks.run.mockResolvedValue(undefined);
    mocks.native.mockResolvedValue(png);

    await expect(
      clipboardImage.clipboardHasImage({
        env: { DISPLAY: ":1" },
        platform: "linux",
      }),
    ).resolves.toBe(true);
  });

  it("detects an image from the Wayland type list without reading its bytes", async () => {
    mocks.run.mockResolvedValue(Buffer.from("text/plain\nimage/webp\n"));

    await expect(
      clipboardImage.clipboardHasImage({
        env: { WAYLAND_DISPLAY: "wayland-0" },
        platform: "linux",
      }),
    ).resolves.toBe(true);
    expect(mocks.native).not.toHaveBeenCalled();
  });
});

// The two wrappers forward to the reader, so their contract is pinned in
// clipboardWrappers.test.ts, where the reader is replaced outright. Driving them
// from here ran the real backend selection, which chose wl-paste on a Wayland
// desktop and something else everywhere else.
