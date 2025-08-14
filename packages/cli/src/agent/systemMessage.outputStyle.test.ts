import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

// The shared test setup mocks systemMessage.js so suites never touch the
// service container. These assertions are about the real renderer.
const { buildOutputStyleSection, constructSystemMessage } =
  await vi.importActual<typeof import("./systemMessage.js")>(
    "./systemMessage.js",
  );
const { serviceContainer } = await import("../services/ServiceContainer.js");
const { SERVICE_NAMES } = await import("../services/types.js");

describe("buildOutputStyleSection", () => {
  it("returns nothing when no style is active", () => {
    expect(buildOutputStyleSection(undefined)).toBe("");
  });

  it("renders the active style as its own section", () => {
    const section = buildOutputStyleSection({
      name: "demo:terse",
      plugin: "demo",
      description: "Short answers",
      prompt: "Answer in one line.",
      forceForPlugin: true,
    });

    expect(section).toContain(
      '<context name="outputStyle" source="demo:terse">',
    );
    expect(section).toContain("Answer in one line.");
    expect(section).toContain("</context>");
  });
});

describe("constructSystemMessage output style wiring", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    created.length = 0;
    delete process.env.TNT_PLUGINS_DIR;
  });

  it("appends the style a plugin forces on", async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-styles-"));
    created.push(cacheRoot);
    process.env.TNT_PLUGINS_DIR = cacheRoot;

    // The config service is normally started by the CLI entry point. Only the
    // rules it contributes are read here, so an empty config is enough.
    serviceContainer.registerValue(SERVICE_NAMES.CONFIG, {
      config: { rules: [] },
    });

    const pluginRoot = path.join(cacheRoot, "cache", "acme", "voice", "1.0.0");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, "output-styles"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "voice", version: "1.0.0" }),
    );
    fs.writeFileSync(
      path.join(pluginRoot, "output-styles", "terse.md"),
      "---\nname: terse\nforce-for-plugin: true\n---\n\nAnswer in one line.\n",
    );

    const message = await constructSystemMessage("agent");

    expect(message).toContain(
      '<context name="outputStyle" source="voice:terse">',
    );
    expect(message).toContain("Answer in one line.");
  });
});
