import fs from "fs";
import path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";

/**
 * `tnt ls --format json` is the machine-readable half of the session picker, and it
 * was only ever exercised against a mocked `listSessions`: the unit test stubs the
 * listing and asserts what the command prints. This runs the built CLI against real
 * files in an isolated global directory, so the flag, the on-disk index and the JSON
 * contract are proven together.
 */
describe("E2E: ls --format json", () => {
  let context: any;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  it("lists a session that exists on disk", async () => {
    const globalDir = path.join(context.testDir, ".tnt");
    const sessionDir = path.join(globalDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });

    const sessionId = "e2e-listed-session";
    fs.writeFileSync(
      path.join(sessionDir, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        title: "written by the e2e",
        workspaceDirectory: context.testDir,
        history: [],
      }),
    );
    fs.writeFileSync(
      path.join(sessionDir, "sessions.json"),
      JSON.stringify([
        {
          sessionId,
          title: "written by the e2e",
          workspaceDirectory: context.testDir,
          dateCreated: Date.now(),
        },
      ]),
    );

    const result = await runCLI(context, {
      args: ["ls", "--json"],
      env: { CONTINUE_GLOBAL_DIR: globalDir },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      sessions: { id: string; title?: string }[];
    };
    expect(Array.isArray(parsed.sessions)).toBe(true);
    const listed = parsed.sessions.find((s) => s.id === sessionId);
    expect(listed).toBeDefined();
    expect(listed?.title).toBe("written by the e2e");
  }, 60000);

  it("honours the root --format json, which used to open the picker instead", async () => {
    // Before this wiring, `tnt ls --format json` was accepted by the root parser,
    // ignored by the subcommand, and rendered the interactive selector onto stdout -
    // the first version of this file failed parsing a frame that began with "╭".
    const globalDir = path.join(context.testDir, ".tnt");
    fs.mkdirSync(path.join(globalDir, "sessions"), { recursive: true });

    const result = await runCLI(context, {
      args: ["ls", "--format", "json"],
      env: { CONTINUE_GLOBAL_DIR: globalDir },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { sessions: unknown[] };
    expect(Array.isArray(parsed.sessions)).toBe(true);
  }, 60000);
});
