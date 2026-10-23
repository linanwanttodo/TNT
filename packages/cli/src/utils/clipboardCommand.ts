import { spawn } from "node:child_process";

interface ClipboardCommandOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
}

/**
 * Run a clipboard helper without a shell and return its stdout bytes.
 * Undefined means the command was missing, timed out, or exited non-zero; an
 * empty Buffer is a successful empty answer.
 */
export function runClipboardCommand(
  command: string,
  args: readonly string[],
  options: ClipboardCommandOptions = {},
): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve(undefined);
      return;
    }

    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const finish = (result: Buffer | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const abort = (): void => {
      child.kill("SIGKILL");
      child.stdout?.destroy();
      finish(undefined);
    };
    const timer = setTimeout(abort, options.timeoutMs ?? 3000);

    child.on("error", () => finish(undefined));
    child.on("close", (code) => {
      if (!settled) {
        finish(code === 0 ? Buffer.concat(chunks, length) : undefined);
      }
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > (options.maxBufferBytes ?? 50 * 1024 * 1024)) {
        abort();
      } else {
        chunks.push(chunk);
      }
    });
  });
}
