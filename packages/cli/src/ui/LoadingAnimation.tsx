import { Text } from "ink";
import React, { useEffect, useState } from "react";

import { symbols } from "./symbols.js";

/**
 * One glyph per frame, in the order Claude Code cycles them.
 *
 * The frame is a single character on purpose: a cluster of cells reads as a
 * block that blinks, which is heavier than the line of text it sits beside.
 */
export const SPINNER_FRAMES = symbols().spinner;

/** Claude Code's cadence: each glyph holds long enough to read. */
export const SPINNER_INTERVAL_MS = 120;

/**
 * Reduced motion is a terminal-level preference with no portable query, so it
 * is asked for by environment: `TNT_REDUCED_MOTION=1` freezes the spinner on
 * its first frame and stops every timer that would otherwise animate it.
 */
export function prefersReducedMotion(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.TNT_REDUCED_MOTION?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

interface LoadingAnimationProps {
  visible?: boolean;
  color?: string;
  /** Overrides the environment probe, for callers and tests. */
  reducedMotion?: boolean;
}

const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  visible = true,
  color = "green",
  reducedMotion = prefersReducedMotion(),
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!visible || reducedMotion) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [visible, reducedMotion]);

  if (!visible) return null;

  return <Text color={color}>{SPINNER_FRAMES[currentIndex]}</Text>;
};

export { LoadingAnimation };
