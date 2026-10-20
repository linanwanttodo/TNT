import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";

/**
 * `tnt review --review-agents org/agent-name` used to get as far as a review worker,
 * where the hub-shaped string was handed to `fs.readFileSync` and died with ENOENT
 * inside a worktree - after a diff and a spinner, with nothing telling the user which
 * forms do work. Hub resolution is gone (`resolveFromHub()` returns `[]`), so the
 * command refuses the value up front. Only the refusal is exercised end-to-end; the
 * local forms pass the same guard by definition (`isLocalPath`, unit-tested beside
 * `resolveReviews`), and running one of them here would spawn a real review worker.
 */
describe("E2E: review agent sources", () => {
  let context: any;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  it("refuses a hub-shaped agent instead of failing inside the worker", async () => {
    const result = await runCLI(context, {
      args: ["review", "--review-agents", "org/agent-name"],
    });

    expect(result.exitCode).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("hub reviews are not available");
    expect(output).toContain(".tnt/agents/my-review.md");
    expect(output).toContain("org/agent-name");
  }, 60000);
});
