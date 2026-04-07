/**
 * Deliver keystrokes to an ink tree and wait for the frame they must produce.
 *
 * `ink-testing-library`'s mock stdin can swallow a write that lands while React
 * is still committing the previous update; on a loaded Windows runner that is a
 * dropped byte roughly one run in three, and the assertion then reads like a
 * broken feature when only the delivery was broken. A terminal re-sends what got
 * missed, so this does too - at most three times, and it still fails with the
 * last frame when the behaviour itself is wrong.
 *
 * `keys` is written in one burst when it is an array: two Escapes inside the
 * 500ms window a double press is defined by cannot be separated by a wait.
 */
export const tick = (ms = 80) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pressUntil(
  tree: {
    stdin: { write: (key: string) => void };
    lastFrame: () => string | undefined;
  },
  keys: string | readonly string[],
  want: (frame: string) => boolean,
  options: { attempts?: number; deliverMs?: number } = {},
): Promise<string> {
  const attempts = options.attempts ?? 3;
  const deliverMs = options.deliverMs ?? 1_500;
  let lastFrame = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await tick(150);
    }
    for (const key of typeof keys === "string" ? [keys] : keys) {
      tree.stdin.write(key);
    }
    const deadline = Date.now() + deliverMs;
    while (Date.now() < deadline) {
      lastFrame = tree.lastFrame() ?? "";
      if (want(lastFrame)) {
        return lastFrame;
      }
      await tick(25);
    }
  }
  throw new Error(
    `keystroke ${JSON.stringify(keys)} never produced its frame within ${attempts} deliveries\n` +
      `  last frame: ${lastFrame.split("\n")[0] ?? "(empty)"}`,
  );
}

/**
 * The same delivery loop for a condition that is not visible in the frame - a
 * callback the component called, a list it filled. The frame is still carried
 * into the error message.
 */
export async function pressUntilMet(
  tree: {
    stdin: { write: (key: string) => void };
    lastFrame: () => string | undefined;
  },
  keys: string | readonly string[],
  met: () => boolean,
  options: { attempts?: number; deliverMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 3;
  const deliverMs = options.deliverMs ?? 1_500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await tick(150);
    }
    for (const key of typeof keys === "string" ? [keys] : keys) {
      tree.stdin.write(key);
    }
    const deadline = Date.now() + deliverMs;
    while (Date.now() < deadline) {
      if (met()) {
        return;
      }
      await tick(25);
    }
  }
  throw new Error(
    `keystroke ${JSON.stringify(keys)} never produced its effect within ${attempts} deliveries\n` +
      `  last frame: ${(tree.lastFrame() ?? "").split("\n")[0] || "(empty)"}`,
  );
}

/** Poll a condition without a keystroke, for effects that settle on their own. */
export async function until(
  want: () => boolean,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!want() && Date.now() < deadline) {
    await tick(25);
  }
}
