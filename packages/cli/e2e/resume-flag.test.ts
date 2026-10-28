import * as fs from "fs/promises";
import * as path from "path";

import {
  cleanupTestContext,
  createTestContext,
  readSession,
  runCLI,
} from "../test-utils/cli-helpers.js";
import {
  cleanupMockLLMServer,
  setupMockLLMTest,
  type MockLLMServer,
} from "../test-utils/mock-llm-server.js";

/**
 * The v2 store keeps each session in its own directory as `session.jsonl`; the
 * `sessions/<id>.json` plus `sessions.json` layout these assertions were written
 * against is gone, which is why they read an empty list. Counting session roots
 * replaces the old "one .json file" claim with the same statement in the current
 * layout.
 */
async function sessionCount(context: any): Promise<number> {
  const root = path.join(context.testDir, ".tnt", "sessions");
  let entries: any[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  const listed = entries.filter((entry) => entry.isDirectory());
  const withTranscripts = await Promise.all(
    listed.map(async (entry) => {
      try {
        await fs.stat(path.join(root, entry.name, "session.jsonl"));
        return true;
      } catch {
        return false;
      }
    }),
  );
  return withTranscripts.filter(Boolean).length;
}

describe("E2E: Resume Flag", () => {
  let context: any;
  let mockServer: MockLLMServer;

  beforeEach(async () => {
    context = await createTestContext();
    mockServer = await setupMockLLMTest(context, {
      response: "Hello! Nice to meet you.",
    });
  });

  afterEach(async () => {
    await cleanupMockLLMServer(mockServer);
    await cleanupTestContext(context);
  });

  it("should resume from previous session when using --resume flag", async () => {
    // First, run a chat session with a single message
    const firstResult = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "hello"],
      env: {
        // Use a fixed session ID so both CLI calls use the same session
        TNT_TEST_SESSION_ID: "test-session-123",
        TNT_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
      },
      timeout: 15000,
    });

    // Verify the first session completed successfully
    expect(firstResult.exitCode).toBe(0);
    expect(firstResult.stdout).toContain("Hello! Nice to meet you.");

    // Verify that one session was written, then read it back through the store's
    // own layout instead of globbing the directory.
    expect(await sessionCount(context)).toBe(1);

    const sessionData = await readSession(context);
    expect(sessionData).not.toBeNull();
    expect(sessionData.sessionId).toBe("test-session-123");
    expect(sessionData.history.length).toBeGreaterThan(0);

    // Should contain the user message and assistant response
    const userMessage = sessionData.history.find(
      (msg: any) => msg.message?.role === "user",
    );
    const assistantMessage = sessionData.history.find(
      (msg: any) => msg.message?.role === "assistant",
    );

    expect(userMessage?.message?.content).toBe("hello");
    expect(assistantMessage?.message?.content).toBe("Hello! Nice to meet you.");

    // Now run with --resume flag using the same session ID
    // Use -p flag to run in headless mode (tests don't have TTY)
    const resumeResult = await runCLI(context, {
      args: ["-p", "--resume", "--config", context.configPath],
      env: {
        TNT_TEST_SESSION_ID: "test-session-123",
        TNT_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
      },
      timeout: 15000,
    });

    // The resume command should complete successfully
    expect(resumeResult.exitCode).toBe(0);

    // In headless mode with no new prompt, it should just show existing messages
    // This is a simplification for the test - the behavior may vary based on implementation
  }, 30000);

  it("should handle --resume when no previous session exists", async () => {
    // Try to resume without any previous session
    // Use -p flag to run in headless mode (tests don't have TTY)
    const result = await runCLI(context, {
      args: ["-p", "--resume", "--config", context.configPath],
      env: {
        TNT_TEST_SESSION_ID: "no-session-456",
        TNT_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
      },
      timeout: 15000,
    });

    // Should handle gracefully (either start new session or show appropriate message)
    expect(result.exitCode).toBe(0);
  }, 20000);

  it("should resume and allow new messages to be added", async () => {
    // Setup mock to return different responses for different calls
    let responseCount = 0;

    // Clean up current server first
    await cleanupMockLLMServer(mockServer);

    // Wait a bit to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create new server with dynamic response
    mockServer = await setupMockLLMTest(context, {
      response: (prompt: string) => {
        responseCount++;
        if (responseCount === 1) {
          return "First response";
        } else {
          return "Second response";
        }
      },
    });

    const sessionId = "test-session-789";

    // First session
    const firstResult = await runCLI(context, {
      args: ["-p", "--config", context.configPath, "first message"],
      env: {
        TNT_TEST_SESSION_ID: sessionId,
        TNT_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
      },
      timeout: 15000,
    });

    expect(firstResult.exitCode).toBe(0);
    expect(firstResult.stdout).toContain("First response");

    // Verify the first session was saved correctly
    expect(await sessionCount(context)).toBe(1);
    const saved = await readSession(context);
    expect(saved).not.toBeNull();
    expect(saved.history).toHaveLength(2);

    // Resume and add a new message with the SAME session ID
    const resumeResult = await runCLI(context, {
      args: [
        "--resume",
        "-p",
        "--config",
        context.configPath,
        "second message",
      ],
      env: {
        TNT_TEST_SESSION_ID: sessionId,
        TNT_GLOBAL_DIR: path.join(context.testDir, ".tnt"),
      },
      timeout: 15000,
    });

    expect(resumeResult.exitCode).toBe(0);
    // Should show the new response
    expect(resumeResult.stdout).toContain("Second response");

    // Verify the new-session run (prompt + title) and the resume run (prompt)
    expect(mockServer.requests).toHaveLength(3);

    // Check that the same session now carries both exchanges
    expect(await sessionCount(context)).toBe(1);
    const sessionData = await readSession(context);

    const userMessages = sessionData.history.filter(
      (msg: any) => msg.message?.role === "user",
    );
    const assistantMessages = sessionData.history.filter(
      (msg: any) => msg.message?.role === "assistant",
    );

    expect(userMessages).toHaveLength(2);
    expect(assistantMessages).toHaveLength(2);
    expect(userMessages[0].message?.content).toBe("first message");
    expect(userMessages[1].message?.content).toBe("second message");
    expect(assistantMessages[0].message?.content).toBe("First response");
    expect(assistantMessages[1].message?.content).toBe("Second response");
  }, 30000);
});
