import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";

/**
 * `--format` belongs to the root parser, so commander accepts it on every
 * subcommand whether or not that command can honour it. `review` already refuses a
 * value it does not implement; `checks` printed its text report for any value and
 * said nothing, which is the same silence that made `tnt ls --format json` open the
 * interactive picker. This pins the refusal, and it needs no auth or network: the
 * check runs before the command does anything.
 */
describe("E2E: checks --format", () => {
  let context: any;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  it("refuses a format it cannot honour instead of printing text", async () => {
    const result = await runCLI(context, {
      args: ["checks", "--format", "json"],
      timeout: 30000,
    });

    expect(result.exitCode).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('Unsupported --format "json" for tnt checks');
    expect(output).toContain("Expected: text");
  }, 60000);
});
