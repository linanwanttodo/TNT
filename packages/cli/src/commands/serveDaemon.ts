import * as fs from "node:fs";
import * as path from "node:path";

import chalk from "chalk";

import { globalDir, globalDirOverride } from "../config/globalDir.js";
import { t } from "../i18n/index.js";
import { WEBUI_TOKEN_FILE } from "../services/webuiAuth.js";
import { webUiService } from "../services/WebUiService.js";
import type { WebUiHandle } from "../services/webuiTypes.js";
import { safeStderr } from "../startup/init.js";
import { hyperlink } from "../ui/hyperlink.js";
import { logger } from "../utils/logger.js";

import { validateWebuiHost } from "./webui.js";

/** The handshake contract these clients rely on. Bump only on a breaking change. */
export const SERVE_PROTOCOL_VERSION = 1;

export interface ServeDaemonOptions {
  /** First port to bind; 0 asks the OS for an ephemeral port. */
  port?: string | number;
  /** Loopback address. Only 127.0.0.1 and localhost are accepted. */
  host?: string;
  /** Workspace to serve; defaults to the process working directory. */
  workspace?: string;
  /** Print exactly one handshake line to stdout after listening. */
  json?: boolean;
  /** Write the same handshake atomically to this file. */
  handshakeFile?: string;
  /** Commander sets this to false for `--no-tui`. */
  tui?: boolean;
  /** Config file for the lazy initialization the first connection triggers. */
  config?: string;
}

export interface ServeHandshake {
  type: "tnt-serve";
  protocol: typeof SERVE_PROTOCOL_VERSION;
  pid: number;
  port: number;
  url: string;
  wsUrl: string;
  tokenFile: string;
  workspace: string;
}

/**
 * The daemon is selected by the flags it alone owns, so the pre-existing
 * `tnt serve` HTTP surface keeps its old invocation and payloads. A host
 * adapter always passes one of these (normally `--json`).
 */
export function isServeDaemonMode(options: {
  json?: boolean;
  handshakeFile?: string;
  workspace?: string;
  tui?: boolean;
}): boolean {
  return (
    options.json === true ||
    options.handshakeFile !== undefined ||
    options.workspace !== undefined ||
    options.tui === false
  );
}

export function parseDaemonPort(
  raw: string | number | undefined,
): { ok: true; port: number } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, port: 0 };
  }
  const value =
    typeof raw === "number"
      ? raw
      : /^\d+$/.test(raw.trim())
        ? Number(raw)
        : Number.NaN;
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    return {
      ok: false,
      error: t("serveDaemon.badPort", { value: String(raw) }),
    };
  }
  return { ok: true, port: value };
}

/**
 * Resolve the served workspace to the absolute path the process will hold as
 * its cwd. The handshake and `/api/server-info` both report this exact value,
 * so a symlinked worktree cannot make them disagree.
 */
export function resolveDaemonWorkspace(raw?: string): string {
  const absolute = path.resolve(raw ?? process.cwd());
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) {
    throw new Error(t("serveDaemon.badWorkspace", { path: absolute }));
  }
  return fs.realpathSync(absolute);
}

/**
 * Write the handshake with a same-directory temp file and a rename: a client
 * polling the path sees either the previous complete document or this one,
 * never a partial write.
 */
export function writeHandshakeFile(
  file: string,
  handshake: ServeHandshake,
): void {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, `${JSON.stringify(handshake)}\n`, { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // The temp file is gone or was never created.
    }
    throw error;
  }
  try {
    // The mode option does not survive an existing file on every platform.
    fs.chmodSync(target, 0o600);
  } catch {
    // Windows and sandboxes without chmod still get a usable handshake file.
  }
}

export function buildServeHandshake(input: {
  port: number;
  workspace: string;
  tokenFile: string;
}): ServeHandshake {
  return {
    type: "tnt-serve",
    protocol: SERVE_PROTOCOL_VERSION,
    pid: process.pid,
    port: input.port,
    url: `http://127.0.0.1:${input.port}`,
    wsUrl: `ws://127.0.0.1:${input.port}/ws`,
    tokenFile: input.tokenFile,
    workspace: input.workspace,
  };
}

/** Keep an older token file at the same 0600 the creation path enforces. */
function enforceTokenFileMode(tokenFile: string): void {
  try {
    fs.chmodSync(tokenFile, 0o600);
  } catch {
    // Windows and sandboxes without chmod still get a usable token file.
  }
}

/**
 * Capture stdout for the daemon lifetime. Dependencies log without going
 * through the file logger, and a `--json` client must see the handshake as the
 * only line on the pipe. The handshake itself is written through the captured
 * writer; everything else is diverted to the log file.
 */
function muteStdoutToLog(): {
  write(text: string): void;
  restore(): void;
} {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (
    chunk: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): boolean {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
    if (text.trim().length > 0) {
      logger.info(`[stdout] ${text.replace(/\n+$/, "")}`);
    }
    const done =
      typeof encoding === "function"
        ? encoding
        : typeof callback === "function"
          ? callback
          : undefined;
    if (typeof done === "function") {
      (done as () => void)();
    }
    return true;
  } as typeof process.stdout.write;
  return {
    write(text: string): void {
      original(text);
    },
    restore(): void {
      process.stdout.write = original;
    },
  };
}

function printDaemonInfo(
  handshake: ServeHandshake,
  token: string,
  handshakeFile: string | undefined,
): void {
  const url = `${handshake.url}/#token=${token}`;
  console.log(
    chalk.green(t("serveDaemon.listening", { url: hyperlink(url, url) })),
  );
  console.log(
    chalk.dim(t("serveDaemon.workspace", { path: handshake.workspace })),
  );
  if (handshakeFile !== undefined) {
    console.log(
      chalk.dim(t("serveDaemon.handshakeFile", { path: handshakeFile })),
    );
  }
  console.log(chalk.dim(t("serveDaemon.stopHint")));
}

/**
 * `tnt serve` in daemon mode: the engine plus the web UI transport, with no
 * TUI, no browser launch, and a machine-readable handshake for a host client.
 *
 * The process stays alive until SIGINT/SIGTERM. The first signal closes the
 * WebSocket host, the workspace engines and the local services, then exits 0;
 * a second signal exits immediately so a wedged close cannot keep the process
 * around.
 */
export async function serveDaemon(options: ServeDaemonOptions): Promise<void> {
  const hostCheck = validateWebuiHost(options.host);
  if (!hostCheck.valid) {
    safeStderr(`${hostCheck.error}\n`);
    process.exitCode = 1;
    return;
  }

  const portResult = parseDaemonPort(options.port);
  if (!portResult.ok) {
    safeStderr(`${portResult.error}\n`);
    process.exitCode = 1;
    return;
  }

  let workspace: string;
  try {
    workspace = resolveDaemonWorkspace(options.workspace);
  } catch (error) {
    safeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  // Resolve the handshake path before chdir so a relative --handshake-file is
  // read against the caller's directory, not the served workspace.
  const handshakeFile = options.handshakeFile
    ? path.resolve(options.handshakeFile)
    : undefined;

  // The token file lives under the global directory. Normalize a relative
  // override before chdir, or the server and the handshake could name
  // different files.
  if (globalDirOverride() !== undefined) {
    process.env.TNT_GLOBAL_DIR = path.resolve(globalDir());
  }
  const tokenFile = path.join(path.resolve(globalDir()), WEBUI_TOKEN_FILE);

  process.chdir(workspace);

  const stdoutCapture = options.json ? muteStdoutToLog() : null;
  let handle: WebUiHandle;
  try {
    // The service container is deliberately not initialized here. The daemon
    // is a transport host, like `app-server --stdio`: the first model-list
    // read or turn brings config/model up through the shared lazy headless
    // initialization (honoring --config) and reports the existing "no chat
    // model" error when none is configured. Eager initialization would make
    // startup wait on a model/config fetch and would fail on a machine that
    // has no config yet.
    handle = await webUiService.start({
      port: portResult.port,
      persistToken: true,
      config: options.config,
    });
  } catch (error) {
    stdoutCapture?.restore();
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`serve daemon failed to start: ${reason}`);
    safeStderr(`${t("webui.startFailed", { reason })}\n`);
    process.exitCode = 1;
    return;
  }

  const handshake = buildServeHandshake({
    port: handle.port,
    workspace,
    tokenFile,
  });

  // resolveWebUiToken enforces 0600 when it creates the file; an existing file
  // from an older install may not carry it, and the handshake names this path
  // as the client's credential source.
  enforceTokenFileMode(tokenFile);

  if (handshakeFile !== undefined) {
    try {
      writeHandshakeFile(handshakeFile, handshake);
    } catch (error) {
      logger.error(
        `serve daemon could not write handshake file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      safeStderr(
        `${t("serveDaemon.badHandshakeFile", { path: handshakeFile })}\n`,
      );
      await webUiService.close();
      stdoutCapture?.restore();
      process.exitCode = 1;
      return;
    }
  }

  if (options.json) {
    // The capture stays installed: the handshake is the only line a host may
    // read from stdout for the daemon's whole lifetime.
    stdoutCapture?.write(`${JSON.stringify(handshake)}\n`);
  } else {
    printDaemonInfo(handshake, handle.token, handshakeFile);
  }

  await new Promise<void>(() => {
    let closing = false;
    let signals = 0;

    const shutdown = async (): Promise<void> => {
      signals += 1;
      if (signals > 1) {
        process.exit(0);
      }
      if (closing) {
        return;
      }
      closing = true;
      try {
        // Closing the server disposes the /ws host, every per-workspace child
        // engine and the local service bundle.
        await webUiService.close();
      } catch (error) {
        logger.warn(
          `serve daemon close failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      try {
        await logger.flush();
      } catch {
        // The log is a debugging aid; flush failure must not block exit.
      }
      process.exit(0);
    };

    // The entrypoint installs a SIGINT handler that exits with 130 before the
    // daemon can close its children; the daemon owns the process lifecycle.
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
  });
}
