import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computerDeps,
  computerTool,
  resetComputerScreen,
  type ComputerArgs,
} from "./computer.js";
import { pngSize } from "./imageCompression.js";

function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function fakeBackend(image: Buffer = png(800, 600)) {
  return {
    platform: "test",
    capture: vi.fn(async () => image),
    move: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    drag: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    key: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    cursorPosition: vi.fn(async () => ({ x: 5, y: 6 })),
  };
}

let backend: ReturnType<typeof fakeBackend>;
const previousBackend = computerDeps.backend;
const previousCompress = computerDeps.compress;

beforeEach(() => {
  resetComputerScreen();
  backend = fakeBackend();
  computerDeps.backend = () => backend as any;
  computerDeps.compress = async (buffer) => {
    const size = pngSize(buffer);
    return {
      buffer,
      mimeType: "image/png",
      ...size,
      resized: false,
    };
  };
});

afterEach(() => {
  computerDeps.backend = previousBackend;
  computerDeps.compress = previousCompress;
});

async function run(args: Partial<ComputerArgs>) {
  return computerTool.run!({ action: "screenshot", ...args } as ComputerArgs);
}

describe("Computer screenshot", () => {
  it("returns the capture as an image attached to the conversation", async () => {
    const image = png(1920, 1080);
    backend = fakeBackend(image);
    computerDeps.backend = () => backend as any;

    const result = await run({ action: "screenshot" });

    expect(typeof result).toBe("object");
    if (typeof result === "string") {
      return;
    }
    // The image itself is the deliverable; no file path is required to read it.
    expect(result.content).toBe("Captured the desktop at 1920x1080.");
    expect(result.images).toEqual([
      { mimeType: "image/png", data: image.toString("base64") },
    ]);
  });

  it("maps displayed coordinates back to the native desktop", async () => {
    const captured = png(3200, 2400);
    backend = fakeBackend(captured);
    computerDeps.backend = () => backend as any;
    computerDeps.compress = async () => ({
      buffer: png(1600, 1200),
      mimeType: "image/png",
      width: 1600,
      height: 1200,
      resized: true,
    });

    const result = await run({ action: "screenshot" });
    expect(typeof result).toBe("object");
    if (typeof result !== "string") {
      expect(result.content).toContain("Captured the desktop at 3200x2400.");
      expect(result.content).toContain("Displayed at 1600x1200");
    }

    await run({ action: "click", x: 800, y: 600 });
    expect(backend.click).toHaveBeenCalledWith({ x: 1600, y: 1200 }, "left", 1);

    await expect(run({ action: "click", x: 1600, y: 10 })).rejects.toThrow(
      /outside the last screenshot \(1600x1200\)/,
    );
  });

  it("refuses a capture that is not a PNG", async () => {
    backend = fakeBackend(Buffer.from("not a png"));
    computerDeps.backend = () => backend as any;

    await expect(run({ action: "screenshot" })).rejects.toThrow(/PNG/);
  });

  it("writes a requested workspace path and refuses one outside it", async () => {
    const target = path.join(process.cwd(), `.tmp-computer-${Date.now()}.png`);
    const result = await run({ action: "screenshot", filepath: target });
    expect(typeof result).toBe("object");
    expect(fs.existsSync(target)).toBe(true);
    fs.rmSync(target, { force: true });

    await expect(
      run({ action: "screenshot", filepath: path.join(os.tmpdir(), "x.png") }),
    ).rejects.toThrow(/inside the workspace/);
  });
});

describe("Computer input", () => {
  it("validates coordinates against the last screenshot", async () => {
    await run({ action: "screenshot" });

    await expect(run({ action: "click", x: 10, y: 20 })).resolves.toContain(
      "Clicked left once at (10, 20).",
    );
    expect(backend.click).toHaveBeenCalledWith({ x: 10, y: 20 }, "left", 1);

    await expect(run({ action: "click", x: 900, y: 20 })).rejects.toThrow(
      /outside the last screenshot \(800x600\)/,
    );
    await expect(run({ action: "click", x: -1, y: 0 })).rejects.toThrow(
      /outside the screen/,
    );
  });

  it("passes the button and click count through", async () => {
    await expect(
      run({ action: "click", x: 1, y: 2, button: "right", count: 2 }),
    ).resolves.toContain("Clicked right 2 times");
    expect(backend.click).toHaveBeenCalledWith({ x: 1, y: 2 }, "right", 2);
  });

  it("moves, drags and reads the pointer", async () => {
    await expect(run({ action: "move", x: 3, y: 4 })).resolves.toContain(
      "(3, 4)",
    );
    await expect(
      run({ action: "drag", x: 1, y: 2, to_x: 30, to_y: 40 }),
    ).resolves.toContain("Dragged from (1, 2) to (30, 40)");
    await expect(run({ action: "cursor_position" })).resolves.toContain(
      "(5, 6)",
    );

    expect(backend.drag).toHaveBeenCalledWith(
      { x: 1, y: 2 },
      { x: 30, y: 40 },
      "left",
    );
  });

  it("types text and presses a key combination", async () => {
    await expect(run({ action: "type", text: "hello" })).resolves.toContain(
      "Typed 5 character(s)",
    );
    await expect(
      run({ action: "keypress", keys: "ctrl+t" }),
    ).resolves.toContain("Pressed ctrl+t");

    expect(backend.type).toHaveBeenCalledWith("hello");
    expect(backend.key).toHaveBeenCalledWith("ctrl+t");
  });

  it("scrolls by the requested direction and amount", async () => {
    await expect(
      run({ action: "scroll", direction: "down", amount: 5, x: 2, y: 3 }),
    ).resolves.toContain("Scrolled down 5 step(s) at (2, 3)");
    expect(backend.scroll).toHaveBeenCalledWith("down", 5, { x: 2, y: 3 });
  });

  it("waits without calling the desktop backend", async () => {
    await expect(run({ action: "wait", ms: 0 })).resolves.toBe("Waited 0 ms.");
    expect(backend.capture).not.toHaveBeenCalled();
  });
});

describe("Computer argument checks", () => {
  it("rejects unknown actions and bad arguments", async () => {
    await expect(run({ action: "fly" as any })).rejects.toThrow(
      /Unknown computer action/,
    );
    await expect(run({ action: "click", x: 1 })).rejects.toThrow(
      /must be a number/,
    );
    await expect(
      run({ action: "click", x: 1, y: 2, button: "back" as any }),
    ).rejects.toThrow(/button must be/);
    await expect(
      run({ action: "click", x: 1, y: 2, count: 4 }),
    ).rejects.toThrow(/between 1 and 3/);
    await expect(run({ action: "type", text: "" })).rejects.toThrow(
      /non-empty/,
    );
    await expect(
      run({ action: "scroll", direction: "sideways" as any }),
    ).rejects.toThrow(/direction must be/);
    await expect(
      run({ action: "scroll", direction: "down", amount: 99 }),
    ).rejects.toThrow(/between 1 and 50/);
    await expect(run({ action: "wait", ms: 20_000 })).rejects.toThrow(
      /between 0 and 10000/,
    );
  });

  it("reads dimensions only from a real PNG header", () => {
    expect(pngSize(png(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(() => pngSize(Buffer.alloc(30))).toThrow(/PNG/);
  });
});
