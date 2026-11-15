import chalk from "chalk";

import { getVersion } from "./version.js";

const d = chalk.dim;

// "TNT" as a two-line half-block wordmark, small rather than a
// full-width banner. Each cell is one pixel column: ▀ draws only the upper
// pixel, ▄ only the lower, █ both.
export const TNT_ASCII_ART = `${chalk.blue("▀██▀ █▄ █ ▀██▀")}  ${d("v" + getVersion())}
${chalk.blue(" ██  █ ▀█  ██")}`;

// Minimum terminal width required to display the wordmark properly
const MIN_WIDTH_FOR_ASCII_ART = 30;

/**
 * Returns the TNT ASCII art only if the terminal is wide enough to display it
 * properly. If terminal is too narrow, returns just the version string.
 */
export function getDisplayableAsciiArt(): string {
  const terminalWidth = process.stdout.columns || 80;

  if (terminalWidth >= MIN_WIDTH_FOR_ASCII_ART) {
    return TNT_ASCII_ART;
  }

  // If terminal is too narrow, show just the version string.
  return `v${getVersion()}`;
}
