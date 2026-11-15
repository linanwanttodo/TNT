import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TNT_ASCII_ART, getDisplayableAsciiArt } from "./asciiArt.js";

describe("asciiArt", () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
  });

  afterEach(() => {
    if (originalColumns === undefined) {
      delete (process.stdout as any).columns;
    } else {
      process.stdout.columns = originalColumns;
    }
  });

  it("draws TNT as a compact two-line half-block wordmark", () => {
    const plain = TNT_ASCII_ART.replace(/\u001b\[[0-9;]*m/g, "");
    const lines = plain.split("\n").filter((line) => line.trim().length > 0);

    // One glyph row with the version beside it, one glyph row below.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("▀██▀");
    expect(lines[0]).toMatch(/v\d/);
    expect(lines[1]).toContain(" ██ ");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      40,
    );
  });

  describe("getDisplayableAsciiArt", () => {
    it("should return TNT ASCII art when terminal is wide enough", () => {
      // Set process.stdout.columns to simulate wide terminal
      process.stdout.columns = 80;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(TNT_ASCII_ART);
    });

    it("should return just the version string when terminal is too narrow", () => {
      // Set process.stdout.columns to simulate narrow terminal
      process.stdout.columns = 20;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(TNT_ASCII_ART);
      expect(result).toMatch(/^v/);
    });

    it("should return just the version string when terminal is below threshold", () => {
      // Test the edge case just below the wordmark's 30-column threshold
      process.stdout.columns = 29;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(TNT_ASCII_ART);
      expect(result).toMatch(/^v/);
    });

    it("should return TNT ASCII art when terminal is exactly at threshold", () => {
      // Test the edge case at exactly 30 columns (our threshold)
      process.stdout.columns = 30;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(TNT_ASCII_ART);
    });

    it("should default to TNT ASCII art when columns is undefined", () => {
      // Set process.stdout.columns to undefined (should default to 80)
      delete (process.stdout as any).columns;

      const result = getDisplayableAsciiArt();

      expect(result).toBe(TNT_ASCII_ART);
    });
  });
});
