import path from "path";

import chalk from "chalk";

import {
  getProjectSettingsPath,
  readSettingsString,
  writeSettingsValue,
} from "../../../config/settingsFiles.js";
import { t } from "../../../i18n/index.js";
import { loadAllPlugins } from "../../../plugins/loader.js";
import {
  getSessionOutputStyle,
  setSessionOutputStyle,
} from "../../../session/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * Lists, selects, clears or persists the session output style. Selection is
 * stored on the session rather than in the plugin, so a resumed conversation
 * keeps the tone the user picked and clearing it restores the plugin default;
 * `save` writes the choice into the project settings file so it becomes the
 * default for the project without hand-editing JSON.
 */
export function handleOutputStyle(args: string[] = []): SlashCommandResult {
  const styles = loadAllPlugins().outputStyles;
  const [first, ...rest] = args;

  if (first === "save") {
    return saveOutputStyle(rest.join(" ").trim(), styles);
  }

  const requested = args.join(" ").trim();

  if (!requested) {
    const chosen = getSessionOutputStyle();
    const fromSettings = readSettingsString("outputStyle");
    const lines = [
      chosen
        ? t("outputStyle.current", { name: chosen })
        : fromSettings
          ? t("outputStyle.fromSettings", { name: fromSettings })
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

function saveOutputStyle(
  requested: string,
  styles: { name: string }[],
): SlashCommandResult {
  const name =
    requested || getSessionOutputStyle() || readSettingsString("outputStyle");
  if (!name) {
    return { output: t("outputStyle.saveNothing") };
  }
  const match = styles.find((style) => style.name === name);
  if (!match) {
    return { output: t("outputStyle.unknown", { name }) };
  }

  const filePath = getProjectSettingsPath();
  try {
    writeSettingsValue(filePath, "outputStyle", match.name);
  } catch (error) {
    return {
      output: t("outputStyle.saveFailed", {
        path: path.relative(process.cwd(), filePath),
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  setSessionOutputStyle(match.name);
  return {
    output: t("outputStyle.saved", {
      name: match.name,
      path: path.relative(process.cwd(), filePath),
    }),
  };
}
