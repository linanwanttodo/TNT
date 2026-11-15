import { TntError, TntErrorReason } from "core/util/errors.js";

import {
  commandExists,
  execRunner,
  type CommandRunner,
} from "./computerDriver.js";

/** The defaults the reference uses: provider-safe dimensions and encoded size. */
export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 4.5 * 1024 * 1024,
  jpegQuality: 80,
};

export interface ImageLimits {
  maxWidth: number;
  maxHeight: number;
  /** Limit on the base64 payload, which is what providers measure. */
  maxBytes: number;
  jpegQuality: number;
}

export interface CompressedImage {
  buffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  resized: boolean;
}

export const imageCompressionDeps: {
  runner: CommandRunner;
  hasCommand: (command: string) => boolean;
} = {
  runner: execRunner,
  hasCommand: commandExists,
};

/** Reads the size out of the PNG header, so a capture needs no extra binary. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  const isPng =
    buffer.length >= 24 &&
    buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR";
  if (!isPng) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "The screen capture did not return a PNG image.",
    );
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function base64Size(buffer: Buffer): number {
  return Math.ceil(buffer.length / 3) * 4;
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  let targetWidth = width;
  let targetHeight = height;
  if (targetWidth > maxWidth) {
    targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
    targetWidth = maxWidth;
  }
  if (targetHeight > maxHeight) {
    targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
    targetHeight = maxHeight;
  }
  return { width: Math.max(1, targetWidth), height: Math.max(1, targetHeight) };
}

function convertTool(): string | undefined {
  if (imageCompressionDeps.hasCommand("magick")) {
    return "magick";
  }
  if (imageCompressionDeps.hasCommand("convert")) {
    return "convert";
  }
  return undefined;
}

async function encode(
  tool: string,
  input: Buffer,
  target: { width: number; height: number },
  format: "png" | "jpeg",
  quality?: number,
): Promise<Buffer> {
  const resize = ["-resize", `${target.width}x${target.height}`];
  const qualityArgs = quality === undefined ? [] : ["-quality", `${quality}`];
  return imageCompressionDeps.runner.run(
    tool,
    ["png:-", ...resize, ...qualityArgs, `${format}:-`],
    input,
  );
}

/**
 * Screenshots leave the desktop at whatever resolution it runs at, and a 4K
 * capture is both over the provider's inline limits and a large tax on every
 * later turn. Shrink the longest edge first, then trade PNG for JPEG only when
 * the encoded payload is still too large - text stays sharpest in PNG.
 */
export async function compressScreenshot(
  buffer: Buffer,
  limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
): Promise<CompressedImage> {
  const size = pngSize(buffer);
  const fitsDimensions =
    size.width <= limits.maxWidth && size.height <= limits.maxHeight;
  if (fitsDimensions && base64Size(buffer) < limits.maxBytes) {
    return {
      buffer,
      mimeType: "image/png",
      ...size,
      resized: false,
    };
  }

  const tool = convertTool();
  const target = fitWithin(
    size.width,
    size.height,
    limits.maxWidth,
    limits.maxHeight,
  );
  if (!tool) {
    // Without a resizer the capture can still be shown when it is under the
    // hard cap the model pipeline enforces; otherwise say what to install.
    if (base64Size(buffer) < 8 * 1024 * 1024) {
      return { buffer, mimeType: "image/png", ...size, resized: false };
    }
    throw new TntError(
      TntErrorReason.Unspecified,
      "The screenshot is too large to attach. Install ImageMagick (magick or convert) so it can be downscaled.",
    );
  }

  const png = fitsDimensions
    ? buffer
    : await encode(tool, buffer, target, "png");
  if (base64Size(png) < limits.maxBytes) {
    return {
      buffer: png,
      mimeType: "image/png",
      ...target,
      resized: !fitsDimensions,
    };
  }

  let smallest = png;
  for (const quality of [limits.jpegQuality, 70, 55, 40]) {
    const jpeg = await encode(tool, png, target, "jpeg", quality);
    if (base64Size(jpeg) < limits.maxBytes) {
      return {
        buffer: jpeg,
        mimeType: "image/jpeg",
        ...target,
        resized: true,
      };
    }
    if (jpeg.length < smallest.length) {
      smallest = jpeg;
    }
  }

  if (base64Size(smallest) >= 8 * 1024 * 1024) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "The screenshot could not be compressed enough to attach.",
    );
  }
  return {
    buffer: smallest,
    mimeType: smallest === png ? "image/png" : "image/jpeg",
    ...target,
    resized: true,
  };
}
