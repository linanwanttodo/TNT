import { zcodeProtocolMethods } from "@zcode/shared";

import { AppServerProtocol } from "../appServer/protocol.js";
import { SessionRegistry } from "../appServer/sessionRegistry.js";
import { NdjsonTransport } from "../appServer/transport.js";

export interface AppServerCommandOptions {
  stdio?: boolean;
}

const SILENT_CONSOLE_METHODS = [
  "log",
  "info",
  "debug",
  "trace",
  "table",
  "dir",
  "dirxml",
  "group",
  "groupCollapsed",
  "groupEnd",
] as const;

function silenceConsole(): void {
  for (const method of SILENT_CONSOLE_METHODS) {
    (console as unknown as Record<string, unknown>)[method] = () => undefined;
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

  silenceConsole();

  const registry = new SessionRegistry();
  const transport = new NdjsonTransport({
    input: process.stdin,
    output: process.stdout,
  });
  const protocol = new AppServerProtocol(transport, registry);

  await new Promise<void>((resolve) => {
    let shuttingDown = false;

    const finalize = async (): Promise<void> => {
      try {
        await transport.send({
          method: zcodeProtocolMethods.sessionLifecycleChanged,
          params: registry.beginShutdown(),
        });
      } catch {
        // stdout is gone, so the notification cannot be delivered.
      }
      transport.stop();
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
      onMessage: (message) => {
        void protocol.handle(message);
      },
      onLineError: (error) => {
        void protocol.handleMalformed(error);
      },
      onEnd: shutdown,
    });
  });

  process.exit(0);
}
