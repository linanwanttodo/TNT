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
    // The v2 store keeps one directory per session, with an append-only
    // transcript inside. `sessions/<id>.json` plus a `sessions.json` index is
    // the v1 layout this test was written against, and listing no longer reads
    // it - so the fixture has to be a real v2 session, not a legacy file.
    const sessionRoot = path.join(globalDir, "sessions", "e2e-listed-session");
    fs.mkdirSync(sessionRoot, { recursive: true });

    const sessionId = "e2e-listed-session";
    const now = new Date().toISOString();
    const header = {
      type: "session",
      version: 2,
      sessionId,
      createdAt: now,
      cwd: context.testDir,
      title: "written by the e2e",
      source: "cli",
    };
    // A transcript with only its header is a session with no conversation, and
    // listing leaves it out - so the fixture has to carry one message.
    const message = {
      type: "message",
      messageId: "e2e-message-1",
      item: {
        messageId: "e2e-message-1",
        message: { role: "user", content: "written by the e2e" },
        contextItems: [],
      },
    };
    fs.writeFileSync(
      path.join(sessionRoot, "session.jsonl"),
      `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`,
    );

    const result = await runCLI(context, {
      args: ["ls", "--json"],
      env: { TNT_GLOBAL_DIR: globalDir },
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
      env: { TNT_GLOBAL_DIR: globalDir },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { sessions: unknown[] };
    expect(Array.isArray(parsed.sessions)).toBe(true);
  }, 60000);

  it("answers an empty store with an empty list, not with the picker", async () => {
    // No `sessions/` directory at all: a machine that has never run a chat. The JSON
    // contract has to hold here too, because a script parsing stdout cannot tell an
    // empty listing from a rendered picker.
    const globalDir = path.join(context.testDir, ".tnt");
    fs.mkdirSync(globalDir, { recursive: true });

    const result = await runCLI(context, {
      args: ["ls", "--json"],
      env: { TNT_GLOBAL_DIR: globalDir },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ sessions: [] });
  }, 60000);
});
