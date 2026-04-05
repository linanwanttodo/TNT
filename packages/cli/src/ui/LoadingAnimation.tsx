import { Text } from "ink";
import React, { useEffect, useState } from "react";

import { symbols } from "./symbols.js";

/**
 * One braille cell per frame.
 *
 * The frame is a single character on purpose: a cluster of cells reads as a
 * block that blinks, which is heavier than the line of text it sits beside.
 */
export const SPINNER_FRAMES = symbols().spinner;

/** An 80ms cadence; slower looks like a stall, faster like a glitch. */
export const SPINNER_INTERVAL_MS = 80;

interface LoadingAnimationProps {
  visible?: boolean;
  color?: string;
}

const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  visible = true,
  color = "green",
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return <Text color={color}>{SPINNER_FRAMES[currentIndex]}</Text>;
};

export { LoadingAnimation };
