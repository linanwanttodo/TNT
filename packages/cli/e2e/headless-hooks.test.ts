import * as fs from "fs/promises";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../src/test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../src/test-utils/mock-llm-server.js";

describe("E2E: Headless lifecycle hooks", () => {
  let context: any;
  let mockServer: MockLLMServer;
  let logPath: string;

  function appendingHooks(events: string[]) {
    const handler = (event: string) => [
      {
        matcher: "*",
        hooks: [{ type: "command", command: `echo ${event} >> "${logPath}"` }],
      },
    ];
    return Object.fromEntries(events.map((event) => [event, handler(event)]));
  }

  // A plugin whose lifecycle hooks are observable from outside the process.
  async function plantPlugin(hooks: Record<string, unknown>) {
    const root = path.join(
      context.testDir,
      "plugins",
      "cache",
      "local",
      "lifecycle",
      "1.0.0",
    );
    await fs.mkdir(path.join(root, ".claude-plugin"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "lifecycle" }),
    );
    await fs.mkdir(path.join(root, "hooks"), { recursive: true });
    await fs.writeFile(
      path.join(root, "hooks", "hooks.json"),
      JSON.stringify({ hooks }),
    );
  }

  function pluginEnv() {
    return { TNT_PLUGINS_DIR: path.join(context.testDir, "plugins") };
  }

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      response: "Hello there.",
    });
    logPath = path.join(context.testDir, "lifecycle.log");
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("fires the lifecycle hooks around a headless run", async () => {
    await plantPlugin(
      appendingHooks([
        "SessionStart",
        "UserPromptSubmit",
        "Stop",
        "SessionEnd",
      ]),
    );

    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "hi"],
      env: pluginEnv(),
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    const log = await fs.readFile(logPath, "utf-8");
    expect(log.trim().split("\n")).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "SessionEnd",
    ]);
  }, 30000);

  it("lets a UserPromptSubmit hook block the run", async () => {
    await plantPlugin({
      ...appendingHooks(["SessionStart", "UserPromptSubmit", "SessionEnd"]),
      UserPromptSubmit: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: 'echo "tnt-blocked prompt" 1>&2; exit 2',
            },
          ],
        },
      ],
    });

    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "hi"],
      env: pluginEnv(),
      timeout: 15000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("tnt-blocked prompt");
    const log = await fs.readFile(logPath, "utf-8");
    // The blocking handler owns UserPromptSubmit, and the turn never runs, so
    // only the session boundaries land in the log; the session still ends.
    expect(log.trim().split("\n")).toEqual(["SessionStart", "SessionEnd"]);
  }, 30000);
});
