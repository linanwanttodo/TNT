import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import type { SlashCommandResult } from "../types.js";

export async function handleHelp(): Promise<SlashCommandResult> {
  const helpMessage = [
    chalk.bold(t("help.title")),
    "",
    chalk.white(t("help.navigationTitle")),
    `  ${chalk.cyan("↑/↓")}        ${t("help.navigationMove")}`,
    `  ${chalk.cyan("Tab")}        ${t("help.navigationComplete")}`,
    `  ${chalk.cyan("Enter")}      ${t("help.navigationSubmit")}`,
    `  ${chalk.cyan("Shift+Enter")} ${t("help.navigationNewLine")}`,
    `  ${chalk.cyan("\\")}          ${t("help.navigationContinue")}`,
    `  ${chalk.cyan("!")}          ${t("help.navigationShellMode")}`,
    "",
    chalk.white(t("help.controlsTitle")),
    `  ${chalk.cyan("Ctrl+C")}     ${t("help.controlsClearInput")}`,
    `  ${chalk.cyan("Ctrl+D")}     ${t("help.controlsExit")}`,
    `  ${chalk.cyan("Ctrl+L")}     ${t("help.controlsClearScreen")}`,
    `  ${chalk.cyan("Shift+Tab")}  ${t("help.controlsModes")}`,
    `  ${chalk.cyan("Esc")}        ${t("help.controlsCancel")}`,
    "",
    chalk.white(t("help.specialTitle")),
    `  ${chalk.cyan("@")}          ${t("help.specialFiles")}`,
    `  ${chalk.cyan("/")}          ${t("help.specialSlash")}`,
    `  ${chalk.cyan("!")}          ${t("help.specialBash")}`,
    "",
    chalk.white(t("help.commandsTitle")),
    `  ${t("help.commandsSlashHint", { slash: chalk.cyan("/") })}`,
    `  ${t("help.commandsBashHint", { bang: chalk.cyan("!") })}`,
  ].join("\n");

  return { output: helpMessage };
}
