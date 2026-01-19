import * as fs from "fs";
import * as path from "path";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

import { isWithinWorkspace } from "../permissions/workspacePath.js";

import type {
  ComputerBackend,
  MouseButton,
  Point,
  ScrollDirection,
} from "./computerDriver.js";
import { detectComputerBackend } from "./computerDriver.js";
import {
  compressScreenshot,
  pngSize,
  type CompressedImage,
} from "./imageCompression.js";
import { Tool, ToolRunResult } from "./types.js";

const MAX_WAIT_MS = 10_000;
const MAX_TYPE_CHARS = 20_000;
const MAX_SCROLL_STEPS = 50;

export type ComputerAction =
  | "screenshot"
  | "cursor_position"
  | "move"
  | "click"
  | "drag"
  | "type"
  | "keypress"
  | "scroll"
  | "wait";

export interface ComputerArgs {
  action: ComputerAction;
  x?: number;
  y?: number;
  to_x?: number;
  to_y?: number;
  button?: MouseButton;
  count?: number;
  text?: string;
  keys?: string;
  direction?: ScrollDirection;
  amount?: number;
  ms?: number;
  filepath?: string;
}

/**
 * The backend is resolved per call so tests can substitute one and so a user
 * who installs a missing binary does not have to restart the session.
 */
export const computerDeps: {
  backend: () => ComputerBackend;
  compress: (buffer: Buffer) => Promise<CompressedImage>;
} = {
  backend: () => detectComputerBackend(),
  compress: (buffer) => compressScreenshot(buffer),
};

let lastScreen:
  | {
      native: { width: number; height: number };
      view: { width: number; height: number };
    }
  | undefined;

/** Test seam: the remembered screen bounds belong to one process. */
export function resetComputerScreen(): void {
  lastScreen = undefined;
}

function numberArg(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Computer ${name} must be a number.`,
    );
  }
  return Math.round(value);
}

function pointArg(
  args: ComputerArgs,
  xKey: "x" | "to_x",
  yKey: "y" | "to_y",
): Point {
  const point = {
    x: numberArg(args[xKey], xKey),
    y: numberArg(args[yKey], yKey),
  };
  assertOnScreen(point);
  return point;
}

/**
 * The last screenshot is the coordinate space the model was shown. Rejecting
 * a point outside it turns a mis-scaled guess into a retry instead of a click
 * on whatever happens to be at that pixel.
 */
function assertOnScreen(point: Point): void {
  if (point.x < 0 || point.y < 0) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Point ${point.x},${point.y} is outside the screen.`,
    );
  }
  if (!lastScreen) {
    return;
  }
  if (point.x >= lastScreen.view.width || point.y >= lastScreen.view.height) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Point ${point.x},${point.y} is outside the last screenshot (${lastScreen.view.width}x${lastScreen.view.height}). Take a new screenshot if the screen changed.`,
    );
  }
}

/**
 * Coordinates are the ones the model saw. A compressed capture is smaller than
 * the desktop, so the click is mapped back to native pixels here rather than
 * asking the model to do the arithmetic.
 */
function toNative(point: Point): Point {
  if (!lastScreen) {
    return point;
  }
  const { native, view } = lastScreen;
  return {
    x: Math.min(
      native.width - 1,
      Math.round((point.x * native.width) / view.width),
    ),
    y: Math.min(
      native.height - 1,
      Math.round((point.y * native.height) / view.height),
    ),
  };
}

function buttonArg(value: unknown): MouseButton {
  if (value === undefined) {
    return "left";
  }
  if (value === "left" || value === "right" || value === "middle") {
    return value;
  }
  throw new ContinueError(
    ContinueErrorReason.Unspecified,
    'Computer button must be "left", "right" or "middle".',
  );
}

function countArg(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  const count = numberArg(value, "count");
  if (count < 1 || count > 3) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "Computer count must be between 1 and 3.",
    );
  }
  return count;
}

function textArg(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "Computer text must be a non-empty string.",
    );
  }
  if (value.length > MAX_TYPE_CHARS) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Computer text may be at most ${MAX_TYPE_CHARS} characters.`,
    );
  }
  return value;
}

function directionArg(value: unknown): ScrollDirection {
  if (
    value === "up" ||
    value === "down" ||
    value === "left" ||
    value === "right"
  ) {
    return value;
  }
  throw new ContinueError(
    ContinueErrorReason.Unspecified,
    'Computer direction must be "up", "down", "left" or "right".',
  );
}

function scrollAmountArg(value: unknown): number {
  if (value === undefined) {
    return 3;
  }
  const amount = numberArg(value, "amount");
  if (amount < 1 || amount > MAX_SCROLL_STEPS) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Computer amount must be between 1 and ${MAX_SCROLL_STEPS}.`,
    );
  }
  return amount;
}

function waitArg(value: unknown): number {
  if (value === undefined) {
    return 1_000;
  }
  const ms = numberArg(value, "ms");
  if (ms < 0 || ms > MAX_WAIT_MS) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Computer ms must be between 0 and ${MAX_WAIT_MS}.`,
    );
  }
  return ms;
}

/**
 * The capture is attached to the conversation; writing a file is an explicit
 * extra. A path the model has to read back would be a second round trip for an
 * image it is already looking at.
 */
function saveScreenshot(buffer: Buffer, filepath?: string): string | undefined {
  if (!filepath) {
    return undefined;
  }
  const absolute = path.resolve(filepath);
  if (!isWithinWorkspace(absolute)) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `Screenshots must be written inside the workspace: ${filepath}`,
    );
  }
  if (!absolute.toLowerCase().endsWith(".png")) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "A screenshot filepath must end in .png.",
    );
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, buffer);
  return path.relative(process.cwd(), absolute) || absolute;
}

async function runAction(args: ComputerArgs): Promise<ToolRunResult> {
  const backend = computerDeps.backend();

  switch (args.action) {
    case "screenshot": {
      const captured = await backend.capture();
      const native = pngSize(captured);
      const image = await computerDeps.compress(captured);
      const view = { width: image.width, height: image.height };
      lastScreen = { native, view };
      const saved = saveScreenshot(image.buffer, args.filepath);
      const scaled =
        view.width !== native.width || view.height !== native.height;
      return {
        content: `Captured the desktop at ${native.width}x${native.height}.${
          scaled
            ? ` Displayed at ${view.width}x${view.height}; coordinates are in the displayed image.`
            : ""
        }${saved ? ` Saved to ${saved}.` : ""}`,
        images: [
          { mimeType: image.mimeType, data: image.buffer.toString("base64") },
        ],
      };
    }
    case "cursor_position": {
      const point = await backend.cursorPosition();
      return `The pointer is at (${point.x}, ${point.y}).`;
    }
    case "move": {
      const point = toNative(pointArg(args, "x", "y"));
      await backend.move(point);
      return `Moved the pointer to (${point.x}, ${point.y}).`;
    }
    case "click": {
      const point = toNative(pointArg(args, "x", "y"));
      const button = buttonArg(args.button);
      const count = countArg(args.count);
      await backend.click(point, button, count);
      return `Clicked ${button} ${count === 1 ? "once" : `${count} times`} at (${point.x}, ${point.y}).`;
    }
    case "drag": {
      const from = toNative(pointArg(args, "x", "y"));
      const to = toNative(pointArg(args, "to_x", "to_y"));
      const button = buttonArg(args.button);
      await backend.drag(from, to, button);
      return `Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y}) with the ${button} button.`;
    }
    case "type": {
      const text = textArg(args.text);
      await backend.type(text);
      return `Typed ${text.length} character(s).`;
    }
    case "keypress": {
      const keys = textArg(args.keys);
      await backend.key(keys);
      return `Pressed ${keys}.`;
    }
    case "scroll": {
      const direction = directionArg(args.direction);
      const amount = scrollAmountArg(args.amount);
      const at =
        args.x !== undefined && args.y !== undefined
          ? toNative(pointArg(args, "x", "y"))
          : undefined;
      await backend.scroll(direction, amount, at);
      return `Scrolled ${direction} ${amount} step(s)${at ? ` at (${at.x}, ${at.y})` : ""}.`;
    }
    case "wait": {
      const ms = waitArg(args.ms);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `Waited ${ms} ms.`;
    }
    default:
      throw new ContinueError(
        ContinueErrorReason.Unspecified,
        `Unknown computer action: ${String(args.action)}.`,
      );
  }
}

export const computerTool: Tool = {
  name: "Computer",
  displayName: "Computer",
  description: `Control the user's visible desktop: capture the screen, move the pointer, click, drag, type, press keys, scroll, and wait. Coordinates are pixels in the most recent screenshot, so take a screenshot before the first click and after the screen changes.
The screen is the user's real session; this tool never starts a hidden desktop. Linux needs xdotool for input and grim (Wayland) or ImageMagick's import (X11) for capture; macOS needs cliclick; Windows desktop control is not implemented.
Screenshots are attached to the conversation as an image, like a pasted one; an optional workspace filepath also writes a .png copy.`,
  parameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: [
          "screenshot",
          "cursor_position",
          "move",
          "click",
          "drag",
          "type",
          "keypress",
          "scroll",
          "wait",
        ],
        description:
          "screenshot, cursor_position, move, click, drag, type, keypress, scroll or wait",
      },
      x: { type: "number", description: "Pointer x in screenshot pixels" },
      y: { type: "number", description: "Pointer y in screenshot pixels" },
      to_x: { type: "number", description: "Drag destination x" },
      to_y: { type: "number", description: "Drag destination y" },
      button: {
        type: "string",
        enum: ["left", "right", "middle"],
        description: "Mouse button, default left",
      },
      count: {
        type: "number",
        description: "Click count, 1 to 3; default 1",
      },
      text: { type: "string", description: "Text to type" },
      keys: {
        type: "string",
        description: 'Key combination such as "ctrl+shift+t" or "Return"',
      },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Scroll direction",
      },
      amount: {
        type: "number",
        description: "Scroll steps, 1 to 50; default 3",
      },
      ms: {
        type: "number",
        description: "Wait time in milliseconds, capped at 10000",
      },
      filepath: {
        type: "string",
        description:
          "Optional workspace .png path for the screenshot; defaults to a temp file",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  run: (args: ComputerArgs) => runAction(args),
};
