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

  it("draws TNT as compact block letters", () => {
    const plain = TNT_ASCII_ART.replace(/\u001b\[[0-9;]*m/g, "");
    const lines = plain.split("\n").filter((line) => line.trim().length > 0);

    // Six rows of glyphs plus the version line.
    expect(lines).toHaveLength(7);
    expect(lines[0]).toContain("████████╗");
    expect(lines[2]).toContain("██╔██╗");
    expect(lines[5]).toContain("╚═╝");
    expect(
      Math.max(...lines.slice(0, 6).map((line) => line.length)),
    ).toBeLessThanOrEqual(30);
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
      process.stdout.columns = 60;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(TNT_ASCII_ART);
      expect(result).toMatch(/^v/);
    });

    it("should return just the version string when terminal is below threshold", () => {
      // Test the edge case at exactly 74 columns (below our threshold of 75)
      process.stdout.columns = 74;

      const result = getDisplayableAsciiArt();

      expect(result).not.toBe(TNT_ASCII_ART);
      expect(result).toMatch(/^v/);
    });

    it("should return TNT ASCII art when terminal is exactly at threshold", () => {
      // Test the edge case at exactly 75 columns (our threshold)
      process.stdout.columns = 75;

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
