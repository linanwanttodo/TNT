import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSettingsFilePaths, readSettingsString } from "./settingsFiles.js";

let home: string;
let project: string;
let previousHome: string | undefined;
let previousGlobalDir: string | undefined;

function write(file: string, settings: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof settings === "string" ? settings : JSON.stringify(settings),
  );
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-settings-home-"));
  project = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-settings-project-"));
  previousHome = process.env.HOME;
  previousGlobalDir = process.env.CONTINUE_GLOBAL_DIR;
  process.env.HOME = home;
  process.env.CONTINUE_GLOBAL_DIR = path.join(home, ".tnt");
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousGlobalDir === undefined) delete process.env.CONTINUE_GLOBAL_DIR;
  else process.env.CONTINUE_GLOBAL_DIR = previousGlobalDir;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe("settings file discovery", () => {
  it("lists the six locations from lowest to highest precedence", () => {
    const paths = getSettingsFilePaths(project, home);

    expect(paths).toEqual([
      path.join(home, ".claude", "settings.json"),
      path.join(home, ".tnt", "settings.json"),
      path.join(project, ".claude", "settings.json"),
      path.join(project, ".tnt", "settings.json"),
      path.join(project, ".claude", "settings.local.json"),
      path.join(project, ".tnt", "settings.local.json"),
    ]);
  });
});

describe("reading a settings value", () => {
  it("returns undefined when no file defines the key", () => {
    expect(readSettingsString("outputStyle", project, home)).toBeUndefined();
  });

  it("reads a user-global value", () => {
    write(path.join(home, ".tnt", "settings.json"), {
      outputStyle: "acme:terse",
    });

    expect(readSettingsString("outputStyle", project, home)).toBe("acme:terse");
  });

  it("lets the project override the user value", () => {
    write(path.join(home, ".tnt", "settings.json"), {
      outputStyle: "acme:terse",
    });
    write(path.join(project, ".tnt", "settings.json"), {
      outputStyle: "acme:verbose",
    });

    expect(readSettingsString("outputStyle", project, home)).toBe(
      "acme:verbose",
    );
  });

  it("lets a project-local file override the committed project value", () => {
    write(path.join(project, ".tnt", "settings.json"), {
      outputStyle: "acme:verbose",
    });
    write(path.join(project, ".tnt", "settings.local.json"), {
      outputStyle: "acme:terse",
    });

    expect(readSettingsString("outputStyle", project, home)).toBe("acme:terse");
  });

  it("prefers the continue location over the claude location at equal scope", () => {
    write(path.join(project, ".claude", "settings.json"), {
      outputStyle: "claude:style",
    });
    write(path.join(project, ".tnt", "settings.json"), {
      outputStyle: "tnt:style",
    });

    expect(readSettingsString("outputStyle", project, home)).toBe("tnt:style");
  });

  it("skips a malformed file rather than failing the lookup", () => {
    write(path.join(project, ".tnt", "settings.json"), "{ not json");
    write(path.join(project, ".tnt", "settings.local.json"), {
      outputStyle: "acme:terse",
    });

    expect(readSettingsString("outputStyle", project, home)).toBe("acme:terse");
  });

  it("ignores a non-string or blank value", () => {
    write(path.join(project, ".tnt", "settings.json"), { outputStyle: 42 });
    expect(readSettingsString("outputStyle", project, home)).toBeUndefined();

    write(path.join(project, ".tnt", "settings.json"), { outputStyle: "  " });
    expect(readSettingsString("outputStyle", project, home)).toBeUndefined();
  });
});
