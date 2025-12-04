import fs from "fs";
import path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";

/**
 * `checks` had no end-to-end coverage at all: its PR detection and its refusal ran
 * only inside a hand probe. Outside a git repository there is no branch to map to a
 * pull request, and the command must say so and exit non-zero instead of printing an
 * empty status list or attempting a request with no PR.
 *
 * The case needs no network: detection fails before anything is fetched.
 */
describe("E2E: checks outside a repository", () => {
  let context: any;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  it("explains that no PR could be detected and exits non-zero", async () => {
    const globalDir = path.join(context.testDir, ".tnt");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ locale: "en" }),
    );

    const result = await runCLI(context, {
      args: ["checks"],
      env: { CONTINUE_GLOBAL_DIR: globalDir },
      timeout: 30000,
    });

    expect(result.exitCode).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("Auto-detecting PR from current branch");
    expect(output).toContain("Could not detect a PR");
    expect(output).toContain("Please provide a PR URL");
  }, 60000);
});
