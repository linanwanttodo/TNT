import { describe, expect, it } from "vitest";

import {
  darkTheme,
  getTheme,
  tencentDarkTheme,
  tencentLightTheme,
  theme,
  themes,
} from "./tokens.js";

describe("Theme system", () => {
  it("exports valid default dark theme as theme", () => {
    expect(theme).toBe(darkTheme);
    expect(theme.status.success).toBe("green");
    expect(theme.tool.pendingBackground).toBe("#1c1c1c");
    expect(theme.diff.addBackground).toBe("#163b24");
    expect(theme.diff.delBackground).toBe("#3b1a1e");
  });

  it("uses a light blue accent and focus border by default", () => {
    expect(darkTheme.accent).toBe("#5ac8fa");
    expect(darkTheme.border.focus).toBe("#5ac8fa");
  });

  it("carries syntax tokens on every theme so code blocks follow the theme", () => {
    expect(darkTheme.syntax.keyword).toBe("magenta");
    expect(tencentDarkTheme.syntax.string).toBe("#48d597");
    expect(tencentLightTheme.syntax.keyword).toBe("#0052d9");
    expect(getTheme("tencent-light").syntax.default).toBe("#181818");
  });

  it("resolves registered themes by name", () => {
    expect(getTheme("dark")).toBe(darkTheme);
    expect(getTheme("tencent-dark")).toBe(tencentDarkTheme);
    expect(getTheme("tencent-light")).toBe(tencentLightTheme);
    expect(getTheme("light")).toBe(tencentLightTheme);
    expect(getTheme("unknown")).toBe(darkTheme);
    expect(getTheme()).toBe(darkTheme);
  });

  it("adheres to Tencent UI guidelines with solid flat colors and no gradients", () => {
    const allThemes = [darkTheme, tencentDarkTheme, tencentLightTheme];

    for (const t of allThemes) {
      // Must not contain gradient definitions
      expect(t.accent).not.toContain("gradient");
      expect(t.tool.successBackground).not.toContain("gradient");
      expect(t.tool.errorBackground).not.toContain("gradient");
      expect(t.tool.pendingBackground).not.toContain("gradient");
      expect(t.tool.canceledBackground).not.toContain("gradient");
      expect(t.diff.addBackground).not.toContain("gradient");
      expect(t.diff.delBackground).not.toContain("gradient");

      // Solid flat colors are defined
      expect(typeof t.accent).toBe("string");
      expect(typeof t.diff.addBackground).toBe("string");
      expect(typeof t.diff.delBackground).toBe("string");
      expect(typeof t.diff.gutterText).toBe("string");
    }
  });

  it("has Tencent blue brand accent in tencentDarkTheme and tencentLightTheme", () => {
    expect(tencentDarkTheme.accent).toBe("#0052d9");
    expect(tencentLightTheme.accent).toBe("#0052d9");
  });

  it("keeps every theme the same shape, so a lookup cannot go undefined", () => {
    const shapeOf = (value: unknown): unknown => {
      if (value && typeof value === "object") {
        return Object.keys(value)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = shapeOf((value as Record<string, unknown>)[key]);
            return acc;
          }, {});
      }
      return typeof value;
    };

    const reference = shapeOf(darkTheme);

    for (const [name, candidate] of Object.entries(themes)) {
      expect(
        shapeOf(candidate),
        `theme ${name} drifted from darkTheme`,
      ).toEqual(reference);
    }
  });

  it("resolves every registered theme name to its own object", () => {
    for (const [name, candidate] of Object.entries(themes)) {
      expect(getTheme(name)).toBe(candidate);
    }
  });
});
