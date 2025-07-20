import chalk from "chalk";

import { getVersion } from "./version.js";

const d = chalk.dim;

// "TNT" in the ANSI Shadow block-letter style. One flat accent keeps the
// glyphs readable instead of turning the banner into a colour wash.
export const TNT_ASCII_ART = `${chalk.blue(
  `████████╗███╗   ██╗████████╗
╚══██╔══╝████╗  ██║╚══██╔══╝
   ██║   ██╔██╗ ██║   ██║
   ██║   ██║╚██╗██║   ██║
   ██║   ██║ ╚████║   ██║
   ╚═╝   ╚═╝  ╚═══╝   ╚═╝`,
)}
                              ${d("v" + getVersion())}`;

// Minimum terminal width required to display ASCII art properly
const MIN_WIDTH_FOR_ASCII_ART = 75;

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
