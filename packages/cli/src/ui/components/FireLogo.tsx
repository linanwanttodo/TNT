import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import { getDisplayableAsciiArt } from "../../startup/asciiArt.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import {
  FIRE_FRAME_MS,
  FIRE_MAX_COLS,
  FIRE_ROWS,
  type FireGrid,
  type Rng,
  buildFireMask,
  createFireGrid,
  fireGlyph,
  fireHex,
  stepFire,
} from "../utils/fireLogo.js";

interface FireLogoProps {
  /** Overrides the terminal's capability check, for tests and callers. */
  animated?: boolean;
  rng?: Rng;
}

/** Truecolor blocks only when the terminal can render them and is wide enough. */
export function supportsFireBanner(
  columns: number,
  stdout: { isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NO_COLOR) return false;
  if (!stdout.isTTY) return false;
  return columns >= FIRE_MAX_COLS;
}

/**
 * The intro banner: large block letters burning upward. Each character cell
 * packs two pixels (`▀` with a foreground and a background), so 16 pixel rows
 * fit in 8 terminal rows. The animation lives entirely in this component, so
 * a frame tick re-renders the banner and nothing else.
 */
export const FireLogo: React.FC<FireLogoProps> = ({ animated, rng }) => {
  const { columns } = useTerminalSize();
  const width = Math.min(columns - 2, FIRE_MAX_COLS);
  const isAnimated = animated ?? supportsFireBanner(columns);

  const mask = useMemo(
    () => buildFireMask(FIRE_ROWS, Math.max(width, 38)),
    [width],
  );
  const [grid, setGrid] = useState<FireGrid>(() => createFireGrid(mask, rng));

  useEffect(() => {
    if (!isAnimated) return;
    const timer = setInterval(() => {
      setGrid((previous) => stepFire(previous, mask, rng ?? Math.random));
    }, FIRE_FRAME_MS);
    return () => clearInterval(timer);
  }, [isAnimated, mask, rng]);

  if (!isAnimated) {
    // Narrow terminal or no colors: the static two-line wordmark.
    return <Text>{getDisplayableAsciiArt()}</Text>;
  }

  // One character per cell from the ramp, coloured by heat. Consecutive cells
  // of the same colour share one Text span, which keeps the node count low
  // enough to redraw at the frame rate.
  const lines: React.ReactElement[] = [];
  for (let row = 0; row < FIRE_ROWS; row += 1) {
    const cells: React.ReactElement[] = [];
    let runText = "";
    let runColor: string | null = null;

    const flushRun = () => {
      if (runColor && runText) {
        cells.push(
          <Text key={cells.length} color={runColor}>
            {runText}
          </Text>,
        );
      }
      runText = "";
      runColor = null;
    };

    for (let x = 0; x < width; x += 1) {
      const intensity = grid[row][x];
      const glyph = fireGlyph(intensity);
      if (glyph === " ") {
        flushRun();
        cells.push(<Text key={cells.length}> </Text>);
        continue;
      }
      const color = fireHex(intensity);
      if (color !== runColor) {
        flushRun();
        runColor = color;
      }
      runText += glyph;
    }
    flushRun();

    lines.push(<Text key={row}>{cells}</Text>);
  }

  // Centred in the terminal, not pinned to the left edge.
  return (
    <Box flexDirection="column" width={columns} alignItems="center">
      {lines}
    </Box>
  );
};
