import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maybePromptForProjectTrust } from "./trustPrompt.js";

/**
 * The trust gate used to be flags only: a cloned repository could carry
 * settings, hooks and MCP servers, and an interactive run had no way to
 * grant or refuse them except by restarting with --trust-project. The
 * prompt runs before the services read the project layers, so a granted
 * trust applies to the first load.
 */
describe("maybePromptForProjectTrust", () => {
  const previousHome = process.env.CONTINUE_GLOBAL_DIR;
  let project: string;

  const askYes = vi.fn(async () => "y");
  const askNo = vi.fn(async () => "");

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONTINUE_GLOBAL_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-trust-"),
    );
    project = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-project-"));
    fs.mkdirSync(path.join(project, ".tnt"));
    fs.writeFileSync(
      path.join(project, ".tnt", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Read"] } }),
      "utf-8",
    );
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.CONTINUE_GLOBAL_DIR;
    } else {
      process.env.CONTINUE_GLOBAL_DIR = previousHome;
    }
  });

  it("asks nothing and records nothing when the project has no config files", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-empty-"));

    await maybePromptForProjectTrust({
      cwd: empty,
      interactive: true,
      ask: askYes,
    });

    expect(askYes).not.toHaveBeenCalled();
  });

  it("asks nothing when the current contents are already trusted", async () => {
    const { trustProject } = await import("../config/trust.js");
    trustProject(project);

    await maybePromptForProjectTrust({
      cwd: project,
      interactive: true,
      ask: askYes,
    });

    expect(askYes).not.toHaveBeenCalled();
  });

  it("records trust for the current contents when answered yes", async () => {
    const { isProjectTrusted } = await import("../config/trust.js");
    expect(isProjectTrusted(project)).toBe(false);

    await maybePromptForProjectTrust({
      cwd: project,
      interactive: true,
      ask: askYes,
    });

    expect(askYes).toHaveBeenCalledTimes(1);
    expect(isProjectTrusted(project)).toBe(true);
  });

  it("leaves the project untrusted on any other answer", async () => {
    const { isProjectTrusted } = await import("../config/trust.js");

    await maybePromptForProjectTrust({
      cwd: project,
      interactive: true,
      ask: askNo,
    });

    expect(askNo).toHaveBeenCalledTimes(1);
    expect(isProjectTrusted(project)).toBe(false);
  });

  it("does not prompt when interactive is not forced", async () => {
    await maybePromptForProjectTrust({ cwd: project, ask: askYes });

    expect(askYes).not.toHaveBeenCalled();
  });
});
