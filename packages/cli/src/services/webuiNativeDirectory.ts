import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { Express } from "express";

import { logger } from "../utils/logger.js";

/**
 * The native folder picker for the WebUI's "选择文件夹" button.
 *
 * A browser cannot open the OS file manager, but the WebUI host runs on the
 * user's desktop, so it can: this route spawns the desktop's directory
 * chooser (zenity / kdialog / yad) and hands the chosen path back to the
 * renderer. The built-in directory browser stays for remote hosts, where no
 * local desktop exists. Only fixed arguments are passed - no user input ever
 * reaches a command line.
 */

const execFileAsync = promisify(execFile);

/** A modal dialog the user may leave open; two minutes is plenty. */
const DIALOG_TIMEOUT_MS = 120_000;

const CHOOSERS: readonly { command: string; args: readonly string[] }[] = [
  {
    command: "zenity",
    args: ["--file-selection", "--directory", "--title=选择文件夹"],
  },
  {
    command: "kdialog",
    args: ["--getexistingdirectory", ".", "选择文件夹"],
  },
  {
    command: "yad",
    args: ["--file-selection", "--directory", "--title=选择文件夹"],
  },
];

let inFlight: Promise<string | null> | null = null;

interface ChooserOutcome {
  stdout?: string;
  code?: number | null;
}

function isMissingTool(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "EACCES";
}

async function runChooser(
  command: string,
  args: readonly string[],
): Promise<ChooserOutcome | undefined> {
  try {
    const result = await execFileAsync(command, [...args], {
      timeout: DIALOG_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      // The dialog needs the session's DISPLAY/WAYLAND_DISPLAY; process.env
      // carries them when the CLI was launched from the desktop session.
      env: process.env,
    });
    // Node's execFile has a custom promisify symbol ({stdout, stderr}); a
    // plain promisified callback resolves the first value (the string). Both
    // shapes are accepted so the chooser works under either wrapper.
    const output =
      typeof result === "string"
        ? result
        : ((result as { stdout?: string } | undefined)?.stdout ?? "");
    return { stdout: output };
  } catch (error) {
    const failure = error as {
      code?: number | string | null;
      signal?: string | null;
      killed?: boolean;
      message?: string;
    };
    // Cancelled dialogs exit non-zero with no output; that is a real user
    // decision, not a failure to try the next chooser. A dialog the desktop
    // closed (SIGTERM) is the same decision.
    if (typeof failure.code === "number") return { code: failure.code };
    if (failure.killed || failure.signal) return { code: 1 };
    if (isMissingTool(error)) return undefined;
    // zenity exists but cannot open (no DISPLAY, broken portal): say which
    // chooser failed instead of pretending none is installed.
    throw new Error(
      `Native directory chooser ${command} failed: ${failure.message ?? String(error)}`,
    );
  }
}

async function selectNativeDirectory(): Promise<string | null> {
  for (const chooser of CHOOSERS) {
    const outcome = await runChooser(chooser.command, chooser.args);
    if (outcome === undefined) continue;
    if (outcome.code !== undefined) return null;
    const chosen = outcome.stdout?.trim().split("\n")[0]?.trim();
    if (!chosen) return null;
    const absolute = path.resolve(chosen);
    try {
      if (!fs.statSync(absolute).isDirectory()) return null;
    } catch {
      return null;
    }
    return absolute;
  }
  throw new Error(
    "No native directory chooser is available (zenity, kdialog or yad). Install one or use a desktop session with a display server.",
  );
}

/** One dialog at a time: a second click must not open two modal windows. */
export function requestNativeDirectory(): Promise<string | null> {
  if (!inFlight) {
    inFlight = selectNativeDirectory().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Token-gated by the WebUI auth middleware registered before this route. */
export function registerWebUiNativeDirectoryRoute(app: Express): void {
  app.post("/api/select-directory", async (_req, res) => {
    try {
      const selected = await requestNativeDirectory();
      res.setHeader("Cache-Control", "no-store");
      res.json({ path: selected });
    } catch (error) {
      logger.warn("Native directory selection unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(501).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
