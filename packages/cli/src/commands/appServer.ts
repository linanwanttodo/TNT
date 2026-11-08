import { Writable } from "node:stream";

import { zcodeProtocolMethods } from "@zcode/shared";

import { AppServerProtocol } from "../appServer/protocol.js";
import { SessionRegistry } from "../appServer/sessionRegistry.js";
import { NdjsonTransport } from "../appServer/transport.js";
import { safeStdoutRaw } from "../startup/init.js";
import { flushStream } from "../utils/exit.js";

export interface AppServerCommandOptions {
  stdio?: boolean;
}

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
  const protocol = new AppServerProtocol(transport, registry);
  const inflight = new Set<Promise<void>>();

  const track = (operation: Promise<void>): void => {
    const tracked = operation.catch(() => undefined);
    inflight.add(tracked);
    void tracked.finally(() => {
      inflight.delete(tracked);
    });
  };

  await new Promise<void>((resolve) => {
    let shuttingDown = false;

    const finalize = async (): Promise<void> => {
      const lifecycle = registry.beginShutdown();
      transport.stop();
      await Promise.all([...inflight]);
      try {
        await transport.send({
          method: zcodeProtocolMethods.sessionLifecycleChanged,
          params: lifecycle,
        });
      } catch {
        // stdout is gone, so the notification cannot be delivered.
      }
      await transport.flush();
      await flushStream(process.stdout);
      resolve();
    };

    const shutdown = (): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      void finalize();
    };

    process.removeAllListeners("SIGINT");
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    transport.start({
      onMessage: (message) => track(protocol.handle(message)),
      onLineError: (error) => track(protocol.handleMalformed(error)),
      onEnd: shutdown,
    });
  });

  process.exit(0);
}
