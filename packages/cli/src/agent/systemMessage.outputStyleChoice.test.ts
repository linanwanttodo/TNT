import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session module owns the chosen style; this suite controls that choice and
// leaves every other export of the module intact.
const chosen = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("../session/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/index.js")>();
  return { ...actual, getSessionOutputStyle: () => chosen.value };
});

const { constructSystemMessage } =
  await vi.importActual<typeof import("./systemMessage.js")>(
    "./systemMessage.js",
  );
const { serviceContainer } = await import("../services/ServiceContainer.js");
const { SERVICE_NAMES } = await import("../services/types.js");

let pluginsDir: string;
let previousOverride: string | undefined;

function writeStyles(styles: { file: string; body: string }[]): void {
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
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-style-choice-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
  chosen.value = undefined;
  serviceContainer.registerValue(SERVICE_NAMES.CONFIG, {
    config: { rules: [] },
  });
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
});

describe("the project default from settings", () => {
  let projectDir: string;
  let previousCwd: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-style-project-"));
    previousCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function writeDefault(name: string): void {
    fs.mkdirSync(path.join(projectDir, ".tnt"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, ".tnt", "settings.json"),
      JSON.stringify({ outputStyle: name }),
    );
  }

  it("applies a project default when the session chose nothing", async () => {
    writeStyles([
      { file: "terse.md", body: "Answer in one line." },
      { file: "verbose.md", body: "Explain every step." },
    ]);
    writeDefault("voice:verbose");

    const message = await constructSystemMessage("agent");

    expect(message).toContain('source="voice:verbose"');
    expect(message).not.toContain("Answer in one line.");
  });

  it("lets the session choice beat the project default", async () => {
    writeStyles([
      { file: "terse.md", body: "Answer in one line." },
      { file: "verbose.md", body: "Explain every step." },
    ]);
    writeDefault("voice:verbose");
    chosen.value = "voice:terse";

    const message = await constructSystemMessage("agent");

    expect(message).toContain('source="voice:terse"');
    expect(message).not.toContain("Explain every step.");
  });

  it("falls through to the plugin default when the setting names a missing style", async () => {
    writeStyles([
      {
        file: "terse.md",
        body: "---\nforce-for-plugin: true\n---\nAnswer in one line.",
      },
    ]);
    writeDefault("voice:removed");

    const message = await constructSystemMessage("agent");

    expect(message).toContain('source="voice:terse"');
  });
});

describe("choosing an output style for the session", () => {
  it("applies the chosen style even when another is merely offered", async () => {
    writeStyles([
      { file: "terse.md", body: "Answer in one line." },
      { file: "verbose.md", body: "Explain every step." },
    ]);
    chosen.value = "voice:terse";

    const message = await constructSystemMessage("agent");

    expect(message).toContain('source="voice:terse"');
    expect(message).toContain("Answer in one line.");
    expect(message).not.toContain("Explain every step.");
  });

  it("lets the chosen style override one a plugin forces on", async () => {
    writeStyles([
      {
        file: "terse.md",
        body: "---\nforce-for-plugin: true\n---\nAnswer in one line.",
      },
      { file: "verbose.md", body: "Explain every step." },
    ]);
    chosen.value = "voice:verbose";

    const message = await constructSystemMessage("agent");

    expect(message).toContain('source="voice:verbose"');
    expect(message).toContain("Explain every step.");
    expect(message).not.toContain("Answer in one line.");
  });

  it("applies the forced style when the session chose nothing", async () => {
    writeStyles([
      {
        file: "terse.md",
        body: "---\nforce-for-plugin: true\n---\nAnswer in one line.",
      },
      { file: "verbose.md", body: "Explain every step." },
    ]);

    const message = await constructSystemMessage("agent");

    expect(message).toContain('source="voice:terse"');
    expect(message).not.toContain("Explain every step.");
  });

  it("falls back to the plugin default when the chosen style is gone", async () => {
    writeStyles([{ file: "terse.md", body: "Answer in one line." }]);
    chosen.value = "voice:removed";

    const message = await constructSystemMessage("agent");

    expect(message).not.toContain('source="voice:removed"');
  });
});
