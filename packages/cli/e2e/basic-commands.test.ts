import { readFileSync } from "fs";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";

/**
 * `getVersion()` resolves package.json relative to `src/startup/`, where there
 * is none, so it returns its "unknown" fallback while the bundle returns the
 * real version. Read the version the bundle is built from instead.
 */
function bundledVersion(): string {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  };
  return version;
}

describe("E2E: Basic Commands", () => {
  let context: any;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  describe("--version flag", () => {
    it("should display version information", async () => {
      const result = await runCLI(context, { args: ["--version"] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(bundledVersion());
      expect(result.stderr).toBe("");
    });
  });

  describe("--help flag", () => {
    it("should display help information", async () => {
      const result = await runCLI(context, { args: ["--help"] });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("TNT");
      expect(result.stdout).toContain("AI-powered development assistant");
      expect(result.stdout).toContain("Options:");
      expect(result.stdout).toContain("-p, --print");
      expect(result.stdout).toContain("--config <path>");
      expect(result.stdout).toContain("--resume");
      expect(result.stdout).toContain("--readonly");
      expect(result.stdout).toContain("--auto");
      expect(result.stdout).toContain("--rule <rule>");
      expect(result.stdout).toContain("--prompt <prompt>");
    });

    it("should show available commands", async () => {
      const result = await runCLI(context, { args: ["--help"] });

      expect(result.stdout).toContain("Commands:");
    });
  });

  describe("invalid commands", () => {
    it("should show error for invalid flag", async () => {
      const result = await runCLI(context, {
        args: ["--invalid-flag"],
        expectError: true,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr || result.stdout).toContain("error");
    });
  });

  it("explains a rejected --max-steps instead of exiting silently", async () => {
    // It used to throw inside commander's coercion, and commander's own error
    // path never reached the terminal: the run exited 1 with nothing printed.
    const result = await runCLI(context, {
      args: ["-p", "--max-steps", "0", "hi"],
      expectError: true,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "--max-steps expects a whole number",
    );
  });

  it("refuses an unusable serve port instead of binding it", async () => {
    const result = await runCLI(context, {
      args: ["serve", "--port", "abc"],
      expectError: true,
    });

    // The point of the check is that a mistyped flag fails as a named flag
    // error: exit before binding, and say which value was rejected.
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "--port expects a whole number",
    );
    expect(`${result.stdout}\n${result.stderr}`).toContain('"abc"');
  });
  it("refuses a review format it cannot honor", async () => {
    // `--format` is also a root flag, and the subcommand copy of the value was
    // dropped on the way to the action, so a typo used to review as text in
    // silence and `json` never reached the command at all.
    const result = await runCLI(context, {
      args: ["review", "--format", "bogus"],
      expectError: true,
    });

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Unsupported --format "bogus" for tnt review',
    );
  });
  it("says a spawned CLI timed out instead of returning empty output", async () => {
    const context = await createTestContext();
    try {
      await expect(
        runCLI(context, {
          args: ["--version"],
          timeout: 1,
          expectError: true,
        }),
      ).rejects.toThrow(/timed out after 1ms/);
    } finally {
      await cleanupTestContext(context);
    }
  });
});
