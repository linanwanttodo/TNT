import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import {
  listChatModels,
  switchChatModel,
} from "../../../services/modelCatalog.js";
import { webUiService } from "../../../services/WebUiService.js";
import {
  currentCheckout,
  listCheckouts,
} from "../../../services/worktreeCatalog.js";
import { hyperlink } from "../../../ui/hyperlink.js";
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
    handle = await webUiService.start({
      port,
      // The browser may read the model list and pick another model: the
      // terminal and the page share one model service, so the change is the
      // same change the terminal's own /model screen makes.
      listModels: listChatModels,
      switchModel: (index) => switchChatModel(index),
      // The checkouts are readable from here, but this process belongs to the
      // terminal's session: moving it would desync the two, so the page is
      // told the move is not available instead of being offered a control
      // that fails.
      listWorktrees: listCheckouts,
      currentWorktree: currentCheckout,
    });
  } catch (error) {
    return {
      output: t("webui.startFailed", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  const url = `http://127.0.0.1:${handle.port}/#token=${handle.token}`;
  const clickable = hyperlink(url, url);
  if (open) {
    const { default: openBrowser } = await import("open");
    await openBrowser(url).catch((error: unknown) => {
      logger.warn?.(`Failed to open browser: ${String(error)}`);
    });
  }

  return {
    output: `${t("webui.listening", { url: clickable })}${
      open ? "" : `\n${chalk.dim(t("webui.openManually"))}`
    }`,
  };
}
