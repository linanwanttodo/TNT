import { describe, expect, it } from "vitest";

import type { LoadedPlugin } from "./manifest.js";
import { substitutePluginVariablesDeep } from "./manifest.js";

/**
 * The substitution used to splice the plugin root into a `JSON.stringify` of the
 * config and parse it back. That is sound only while paths contain no characters
 * JSON has to escape, and a Windows root is `C:\\Users\\...` - every backslash an
 * escape the parse refuses. The `catch` then returned the *unsubstituted* config,
 * so a plugin's MCP args reached the caller as `${CLAUDE_PLUGIN_ROOT}/server.js`.
 *
 * A Windows root is written as a string here rather than produced by `path.join`,
 * which is what lets this run on a runner that has no `C:`.
 */
function pluginAt(path: string): LoadedPlugin {
  return {
    id: "acme/demo",
    name: "demo",
    path,
    manifest: { name: "demo" },
  } as unknown as LoadedPlugin;
}

describe("substituting the plugin root into a nested config", () => {
  it("keeps a Windows root intact through arrays and objects", () => {
    const plugin = pluginAt("C:\\Users\\runner\\plugins\\acme\\demo");

    const substituted = substitutePluginVariablesDeep(
      {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/server.js", "--stdio"],
        env: { ROOT: "${CLAUDE_PLUGIN_ROOT}" },
      },
      plugin,
    );

    expect(substituted.args).toEqual([
      "C:\\Users\\runner\\plugins\\acme\\demo/server.js",
      "--stdio",
    ]);
    expect(substituted.env).toEqual({
      ROOT: "C:\\Users\\runner\\plugins\\acme\\demo",
    });
    // The point of the old round trip it replaces: what comes out is still
    // serialisable, so nothing downstream has to guess whether it was expanded.
    expect(JSON.parse(JSON.stringify(substituted))).toEqual(substituted);
  });

  it("substitutes inside a key as well as a value", () => {
    const substituted = substitutePluginVariablesDeep(
      { "${CLAUDE_PLUGIN_ROOT}/docs": { url: "https://example.test" } },
      pluginAt("/opt/plugin"),
    );

    expect(Object.keys(substituted)).toEqual(["/opt/plugin/docs"]);
  });

  it("leaves the rest of the structure alone", () => {
    const substituted = substitutePluginVariablesDeep(
      { timeout: 30, enabled: true, headers: null, list: [1, 2] },
      pluginAt("/opt/plugin"),
    );

    expect(substituted).toEqual({
      timeout: 30,
      enabled: true,
      headers: null,
      list: [1, 2],
    });
  });
});
