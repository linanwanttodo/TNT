import fs from "fs/promises";
import os from "os";
import path from "path";

import { execaNode, type Subprocess } from "execa";

export interface CLITestContext {
  cliPath: string;
  testDir: string;
  configPath?: string;
  sessionPath?: string;
}

export interface CLIRunOptions {
  args?: string[];
  input?: string;
  env?: Record<string, string>;
  timeout?: number;
  expectError?: boolean;
}

export interface CLIRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: Error;
}

/**
 * Creates a test context with isolated test directory
 */
export async function createTestContext(): Promise<CLITestContext> {
  // Use the wrapper script that invokes runCli(), not the raw bundle entry
  const cliPath = path.resolve("dist/tnt.js");
  // macOS reports the same directory two ways (`/var` is a link to
  // `/private/var`), and the CLI resolves the cwd it is given before it uses it.
  // Creating the harness directory in its canonical form keeps every e2e path
  // comparison about the file rather than the spelling the platform answered with.
  const testDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "tnt-test-")),
  );

  // Ensure the CLI file exists before returning the context
  try {
    await fs.access(cliPath);
  } catch {
    throw new Error(
      `CLI wrapper not found at ${cliPath}. Please run 'npm run build' first.`,
    );
  }

  return {
    cliPath,
    testDir,
  };
}

/**
 * Cleans up test context
 */
export async function cleanupTestContext(
  context: CLITestContext,
): Promise<void> {
  try {
    await fs.rm(context.testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Runs the CLI with given options
 */
export async function runCLI(
  context: CLITestContext,
  options: CLIRunOptions = {},
): Promise<CLIRunResult> {
  const {
    args = [],
    input,
    env = {},
    // 20s, not 10s: these suites spawn the CLI, a run measured up to ~8.2s in
    // isolation, and the old budget was exceeded only when the suite ran in
    // parallel - which is when a killed child surfaced as empty output.
    timeout = 20000,
    expectError = false,
  } = options;

  // Detect if this is a headless mode test (has -p flag)
  const isHeadlessTest = args.includes("-p") || args.includes("--prompt");

  const execOptions = {
    cwd: context.testDir,
    env: {
      ...process.env,
      TNT_TEST: "true",
      HOME: context.testDir,
      // Windows-specific home directory variables
      USERPROFILE: context.testDir,
      HOMEDRIVE: path.parse(context.testDir).root,
      HOMEPATH: path.relative(
        path.parse(context.testDir).root,
        context.testDir,
      ),
      // Mark as TTY-less for headless tests to prevent stdin reading
      ...(isHeadlessTest ? { FORCE_NO_TTY: "true" } : {}),
      ...env,
    },
    timeout,
    reject: false,
    input,
  };

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let error: any;
  // A run the helper killed. Measured through this exact call path, execa marks
  // it on the *resolved* result (`timedOut`, `isTerminated`, `signal: SIGTERM`,
  // `exitCode: undefined`), and reporting it as an empty successful run is what
  // made slow spawns look like product failures. Decided outside the try/catch:
  // a throw made inside the `try` is swallowed by the `expectError` branch.
  let killed = false;

  try {
    // Run the wrapper via Node for cross-platform consistency.
    //
    // `buffer: false` because execa only hands its collected output back when
    // the child is gone, and a run killed at its timeout never gets there: every
    // `timed out ... (partial output: )` this suite has printed reads as though
    // the CLI said nothing, whether it hung at startup or streamed for
    // 29 seconds and stopped. Reading the pipes as they fill is the only way the
    // timeout message can say where the run stopped, and it makes these two
    // strings the single source rather than a second copy that agrees sometimes.
    const subprocess = execaNode(context.cliPath, args, {
      ...execOptions,
      buffer: false,
    });
    subprocess.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    subprocess.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const result = await subprocess;
    exitCode = result.exitCode ?? 0;
    killed = result.timedOut === true || result.isTerminated === true;
  } catch (thrown: any) {
    if (!expectError) {
      throw thrown;
    }
    exitCode = thrown.exitCode ?? 1;
    error = thrown;
    killed = thrown.timedOut === true || thrown.isTerminated === true;
  }

  if (killed) {
    throw new Error(
      `tnt ${args.join(" ")} timed out after ${timeout}ms\n` +
        `  stdout (${stdout.length} chars): ${stdout.slice(0, 400)}\n` +
        `  stderr (${stderr.length} chars): ${stderr.slice(0, 400)}`,
    );
  }

  return error === undefined
    ? { stdout, stderr, exitCode }
    : { stdout, stderr, exitCode, error };
}

/**
 * Creates a test configuration file
 */
export async function createTestConfig(
  context: CLITestContext,
  config: any,
): Promise<string> {
  const configPath = path.join(context.testDir, "test-config.yaml");
  const configContent =
    typeof config === "string" ? config : JSON.stringify(config, null, 2);

  await fs.writeFile(configPath, configContent);
  context.configPath = configPath;

  return configPath;
}

/**
 * Creates a test rule file
 */
export async function createTestRule(
  context: CLITestContext,
  ruleName: string,
  content: string,
): Promise<string> {
  const rulePath = path.join(context.testDir, `${ruleName}.md`);
  await fs.writeFile(rulePath, content);
  return rulePath;
}

/**
 * Reads the session file if it exists
 */
export async function readSession(
  context: CLITestContext,
): Promise<any | null> {
  try {
    const sessionRoot = path.join(context.testDir, ".tnt", "sessions");
    const entries = await fs.readdir(sessionRoot, { withFileTypes: true });

    const candidates: Array<{ path: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const transcript = path.join(sessionRoot, entry.name, "session.jsonl");
        try {
          candidates.push({
            path: transcript,
            mtimeMs: (await fs.stat(transcript)).mtimeMs,
          });
        } catch {
          // A directory without a transcript is a half-created session.
        }
      } else if (
        entry.name.endsWith(".json") &&
        entry.name !== "sessions.json"
      ) {
        const legacy = path.join(sessionRoot, entry.name);
        candidates.push({
          path: legacy,
          mtimeMs: (await fs.stat(legacy)).mtimeMs,
        });
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    const newest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    const content = await fs.readFile(newest.path, "utf-8");

    if (!newest.path.endsWith(".jsonl")) {
      return JSON.parse(content);
    }

    const session: any = { sessionId: "", history: [], usage: undefined };
    const byId = new Map<string, number>();
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === "session") {
        session.sessionId = record.sessionId;
      } else if (record.type === "message") {
        byId.set(record.messageId, session.history.length);
        session.history.push(record.item);
      } else if (record.type === "message-patch") {
        const index = byId.get(record.messageId);
        if (index !== undefined) session.history[index] = record.item;
      } else if (record.type === "snapshot" || record.type === "compaction") {
        session.history = record.history;
        byId.clear();
        session.history.forEach((item: any, index: number) => {
          if (item?.messageId) byId.set(item.messageId, index);
        });
      } else if (record.type === "session-info" && record.usage) {
        session.usage = record.usage;
      }
    }
    return session.sessionId ? session : null;
  } catch {
    return null;
  }
}

/**
 * Creates a mock session file
 */
export async function createMockSession(
  context: CLITestContext,
  messages: any[],
): Promise<string> {
  const sessionDir = path.join(context.testDir, ".tnt", "sessions");
  await fs.mkdir(sessionDir, { recursive: true });

  const sessionId = `test-session-${Date.now()}`;
  const sessionPath = path.join(sessionDir, `${sessionId}.json`);

  const session = {
    id: sessionId,
    timestamp: new Date().toISOString(),
    messages,
    config: {},
  };

  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  context.sessionPath = sessionPath;

  return sessionPath;
}

/**
 * Waits for a pattern in the output
 */
export function waitForPattern(
  proc: Subprocess,
  pattern: RegExp | string,
  timeout: number = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout waiting for pattern: ${pattern}`));
    }, timeout);

    const checkOutput = (data: string) => {
      output += data;
      const match =
        typeof pattern === "string"
          ? output.includes(pattern)
          : pattern.test(output);

      if (match) {
        clearTimeout(timer);
        resolve(output);
      }
    };

    proc.stdout?.on("data", checkOutput);
    proc.stderr?.on("data", checkOutput);
  });
}

/**
 * Simulates user input in interactive mode
 */
export async function withInteractiveInput(
  context: CLITestContext,
  args: string[],
  inputs: string[],
): Promise<CLIRunResult> {
  const proc = execaNode(context.cliPath, args, {
    cwd: context.testDir,
    env: {
      ...process.env,
      TNT_TEST: "true",
      HOME: context.testDir,
      // Windows-specific home directory variables
      USERPROFILE: context.testDir,
      HOMEDRIVE: path.parse(context.testDir).root,
      HOMEPATH: path.relative(
        path.parse(context.testDir).root,
        context.testDir,
      ),
    },
  });

  let stdout = "";
  let stderr = "";

  proc.stdout?.on("data", (data) => {
    stdout += data;
  });

  proc.stderr?.on("data", (data) => {
    stderr += data;
  });

  // Send inputs sequentially
  for (const input of inputs) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay
    proc.stdin?.write(input + "\n");
  }

  // End input
  proc.stdin?.end();

  try {
    const result = await proc;
    return {
      stdout,
      stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (error: any) {
    return {
      stdout,
      stderr,
      exitCode: error.exitCode ?? 1,
      error,
    };
  }
}
