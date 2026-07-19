export interface ComposerBorder {
  prefix: string;
  label: string;
  suffix: string;
  width: number;
}

/**
 * Builds the composer's horizontal rule with the mode label embedded after the
 * first cell. The reference CLI frames its prompt with a rule above and another
 * below and no side rails, so the top rule carries the label rather than being
 * a box edge.
 */
export function composeTopBorder(width: number, label = ""): ComposerBorder {
  const total = Math.max(width, label.length + 1, 2);
  const prefix = "─";

  if (label.length + 1 >= total) {
    return {
      prefix,
      label: label.slice(0, Math.max(0, total - 1)),
      suffix: "",
      width: total,
    };
  }

  return {
    prefix,
    label,
    suffix: "─".repeat(total - 1 - label.length),
    width: total,
  };
}

/** The plain rule that closes the composer below the prompt. */
export function composeRule(width: number): string {
  return "─".repeat(Math.max(width, 1));
}
