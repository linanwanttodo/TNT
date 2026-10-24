import { Box, Text } from "ink";
import React from "react";

import type { ScrollbarGeometry } from "../utils/scrollbar.js";

const TRACK_GLYPH = "│";
const THUMB_GLYPH = "█";

/**
 * The one-column scrollbar track drawn beside a clipped window. The caller
 * owns the geometry; this component only paints it, and draws nothing when
 * the content fits.
 */
export const ScrollBarColumn: React.FC<{
  geometry: ScrollbarGeometry | null;
}> = ({ geometry }) => {
  if (!geometry || !geometry.scrollable) return null;

  const rows = Array.from(
    { length: geometry.trackHeight },
    (_, row) => {
      const inThumb =
        row >= geometry.thumbTop &&
        row < geometry.thumbTop + geometry.thumbHeight;
      return (
        <Text key={row} dimColor={!inThumb}>
          {inThumb ? THUMB_GLYPH : TRACK_GLYPH}
        </Text>
      );
    },
  );

  return (
    <Box flexDirection="column" flexShrink={0} width={1}>
      {rows}
    </Box>
  );
};
