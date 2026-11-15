import { Readable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import { safeStdoutRaw } from "../startup/init.js";

/**
 * ACP owns the process's stdin/stdout. The headless interceptor has already
 * saved the real stdout; writing through it keeps dependency logs and the
 * banner off the JSON-RPC channel.
 */
export function createStdioStream(): acp.Stream {
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      safeStdoutRaw(chunk);
    },
  });
  const input = Readable.toWeb(
    process.stdin,
  ) as unknown as ReadableStream<Uint8Array>;
  return acp.ndJsonStream(output, input);
}
