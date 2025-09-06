import { readFileSync } from "fs";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../src/test-utils/cli-helpers.js";

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
});
