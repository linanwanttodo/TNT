import { Box } from "ink";

import type { Theme } from "./theme/tokens.js";

export const baseBoxStyles: React.ComponentProps<typeof Box> = {
  flexDirection: "column",
  paddingX: 2,
  paddingY: 1,
  borderStyle: "round",
};

export const defaultBoxStyles = (
  borderColor: string,
  overrides?: Partial<React.ComponentProps<typeof Box>>,
): React.ComponentProps<typeof Box> => ({
  ...baseBoxStyles,
  borderColor,
  ...overrides,
});

/**
 * The roles a frame can borrow from the active theme. `accent` is the
 * interactive colour, `focus` the stronger outline used by pickers, and
 * `muted` the resting border.
 */
export type ThemeRole = "accent" | "focus" | "muted";

export function themeColor(theme: Theme, role: ThemeRole): string {
  switch (role) {
    case "accent":
      return theme.accent;
    case "focus":
      return theme.border.focus;
    case "muted":
      return theme.border.default;
  }
}

/**
 * Box styles for a themed frame. Every selector and picker draws its border
 * through this helper so a palette change reaches all of them at once,
 * instead of each frame pinning an ANSI colour name that the terminal is
 * free to render in any hue.
 */
export const themedBoxStyles = (
  theme: Theme,
  role: ThemeRole = "accent",
  overrides?: Partial<React.ComponentProps<typeof Box>>,
): React.ComponentProps<typeof Box> => ({
  ...baseBoxStyles,
  borderColor: themeColor(theme, role),
  ...overrides,
});
