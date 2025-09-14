import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSessionOutputStyle,
  setSessionOutputStyle,
} from "../../../session/index.js";

import { handleOutputStyle } from "./outputStyle.js";

let pluginsDir: string;
let homeDir: string;
let previousOverride: string | undefined;

function writePlugin(styles: { file: string; body: string }[]): void {
  const root = path.join(pluginsDir, "cache", "acme", "voice", "1.0.0");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "output-styles"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "voice", outputStyles: "./output-styles" }),
  );
  for (const style of styles) {
    fs.writeFileSync(path.join(root, "output-styles", style.file), style.body);
  }
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-style-picker-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
  // The settings lookup reads the home directory; a temp one keeps these
  // tests from seeing (or writing) a real user's settings.
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-style-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  setSessionOutputStyle(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setSessionOutputStyle(undefined);
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

/** Runs the handler inside a disposable workspace directory. */
function inWorkspace(run: (workspace: string) => void): void {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-style-save-"));
  const previousCwd = process.cwd();
  process.chdir(workspace);
  try {
    run(workspace);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

describe("the output style picker", () => {
  it("reports nothing installed and nothing selected", () => {
    const result = handleOutputStyle([]);

    expect(result.output).toContain("No output style selected.");
    expect(result.output).toContain("No output styles are installed.");
  });

  it("lists the installed styles", () => {
    writePlugin([
      { file: "terse.md", body: "Answer in one line." },
      { file: "verbose.md", body: "Explain every step." },
    ]);

    const result = handleOutputStyle([]);

    expect(result.output).toContain("voice:terse");
    expect(result.output).toContain("voice:verbose");
    expect(result.output).toContain("/output-style");
  });

  it("selects a style and remembers it on the session", () => {
    writePlugin([{ file: "terse.md", body: "Answer in one line." }]);

    const result = handleOutputStyle(["voice:terse"]);

    expect(result.output).toContain("Output style set to voice:terse.");
    expect(getSessionOutputStyle()).toBe("voice:terse");
    expect(handleOutputStyle([]).output).toContain("Output style: voice:terse");
  });

  it("clears the selection", () => {
    writePlugin([{ file: "terse.md", body: "Answer in one line." }]);
    handleOutputStyle(["voice:terse"]);

    const result = handleOutputStyle(["clear"]);

    expect(result.output).toContain("Output style cleared.");
    expect(getSessionOutputStyle()).toBeUndefined();
  });

  it("refuses a style it does not have", () => {
    writePlugin([{ file: "terse.md", body: "Answer in one line." }]);

    const result = handleOutputStyle(["voice:missing"]);

    expect(result.output).toContain("No output style named voice:missing.");
    expect(getSessionOutputStyle()).toBeUndefined();
  });

  it("accepts a multi-word argument as one name", () => {
    writePlugin([{ file: "terse.md", body: "Answer in one line." }]);

    const result = handleOutputStyle(["voice:terse", ""]);

    expect(getSessionOutputStyle()).toBe("voice:terse");
    expect(result.output).toContain("set to");
  });

  it("saves a named style as the project default, keeping other keys", () => {
    writePlugin([{ file: "terse.md", body: "Answer in one line." }]);

    inWorkspace((workspace) => {
      fs.mkdirSync(path.join(workspace, ".tnt"), { recursive: true });
      const settingsPath = path.join(workspace, ".tnt", "settings.json");
      fs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

      const result = handleOutputStyle(["save", "voice:terse"]);

      expect(result.output).toContain(".tnt/settings.json");
      const written = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(written.outputStyle).toBe("voice:terse");
      expect(written.theme).toBe("dark");
      expect(getSessionOutputStyle()).toBe("voice:terse");
    });
  });

  it("saves the session style when no name is given", () => {
    writePlugin([{ file: "terse.md", body: "Answer in one line." }]);
    handleOutputStyle(["voice:terse"]);

    inWorkspace((workspace) => {
      const result = handleOutputStyle(["save"]);

      expect(result.output).toContain(".tnt/settings.json");
      const written = JSON.parse(
        fs.readFileSync(path.join(workspace, ".tnt", "settings.json"), "utf-8"),
      );
      expect(written.outputStyle).toBe("voice:terse");
    });
  });

  it("refuses to save when there is nothing to save", () => {
    inWorkspace(() => {
      const result = handleOutputStyle(["save"]);

      expect(result.output).toContain("Nothing to save");
    });
  });
});
