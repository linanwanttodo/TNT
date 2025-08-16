import chalk from "chalk";

import { t } from "../../i18n/index.js";
import { loadAllPlugins } from "../../plugins/loader.js";
import {
  getSessionOutputStyle,
  setSessionOutputStyle,
} from "../../session/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * Lists, selects or clears the session output style. Selection is stored on the
 * session rather than in the plugin, so a resumed conversation keeps the tone
 * the user picked and clearing it restores the plugin default.
 */
export function handleOutputStyle(args: string[] = []): SlashCommandResult {
  const styles = loadAllPlugins().outputStyles;
  const requested = args.join(" ").trim();

  if (!requested) {
    const chosen = getSessionOutputStyle();
    const lines = [
      chosen
        ? t("outputStyle.current", { name: chosen })
        : t("outputStyle.none"),
    ];
    if (styles.length === 0) {
      lines.push(t("outputStyle.noneAvailable"));
    } else {
      lines.push("", t("outputStyle.available"));
      for (const style of styles) {
        lines.push(`  ${chalk.cyan(style.name)} - ${style.description}`);
      }
    }
    lines.push("", chalk.dim(t("outputStyle.usage")));
    return { output: lines.join("\n") };
  }

  if (requested === "clear" || requested === "none") {
    setSessionOutputStyle(undefined);
    return { output: t("outputStyle.cleared") };
  }

  const match = styles.find((style) => style.name === requested);
  if (!match) {
    return { output: t("outputStyle.unknown", { name: requested }) };
  }
  setSessionOutputStyle(match.name);
  return { output: t("outputStyle.set", { name: match.name }) };
}
