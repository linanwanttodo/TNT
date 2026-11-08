import { Writable } from "node:stream";

import { zcodeProtocolMethods } from "@zcode/shared";

import { AppServerProtocol } from "../appServer/protocol.js";
import { SessionRegistry } from "../appServer/sessionRegistry.js";
import { settleWithin } from "../appServer/shutdown.js";
import { NdjsonTransport } from "../appServer/transport.js";
import { safeStdoutFlush, safeStdoutRaw } from "../startup/init.js";
import { logger } from "../utils/logger.js";

export interface AppServerCommandOptions {
  stdio?: boolean;
}

const IN_FLIGHT_TIMEOUT_MS = 5_000;
const FLUSH_TIMEOUT_MS = 500;

/**
 * Writes protocol lines through the raw stdout bypass that ACP uses, because
 * the headless interceptor has already replaced `process.stdout.write`.
 */
class StdioOutput extends Writable {
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (safeStdoutRaw(chunk)) {
      callback();
      return;
    }
    const onDrain = (): void => {
      process.stdout.off("error", onError);
      callback();
    };
    const onError = (error: Error): void => {
      process.stdout.off("drain", onDrain);
      callback(error);
    };
    process.stdout.once("drain", onDrain);
    process.stdout.once("error", onError);
  }
}

/**
 * Runs the NDJSON protocol host over stdin/stdout.
 *
 * This is a pure protocol endpoint: the headless interceptor mutes stderr
 * process-wide, so startup diagnostics and dependency logging are not written
 * anywhere. Failures that matter reach the caller as protocol error responses;
 * internal ones are logged to the process logger (and therefore usually
 * discarded) rather than printed.
 */
export async function appServer(
  options: AppServerCommandOptions,
): Promise<void> {
  if (!options.stdio) {
    process.stderr.write("app-server requires --stdio\n");
    process.exitCode = 1;
    return;
  }

  const registry = new SessionRegistry();
  const transport = new NdjsonTransport({
    input: process.stdin,
    output: new StdioOutput(),
  });
  const protocol = new AppServerProtocol(transport, registry, {
    workspacePath: process.cwd(),
  });
  const inflight = new Set<Promise<void>>();

  const track = (operation: Promise<void>): void => {
    const tracked = operation.catch((error: unknown) => {
      logger.warn("AppServer: request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    inflight.add(tracked);
    void tracked.finally(() => {
      inflight.delete(tracked);
    });
  };

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    let signalCount = 0;

    const finalize = async (): Promise<void> => {
      const lifecycle = registry.beginShutdown();
      transport.stop();
      const settled = await settleWithin(inflight, IN_FLIGHT_TIMEOUT_MS);
      if (!settled) {
        logger.warn(
          "AppServer: shutdown timed out waiting for in-flight requests",
          { timeoutMs: IN_FLIGHT_TIMEOUT_MS },
        );
      }
      protocol.dispose();
      // Written directly through the raw writer: a stalled transport write
      // chain must not delay the lifecycle notification.
      try {
        safeStdoutRaw(
          `${JSON.stringify({
            method: zcodeProtocolMethods.sessionLifecycleChanged,
            params: lifecycle,
          })}\n`,
        );
      } catch (error) {
        logger.debug("AppServer: lifecycle notification write failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await safeStdoutFlush(FLUSH_TIMEOUT_MS);
      resolve();
    };

    const beginShutdown = (): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      void finalize();
    };

    const onSignal = (): void => {
      signalCount += 1;
      if (signalCount > 1) {
        // The first signal started a bounded shutdown; a second one means the
        // caller is out of patience and wants the process gone now.
        logger.warn("AppServer: repeated signal, exiting immediately");
        process.exit(0);
      }
      beginShutdown();
    };

    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    transport.start({
      onMessage: (message) => track(protocol.handle(message)),
      onLineError: (error) => track(protocol.handleMalformed(error)),
      onEnd: beginShutdown,
    });
  });

  process.exit(0);
}
