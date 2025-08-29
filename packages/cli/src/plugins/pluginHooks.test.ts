import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHooks } from "../hooks/hookRunner.js";
import type { HooksConfig, PreToolUseInput } from "../hooks/types.js";
import { loadAllPlugins } from "./loader.js";

let pluginsDir: string;
let previousOverride: string | undefined;

function writePlugin(
  marketplace: string,
  name: string,
  files: { manifest: unknown; hooksJson?: unknown; extraHooksFile?: string },
): void {
  const root = path.join(pluginsDir, "cache", marketplace, name, "1.0.0");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify(files.manifest),
  );
  if (files.hooksJson) {
    fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "hooks", "hooks.json"),
      JSON.stringify(files.hooksJson),
    );
  }
  if (files.extraHooksFile) {
    fs.writeFileSync(
      path.join(root, files.extraHooksFile),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: `printf '{"from":"tnt-manifest-file"}'`,
                },
              ],
            },
          ],
        },
      }),
    );
  }
}

function toolCall(): PreToolUseInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    transcript_path: path.join(pluginsDir, "transcript.jsonl"),
    cwd: pluginsDir,
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_use_id: "tool-1",
  };
}

/** Only the groups this test planted, in case the machine has other plugins. */
function ownGroups(config: HooksConfig): unknown[] {
  return (config.PreToolUse ?? []).filter((group) =>
    group.hooks.some(
      (handler) =>
        handler.type === "command" && handler.command.includes("tnt-"),
    ),
  );
}

beforeEach(() => {
  previousOverride = process.env.TNT_PLUGINS_DIR;
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-plugin-hooks-"));
  process.env.TNT_PLUGINS_DIR = pluginsDir;
});

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.TNT_PLUGINS_DIR;
  } else {
    process.env.TNT_PLUGINS_DIR = previousOverride;
  }
  fs.rmSync(pluginsDir, { recursive: true, force: true });
});

describe("hooks contributed by a plugin", () => {
  it("surfaces a hook declared in hooks/hooks.json", () => {
    writePlugin("acme", "voice", {
      manifest: { name: "voice" },
      hooksJson: {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "tnt-echo a" }],
            },
          ],
        },
      },
    });

    const { hooks } = loadAllPlugins();

    expect(ownGroups(hooks.config).length).toBe(1);
    expect(hooks.disabled).toBe(false);
  });

  it("merges a hooks file referenced from the manifest", () => {
    writePlugin("acme", "voice", {
      manifest: { name: "voice", hooks: "extra-hooks.json" },
      extraHooksFile: "extra-hooks.json",
    });

    const { hooks } = loadAllPlugins();

    expect(ownGroups(hooks.config).length).toBe(1);
  });

  it("reports the plugin-wide kill switch", () => {
    writePlugin("acme", "voice", {
      manifest: { name: "voice" },
      hooksJson: { hooks: {}, disableAllHooks: true },
    });

    const { hooks } = loadAllPlugins();

    expect(hooks.disabled).toBe(true);
  });

  it("runs a plugin hook and lets it block the tool call", async () => {
    writePlugin("acme", "voice", {
      manifest: { name: "voice" },
      hooksJson: {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "echo 'tnt-blocked by plugin' 1>&2; exit 2",
                },
              ],
            },
          ],
        },
      },
    });

    const { hooks } = loadAllPlugins();
    const result = await runHooks(hooks.config, toolCall(), pluginsDir);

    expect(result.blocked).toBe(true);
    expect(
      result.results.some(
        (entry) => entry.blockReason === "tnt-blocked by plugin",
      ),
    ).toBe(true);
  });

  it("keeps going when a plugin hook script fails", async () => {
    writePlugin("acme", "voice", {
      manifest: { name: "voice" },
      hooksJson: {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                { type: "command", command: "echo 'tnt-crash' 1>&2; exit 1" },
                { type: "command", command: "tnt-not-a-real-binary" },
              ],
            },
          ],
        },
      },
    });

    const { hooks } = loadAllPlugins();
    const result = await runHooks(hooks.config, toolCall(), pluginsDir);

    expect(result.blocked).toBe(false);
    const failures = result.results.filter(
      (entry) => entry.stderr.includes("tnt-") || entry.exitCode !== 0,
    );
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(result.results.every((entry) => entry.blocked === false)).toBe(true);
  });

  it("resolves CLAUDE_PLUGIN_ROOT in a plugin hook command", async () => {
    writePlugin("acme", "voice", {
      manifest: { name: "voice" },
      hooksJson: {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: "${CLAUDE_PLUGIN_ROOT}/scripts/hook.sh",
                },
              ],
            },
          ],
        },
      },
    });

    const script = path.join(
      pluginsDir,
      "cache",
      "acme",
      "voice",
      "1.0.0",
      "scripts",
      "hook.sh",
    );
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(
      script,
      "#!/bin/sh\necho 'tnt-rooted hook' 1>&2\nexit 2\n",
    );
    fs.chmodSync(script, 0o755);

    const { hooks } = loadAllPlugins();
    const result = await runHooks(hooks.config, toolCall(), pluginsDir);

    // Without the substitution the shell expands the unset variable to an
    // empty path and the hook never blocks.
    expect(result.blocked).toBe(true);
    expect(
      result.results.some((entry) => entry.blockReason === "tnt-rooted hook"),
    ).toBe(true);
  });

  it("ignores a hooks file that is not valid JSON", () => {
    writePlugin("acme", "voice", { manifest: { name: "voice" } });
    const hooksPath = path.join(
      pluginsDir,
      "cache",
      "acme",
      "voice",
      "1.0.0",
      "hooks",
    );
    fs.mkdirSync(hooksPath, { recursive: true });
    fs.writeFileSync(path.join(hooksPath, "hooks.json"), "{ not json");

    const { hooks } = loadAllPlugins();

    expect(ownGroups(hooks.config).length).toBe(0);
  });
});
