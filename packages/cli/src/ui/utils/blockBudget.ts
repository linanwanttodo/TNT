import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { getBlockOverflowDir } from "../../session/index.js";
import { logger } from "../../utils/logger.js";

/**
 * The tallest a single block of text may stand in the transcript, whatever the
 * terminal looks like. Past this the block is no longer one thing a person is
 * reading; it is a log.
 */
export const MAX_BLOCK_LINES = 40;

/**
 * What one block gets: half the terminal, capped by MAX_BLOCK_LINES, never
 * fewer than one line. The cap is what keeps a 200-row terminal from printing a
 * block taller than the answer it belongs to; the floor of one is what keeps a
 * degenerate row count from silently blanking the transcript.
 */
export function blockLineBudget(rows: number): number {
  const half = Number.isFinite(rows) ? Math.floor(rows * 0.5) : 0;
  return Math.max(1, Math.min(MAX_BLOCK_LINES, half));
}

export interface BlockPlan {
  readonly shown: readonly string[];
  readonly overflow: readonly string[];
}

/** Split a block at its budget. Everything past the budget is the overflow. */
export function planBlock(lines: readonly string[], budget: number): BlockPlan {
  if (lines.length <= budget) {
    return { shown: lines, overflow: [] };
  }
  return { shown: lines.slice(0, budget), overflow: lines.slice(budget) };
}

/**
 * Overflow is kept per session, newest first, and only the newest this many
 * blocks' worth of text survives. Nothing else prunes the directory, and a
 * session that renders a hundred long blocks would otherwise leave a hundred
 * files behind that no transcript line still points at.
 */
const MAX_KEPT_PER_SESSION = 50;

function overflowFileName(toolName: string, text: string): string {
  const slug = (toolName || "block").replace(/[^A-Za-z0-9._-]/g, "_");
  const digest = crypto
    .createHash("sha256")
    .update(text)
    .digest("hex")
    .slice(0, 16);
  return `${slug}-${digest}.txt`;
}

function pruneOldest(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .map((file) => ({
      file,
      mtimeMs: fs.statSync(path.join(dir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of files.slice(MAX_KEPT_PER_SESSION)) {
    try {
      fs.rmSync(path.join(dir, file), { force: true });
    } catch {}
  }
}

/**
 * Save what a block could not show and return the notice that replaces it:
 * `[+3 lines → /home/you/.tnt/block-overflow/<session>/Bash-1a2b….txt]`.
 *
 * Returns undefined when the text could not be written. The caller then prints
 * a bare line count, because a count is a fact about what was cut while a path
 * is a promise about a file.
 *
 * Safe to call again with the same overflow: the file is named after its own
 * content, and a settled block re-renders on every keystroke of whatever is
 * being typed now.
 */
export function blockOverflowNotice(input: {
  sessionId: string;
  toolName: string;
  overflow: readonly string[];
}): string | undefined {
  const { sessionId, toolName, overflow } = input;
  if (overflow.length === 0) {
    return undefined;
  }

  const text = overflow.join("\n");
  try {
    const dir = getBlockOverflowDir(sessionId);
    const candidate = path.join(dir, overflowFileName(toolName, text));
    if (!fs.existsSync(candidate)) {
      fs.writeFileSync(candidate, `${text}\n`, "utf-8");
      pruneOldest(dir);
    }
    return `[+${overflow.length} lines → ${candidate}]`;
  } catch (error) {
    logger.warn("Could not store block overflow", {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
