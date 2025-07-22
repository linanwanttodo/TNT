export interface ComposerBorder {
  prefix: string;
  label: string;
  suffix: string;
  width: number;
}

/**
 * Build the composer's top border as three segments so the caller can color
 * the embedded mode label differently from the rule around it.
 */
export function composeTopBorder(width: number, label = ""): ComposerBorder {
  const total = Math.max(width, label.length + 4, 4);
  const inner = total - 2;
  const prefix = "╭─";

  if (label.length + 1 > inner) {
    return {
      prefix,
      label: label.slice(0, Math.max(0, inner - 1)),
      suffix: "╮",
      width: total,
    };
  }

  const fill = inner - label.length - 1;
  return {
    prefix,
    label,
    suffix: `${"─".repeat(fill)}╮`,
    width: total,
  };
}
