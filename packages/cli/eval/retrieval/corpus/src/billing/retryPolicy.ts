/**
 * Retries a call whose transient failure is worth another try. The wait doubles
 * per attempt and stops at the ceiling, so a gateway that is down for good
 * costs a bounded number of requests rather than an unbounded loop.
 */
export const MAX_ATTEMPTS = 4;
export const BASE_DELAY_MS = 50;

export async function withBackoff<T>(
  call: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
