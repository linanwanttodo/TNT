import * as fs from "fs/promises";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";
import { HookFixtures } from "../test-utils/hookFixtures.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

describe("E2E: Headless lifecycle hooks", () => {
  let context: any;
  let fixtures: HookFixtures;
  let mockServer: MockLLMServer;
  let logPath: string;

  /**
   * `echo X >> file` under cmd.exe writes `X \r\n`: the space before the
   * redirect belongs to the echoed text, and the line ending is CRLF. Reading
   * the log back as event names means trimming both, which a POSIX shell never
   * adds and therefore never hides.
   */
  function loggedEvents(log: string): string[] {
    return log
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

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
    fixtures = new HookFixtures(context.testDir);
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
    expect(loggedEvents(log)).toEqual([
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
              // `echo "..." 1>&2; exit 2` is what the case used to spell this,
              // and cmd.exe reads that as one word: nothing was blocked, the
              // reason came back inside the message. The fixture is a node
              // script with two quoted arguments, the one form both shells
              // agree on, so Windows tests the blocking hook instead of
              // testing whether cmd.exe speaks POSIX.
              command: fixtures.fail("tnt-blocked prompt", 2),
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
    expect(loggedEvents(log)).toEqual(["SessionStart", "SessionEnd"]);
  }, 30000);

  it("carries a SessionStart note into the request and names a readable transcript", async () => {
    const transcriptRecord = path.join(context.testDir, "transcript-seen.txt");
    const scriptPath = path.join(context.testDir, "sessionStartHook.cjs");
    await fs.writeFile(
      scriptPath,
      [
        'let data = "";',
        'process.stdin.on("data", (chunk) => (data += chunk));',
        'process.stdin.on("end", () => {',
        '  const input = JSON.parse(data || "{}");',
        `  require("fs").writeFileSync(${JSON.stringify(
          transcriptRecord,
        )}, input.transcript_path ?? "");`,
        '  console.log("always answer in one word");',
        "});",
      ].join("\n"),
    );
    await plantPlugin({
      SessionStart: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: `node "${scriptPath}"` }],
        },
      ],
    });

    const result = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "hi"],
      env: pluginEnv(),
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
    // The stdout of a SessionStart hook is context for the model. It was fired,
    // collected and dropped, so the hook only ever cost time.
    const userMessage = mockServer.requests[0].body.messages.find(
      (message: any) => message.role === "user",
    );
    expect(JSON.stringify(userMessage?.content)).toContain(
      "always answer in one word",
    );

    // And the transcript a hook is pointed at is the session file, which exists.
    const seen = await fs.readFile(transcriptRecord, "utf-8");
    expect(seen).toMatch(/\.jsonl$/);
    await fs.access(seen);
  }, 30000);
});
