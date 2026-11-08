import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import {
  claudeFilledDot,
  claudeGlyphs,
  PRESETS,
  symbols,
  symbolsFor,
} from "./symbols.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The characters this table owns; a literal one anywhere else is a missed site. */
const OWNED_GLYPHS = [
  "\u276F",
  "\u25CF",
  "\u25CB",
  "\u25D0",
  "\u2713",
  "\u280B",
  "\u23FA",
  "\u23BF",
  "\u2733",
  "\u2802",
  "\u2810",
];

function uiSources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      uiSources(full, found);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes(".test.") &&
      path.basename(full) !== "symbols.ts"
    ) {
      found.push(full);
    }
  }
  return found;
}

describe("the symbol table", () => {
  it("defines the same marks in every preset", () => {
    const shape = Object.keys(PRESETS.unicode).sort();
    for (const [name, preset] of Object.entries(PRESETS)) {
      expect(Object.keys(preset).sort(), name).toEqual(shape);
      expect(preset.spinner.length, name).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps the ASCII preset writable in a seven-bit terminal", () => {
    const ascii = PRESETS.ascii;
    const marks = [ascii.selected, ascii.bullet, ascii.ring, ascii.thinking];
    for (const mark of [...marks, ...ascii.spinner]) {
      expect(mark, mark).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("falls back to unicode for a name it does not know", () => {
    expect(symbolsFor("ascii")).toBe(PRESETS.ascii);
    expect(symbolsFor("nerd")).toBe(PRESETS.nerd);
    expect(symbolsFor("wat")).toBe(PRESETS.unicode);
    expect(symbolsFor(undefined)).toBe(PRESETS.unicode);
  });

  it("reads the preset from the environment", () => {
    const previous = process.env.TNT_SYMBOLS;
    try {
      process.env.TNT_SYMBOLS = "ascii";
      expect(symbols()).toBe(PRESETS.ascii);
      process.env.TNT_SYMBOLS = "NERD";
      expect(symbols()).toBe(PRESETS.nerd);
    } finally {
      if (previous === undefined) {
        delete process.env.TNT_SYMBOLS;
      } else {
        process.env.TNT_SYMBOLS = previous;
      }
    }
  });

  it("is the only file that draws these glyphs", () => {
    // A literal in a component is a mark the presets cannot change, which is how
    // the interface ended up half-ASCII for anyone who asked for ASCII.
    const offenders = uiSources(here)
      .filter((file) =>
        OWNED_GLYPHS.some((glyph) =>
          fs.readFileSync(file, "utf-8").includes(glyph),
        ),
      )
      .map((file) => path.relative(here, file));
    expect(offenders).toEqual([]);
  });
});

describe("the Claude glyph set", () => {
  it("selects the filled dot by platform", () => {
    expect(claudeFilledDot("darwin")).toBe("\u23FA");
    expect(claudeFilledDot("linux")).toBe("\u25CF");
    expect(claudeFilledDot("win32")).toBe("\u25CF");
    expect(claudeFilledDot()).toBe(claudeFilledDot(process.platform));
  });

  it("keeps every surveyed mark in its own token", () => {
    const glyphs = claudeGlyphs("linux");

    expect(Object.keys(glyphs).sort()).toEqual([
      "filledDot",
      "promptPointer",
      "resultGutter",
      "titleFrames",
      "titlePrefix",
    ]);
    expect(glyphs.filledDot).toBe("\u25CF");
    expect(glyphs.resultGutter).toBe("\u23BF");
    expect(glyphs.promptPointer).toBe("\u276F");
    expect(glyphs.titlePrefix).toBe("\u2733");
    expect(glyphs.titleFrames).toEqual(["\u2802", "\u2810"]);
  });

  it("keeps the macOS dot distinct from the plain one", () => {
    expect(claudeGlyphs("darwin").filledDot).toBe("\u23FA");
    expect(claudeGlyphs("linux").filledDot).toBe("\u25CF");
  });
});
