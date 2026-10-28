import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveThemeName } from "./terminalAppearance.js";
import { darkTheme, getTheme } from "./tokens.js";

const dirs: string[] = [];
let previousGlobalDir: string | undefined;

function themeHome(files: Record<string, string>): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-theme-"));
  dirs.push(home);
  previousGlobalDir ??= process.env.TNT_GLOBAL_DIR;
  process.env.TNT_GLOBAL_DIR = home;
  fs.mkdirSync(path.join(home, "themes"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(home, "themes", name), text);
  }
  return home;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (previousGlobalDir === undefined) {
    delete process.env.TNT_GLOBAL_DIR;
  } else {
    process.env.TNT_GLOBAL_DIR = previousGlobalDir;
    previousGlobalDir = undefined;
  }
});

describe("a theme file", () => {
  it("changes the tokens it names and inherits the rest", () => {
    themeHome({
      "night.json": JSON.stringify({
        accent: "#ff00aa",
        text: { primary: "#eeeeee" },
        diff: { addText: "#00ff00" },
      }),
    });

    const custom = getTheme("night");

    expect(custom.accent).toBe("#ff00aa");
    expect(custom.text.primary).toBe("#eeeeee");
    expect(custom.diff.addText).toBe("#00ff00");
    // Everything the file did not name still comes from the base palette.
    expect(custom.text.secondary).toBe(darkTheme.text.secondary);
    expect(custom.diff.addBackground).toBe(darkTheme.diff.addBackground);
    expect(custom.syntax.keyword).toBe(darkTheme.syntax.keyword);
  });

  it("ignores a value that is not a colour, and keeps the rest", () => {
    themeHome({
      "partial.json": JSON.stringify({
        accent: "#123456",
        text: { primary: 42, secondary: "#abcdef" },
      }),
    });

    const custom = getTheme("partial");

    expect(custom.accent).toBe("#123456");
    expect(custom.text.secondary).toBe("#abcdef");
    expect(custom.text.primary).toBe(darkTheme.text.primary);
  });

  it("falls back to dark when the file is not JSON", () => {
    themeHome({ "broken.json": "{ not json" });

    expect(getTheme("broken")).toBe(darkTheme);
  });

  it("falls back to dark when there is no such file", () => {
    themeHome({});

    expect(getTheme("missing")).toBe(darkTheme);
  });

  it("never changes the built-in themes", () => {
    themeHome({ "dark.json": JSON.stringify({ accent: "#ff0000" }) });

    expect(getTheme("dark").accent).toBe(darkTheme.accent);
  });
});

describe("choosing a theme by name", () => {
  it("keeps a name the file backs, and drops one nothing backs", () => {
    themeHome({ "night.json": JSON.stringify({ accent: "#ff00aa" }) });

    // Without this the configured name would be rewritten to `dark` before
    // `getTheme` ever saw it, and the file would never load.
    expect(resolveThemeName("night")).toBe("night");
    expect(resolveThemeName("nowhere")).toBe("dark");
  });
});
