import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLocale, setLocale } from "../../i18n/index.js";
import { handlePlugins } from "./plugins.js";
import { handleGoal, handleTitle } from "./sessions.js";
import { handleSkills } from "./skills.js";

let pluginsDir: string;
let previousOverride: string | undefined;
let previousLocale: string;

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-locale-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
  previousLocale = getLocale();
  setLocale("zh-CN");
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  setLocale(previousLocale as never);
  fs.rmSync(pluginsDir, { recursive: true, force: true });
});

/** The copy is resolved when the handler runs, not when the module loads. */
describe("slash command copy follows the active locale", () => {
  it("translates the plugin listing and its hints", async () => {
    const result = await handlePlugins([]);

    expect(result.output).toContain("未安装任何插件");
    expect(result.output).toContain("/plugin marketplace add");
  });

  it("translates the marketplace listing", async () => {
    const result = await handlePlugins(["marketplace", "list"]);

    expect(result.output).toBe("尚未注册插件市场。");
  });

  it("translates the session title prompt", () => {
    const result = handleTitle([]);

    expect(result.output).toContain("请提供标题");
  });

  it("translates the goal prompt", () => {
    const result = handleGoal([]);

    expect(result.output).toContain("未设置目标");
  });

  it("translates the empty skills hint", async () => {
    const result = await handleSkills();

    expect(result.output).toContain("没有找到技能");
  });
});
