import { describe, expect, it } from "vitest";

import {
  imageObservationContent,
  normalizeToolResult,
} from "./toolResultMedia.js";

const png = { mimeType: "image/png", data: "aGVsbG8=" };

describe("normalizeToolResult", () => {
  it("passes a plain string through as text", () => {
    expect(normalizeToolResult("done")).toEqual({
      content: "done",
      images: [],
    });
  });

  it("keeps the text and the images of an object result", () => {
    expect(normalizeToolResult({ content: "captured", images: [png] })).toEqual(
      { content: "captured", images: [png] },
    );
  });

  it("refuses more images than one observation may carry", () => {
    expect(() =>
      normalizeToolResult({
        content: "too many",
        images: Array.from({ length: 5 }, () => png),
      }),
    ).toThrow(/at most 4 images/);
  });

  it("refuses a payload that is not an image", () => {
    expect(() =>
      normalizeToolResult({
        content: "bad",
        images: [{ mimeType: "text/plain", data: "aGVsbG8=" }],
      }),
    ).toThrow(/image\/\*/);
    expect(() =>
      normalizeToolResult({
        content: "bad",
        images: [{ mimeType: "image/png", data: "  " }],
      }),
    ).toThrow(/image\/\*/);
  });

  it("refuses a malformed object result", () => {
    expect(() => normalizeToolResult({ images: [png] } as any)).toThrow(
      /string content/,
    );
  });
});

describe("imageObservationContent", () => {
  it("attaches every image as a data URL after explaining it", () => {
    const content = imageObservationContent("Computer", [png]);
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) {
      return;
    }

    expect(content[0]).toEqual({
      type: "text",
      text: "1 image from Computer.",
    });
    expect(content[1]).toEqual({
      type: "imageUrl",
      imageUrl: { url: "data:image/png;base64,aGVsbG8=" },
    });
  });

  it("pluralizes the caption and keeps image order", () => {
    const content = imageObservationContent("Computer", [
      png,
      { mimeType: "image/jpeg", data: "d29ybGQ=" },
    ]);
    if (!Array.isArray(content)) {
      throw new Error("expected message parts");
    }

    expect(content[0]).toMatchObject({
      text: expect.stringContaining("2 images"),
    });
    expect(content.slice(1).map((part) => (part as any).imageUrl.url)).toEqual([
      "data:image/png;base64,aGVsbG8=",
      "data:image/jpeg;base64,d29ybGQ=",
    ]);
  });

  it("returns empty content when there is nothing to show", () => {
    expect(imageObservationContent("Computer", [])).toBe("");
  });
});
