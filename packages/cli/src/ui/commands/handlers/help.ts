import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import { KEY_BINDINGS } from "../../keyBindings.js";
import type { SlashCommandResult } from "../types.js";

export async function handleHelp(): Promise<SlashCommandResult> {
  // The table is `keyBindings.ts`, which is also what the documentation page is
  // checked against: a shortcut printed here that answers nothing, or a key
  // handler nobody is told about, both fail the same guard.
  const keyRows = KEY_BINDINGS.map(
    ({ keys, descriptionKey }) =>
      `  ${chalk.cyan(keys.padEnd(15))} ${t(descriptionKey)}`,
  );
  const helpMessage = [
    chalk.bold(t("help.title")),
    "",
    ...keyRows,
    "",
    chalk.white(t("help.specialTitle")),
    `  ${chalk.cyan("@")}           ${t("help.specialFiles")}`,
    `  ${chalk.cyan("/")}           ${t("help.specialSlash")}`,
    `  ${chalk.cyan("!")}           ${t("help.specialBash")}`,
    `  ${chalk.cyan("\\")}           ${t("help.specialContinuation")}`,
    "",
    chalk.white(t("help.commandsTitle")),
    `  ${t("help.commandsSlashHint", { slash: chalk.cyan("/") })}`,
    `  ${t("help.commandsBashHint", { bang: chalk.cyan("!") })}`,
  ].join("\n");

  return { output: helpMessage };
}
