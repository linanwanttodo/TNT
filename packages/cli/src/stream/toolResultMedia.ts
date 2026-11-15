import type { MessageContent } from "core/index.js";
import { TntError, TntErrorReason } from "core/util/errors.js";

import type { ToolImage, ToolRunResult } from "../tools/types.js";

/** A single observation is a perception step, not a photo album. */
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface NormalizedToolResult {
  content: string;
  images: ToolImage[];
}

/**
 * Old tools return a string and must keep working unchanged. A tool that
 * returns images is normalized here so every downstream consumer - the spill
 * check, the post-tool hook, the result text - reads text, while the host is
 * the only one that has to know about the attachments.
 */
export function normalizeToolResult(
  result: ToolRunResult,
): NormalizedToolResult {
  if (typeof result === "string") {
    return { content: result, images: [] };
  }
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.content !== "string"
  ) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "A tool result must be a string or an object with string content.",
    );
  }
  const images = result.images ?? [];
  if (!Array.isArray(images)) {
    throw new TntError(
      TntErrorReason.Unspecified,
      "A tool result's images must be an array.",
    );
  }
  if (images.length > MAX_IMAGES) {
    throw new TntError(
      TntErrorReason.Unspecified,
      `A tool result may carry at most ${MAX_IMAGES} images.`,
    );
  }
  for (const image of images) {
    if (
      typeof image?.mimeType !== "string" ||
      !image.mimeType.startsWith("image/") ||
      typeof image.data !== "string" ||
      image.data.trim() === ""
    ) {
      throw new TntError(
        TntErrorReason.Unspecified,
        "Every tool image needs an image/* mime type and base64 data.",
      );
    }
    if ((image.data.length * 3) / 4 > MAX_IMAGE_BYTES) {
      throw new TntError(
        TntErrorReason.Unspecified,
        `A tool image may be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
      );
    }
  }
  return { content: result.content, images };
}

/**
 * Images travel as a user message rather than as tool-result content: the
 * provider that accepts images inside a tool result and the one that does not
 * would otherwise need two host paths, and only the user role is read as
 * image input by every adapter.
 */
export function imageObservationContent(
  toolName: string,
  images: ToolImage[],
): MessageContent {
  if (images.length === 0) {
    return "";
  }
  const noun = images.length === 1 ? "image" : "images";
  return [
    {
      type: "text",
      text: `${images.length} ${noun} from ${toolName}.`,
    },
    ...images.map((image) => ({
      type: "imageUrl" as const,
      imageUrl: {
        url: `data:${image.mimeType};base64,${image.data}`,
      },
    })),
  ];
}
