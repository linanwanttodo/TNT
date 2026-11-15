/**
 * A label that opens the URL it names, where the terminal supports it.
 *
 * OSC 8 is a terminal-side hint: the text stays exactly the text, and a terminal
 * that does not know the sequence ignores it. That is why it can be on by
 * default - and why `TNT_HYPERLINKS=0` exists for the terminal that renders the
 * escape codes literally instead of swallowing them.
 */
export function hyperlinksEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TNT_HYPERLINKS !== "0";
}

export function hyperlink(
  label: string,
  url: string,
  enabled: boolean = hyperlinksEnabled(),
): string {
  if (!enabled || !url) {
    return label;
  }
  return `\u001B]8;;${url}\u001B\\${label}\u001B]8;;\u001B\\`;
}
