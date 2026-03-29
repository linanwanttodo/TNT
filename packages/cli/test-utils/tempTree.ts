import fs from "fs";

/**
 * Remove a directory the run created, with the retry budget on the whole attempt
 * rather than on each path inside it.
 *
 * `rmSync`'s own `maxRetries` is applied to every entry it visits: forty tries at
 * 250ms is ten seconds *per file*, so a directory of twenty-seven grammar copies
 * cost one suite 200 seconds and it lost its hook timeout, while the lane sharing
 * the runner timed out a render poll it had passed the run before.
 *
 * A temporary directory the operating system still refuses is worth reporting and
 * not worth failing a suite over. Windows holds the directory a child process was
 * started in until it has let go of every handle on that process, and nothing the
 * caller does after the child exits speeds that up; the assertions that own the
 * behaviour have already run by the time cleanup starts, and the next run gets a
 * fresh directory either way.
 */
export async function removeTreeWithinBudget(
  dir: string,
  budgetMs = 6_000,
): Promise<Error | undefined> {
  const deadline = Date.now() + budgetMs;
  let failure: Error | undefined;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return undefined;
    } catch (error) {
      failure = error as Error;
    }
    if (Date.now() >= deadline) {
      return failure;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
