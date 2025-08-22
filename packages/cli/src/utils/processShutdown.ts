import { logger } from "./logger.js";

/**
 * Callbacks that run when the process shuts down, keyed by owner.
 *
 * A service that registers its own `process` listeners in a constructor
 * leaves them attached for the life of the process, so a second instance
 * stacks a second set: Node reports a listener leak, earlier instances are
 * never released, and their teardown runs for a service nobody uses. Here the
 * listeners are attached once, and registering the same key again replaces its
 * callback, so the live instance is the one that gets cleaned up.
 */
const callbacks = new Map<string, () => void>();
let listenersAttached = false;

/** Runs every registered callback, in registration order. */
export function runShutdownCallbacks(): void {
  for (const [key, callback] of callbacks) {
    try {
      callback();
    } catch (error) {
      // A failing teardown must not keep the others from running.
      logger.debug(`Shutdown callback failed: ${key}`, error as Error);
    }
  }
}

export function registerShutdownCallback(
  key: string,
  callback: () => void,
): void {
  callbacks.set(key, callback);

  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(signal, runShutdownCallbacks);
  }
}
