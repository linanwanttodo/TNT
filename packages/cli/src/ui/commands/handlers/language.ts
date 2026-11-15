import chalk from "chalk";

import {
  LOCALES,
  LOCALE_LABELS,
  getLocale,
  setLocale,
  t,
  type Locale,
} from "../../../i18n/index.js";
import type { SlashCommandResult } from "../types.js";

export async function handleLanguage(
  args: string[],
): Promise<SlashCommandResult> {
  const current = getLocale();

  if (args.length === 0) {
    const lines = LOCALES.map((locale) => {
      const marker = locale === current ? chalk.cyan("*") : " ";
      return `${marker} ${LOCALE_LABELS[locale]} (${locale})`;
    });
    return {
      output: [
        chalk.bold(t("language.title")),
        "",
        ...lines,
        "",
        chalk.dim(
          `Usage: /language ${LOCALES.map((locale) => locale).join("|")}`,
        ),
      ].join("\n"),
    };
  }

  const requested = args[0]?.trim().toLowerCase();
  const matched = LOCALES.find(
    (locale) =>
      locale.toLowerCase() === requested ||
      LOCALE_LABELS[locale].toLowerCase() === requested ||
      (locale.startsWith(requested) && requested.length >= 2),
  );

  if (!matched) {
    return {
      output: chalk.red(
        `Unknown language "${args[0]}". Choose one of: ${LOCALES.join(", ")}`,
      ),
    };
  }

  setLocale(matched as Locale);
  return {
    output: chalk.green(t("language.changed", { locale: matched })),
  };
}
