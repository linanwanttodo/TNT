import { describe, expect, it, vi } from "vitest";

/**
 * `clipboard.ts` is the compatibility shim: one function forwards to the probe,
 * the other unwraps the reader's bytes. That mapping is the whole contract, and
 * it is the only thing here worth asserting - which is why the reader behind it
 * is replaced rather than driven through a real backend.
 *
 * The pair used to live in clipboard.test.ts, mocked at the command-runner
 * boundary while the real backend selection still ran. On a Wayland desktop that
 * selection lands on wl-paste, so the mock answered; on a machine with no
 * display - every CI operating system - it lands elsewhere, the mock never
 * matched, and the same assertion read as a product failure.
 */
const reader = vi.hoisted(() => ({
  readClipboardImage: vi.fn(),
  clipboardHasImage: vi.fn(),
}));

vi.mock("./clipboardImage.js", () => reader);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("the clipboard compatibility wrappers", () => {
  it("returns the reader's bytes", async () => {
    reader.readClipboardImage.mockResolvedValue({
      bytes: png,
      mimeType: "image/png",
    });
    const { getClipboardImage } = await import("./clipboard.js");

    await expect(getClipboardImage()).resolves.toEqual(png);
    expect(reader.readClipboardImage).toHaveBeenCalledTimes(1);
  });

  it("returns null when the reader finds nothing", async () => {
    reader.readClipboardImage.mockResolvedValue(null);
    const { getClipboardImage } = await import("./clipboard.js");

    await expect(getClipboardImage()).resolves.toBeNull();
  });

  it("forwards the probe's answer unchanged", async () => {
    reader.clipboardHasImage.mockResolvedValue(true);
    const { checkClipboardForImage } = await import("./clipboard.js");

    await expect(checkClipboardForImage()).resolves.toBe(true);
  });
});
