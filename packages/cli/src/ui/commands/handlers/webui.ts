import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import { webUiService } from "../../../services/WebUiService.js";
import { logger } from "../../../utils/logger.js";
import type { SlashCommandResult } from "../types.js";

function parsePortArg(arg: string): number | null {
  const value = Number.parseInt(arg, 10);
  return Number.isFinite(value) && value > 0 && value < 65536 ? value : null;
}

/**
 * `/webui` serves the current session's web view from inside this TUI
 * process: `stop` shuts it down, `--no-open` skips the browser, `--port=N`
 * pins the first port probed. Any surface can call start/stop — the stop
 * path goes through the same close() the exit route uses.
 */
export async function handleWebui(
  args: string[] = [],
): Promise<SlashCommandResult> {
  const tokens = args.map((token) => token.trim()).filter(Boolean);

  if (tokens[0]?.toLowerCase() === "stop") {
    await webUiService.close();
    return { output: t("webui.stopped") };
  }

  const open = !tokens.includes("--no-open");
  let port: number | undefined;
  for (const token of tokens) {
    if (token.startsWith("--port=")) {
      const parsed = parsePortArg(token.slice("--port=".length));
      if (parsed === null) {
        return { output: t("webui.badPort", { value: token }) };
      }
      port = parsed;
    }
  }

  let handle;
  try {
    handle = await webUiService.start({ port });
  } catch (error) {
    return {
      output: t("webui.startFailed", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  const url = `http://127.0.0.1:${handle.port}/#token=${handle.token}`;
  if (open) {
    const { default: openBrowser } = await import("open");
    await openBrowser(url).catch((error: unknown) => {
      logger.warn?.(`Failed to open browser: ${String(error)}`);
    });
  }

  return {
    output: `${t("webui.listening", { url })}${
      open ? "" : `\n${chalk.dim(t("webui.openManually"))}`
    }`,
  };
}
