import * as fs from "fs";
import * as path from "path";

import { logger } from "../utils/logger.js";
import { parseEnvNumber } from "../utils/truncateOutput.js";

/**
 * How much of a tool result the model is given inline. A search, an MCP server
 * or a build log can return far more, and every character of it is re-paid on
 * every later request. Past the limit the whole result goes to the session's
 * tool-results directory and the model gets the head plus the path, so the rest
 * stays reachable instead of being cut off.
 */
const DEFAULT_MAX_INLINE_CHARS = 25_000;
const PREVIEW_CHARS = 2_000;
const MAX_STORED_PER_SESSION = 50;

export function maxInlineToolResultChars(): number {
  return parseEnvNumber(
    process.env.CONTINUE_CLI_MAX_TOOL_RESULT_CHARS,
    DEFAULT_MAX_INLINE_CHARS,
  );
}

function safeFileName(callId: string): string {
  return callId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "result";
}

/**
 * Keep the newest results only. A long run can produce hundreds of oversized
 * calls, and nothing else prunes this directory.
 */
function pruneOldest(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .map((file) => ({
      file,
      mtimeMs: fs.statSync(path.join(dir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of files.slice(MAX_STORED_PER_SESSION)) {
    try {
      fs.rmSync(path.join(dir, file), { force: true });
    } catch {}
  }
}

export async function spillOversizedToolResult(options: {
  toolName: string;
  callId: string;
  content: string;
}): Promise<string> {
  const { content, toolName, callId } = options;
  const limit = maxInlineToolResultChars();
  if (content.length <= limit) {
    return content;
  }

  let storedPath: string | undefined;
  try {
    // Loaded on demand: this runs on every tool result, and the session module
    // pulls in the store that not every entry point needs.
    const { getCurrentSession, getToolResultsDir } = await import(
      "../session/index.js"
    );
    const dir = getToolResultsDir(getCurrentSession().sessionId);
    const candidate = path.join(dir, `${safeFileName(callId)}.txt`);
    fs.writeFileSync(candidate, content, "utf-8");
    // Only a finished write is worth pointing the model at.
    storedPath = candidate;
    pruneOldest(dir);
  } catch (error) {
    logger.warn("Could not store oversized tool result", {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // With nowhere to point the model at, the inline part has to stay within the
  // budget that made this a spill in the first place, or the "shortened" result
  // would be longer than the result itself.
  const preview = content.slice(0, storedPath ? PREVIEW_CHARS : limit);
  const tail = storedPath
    ? `Full output of ${toolName} (${content.length.toLocaleString()} characters) saved to ${storedPath}. Read or search that file for the part you need.`
    : `${toolName} returned ${content.length.toLocaleString()} characters and the excess could not be saved.`;

  return `${preview}\n\n[... ${tail}]`;
}
