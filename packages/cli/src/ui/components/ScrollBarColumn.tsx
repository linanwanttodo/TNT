import { Box, Text } from "ink";
import React, { memo } from "react";

import type { ScrollbarGeometry } from "../utils/scrollbar.js";

const TRACK_GLYPH = "│";
const THUMB_GLYPH = "█";

/**
 * The one-column scrollbar track drawn beside a clipped window. The caller
 * owns the geometry; this component only paints it, and draws nothing when
 * the content fits.
 *
 * The track is one Text per row inside a single string rather than one
 * element per row: scrolling rebuilds the geometry on every tick, and the
 * fewer nodes Yoga has to lay out, the less the wheel costs.
 */
export const ScrollBarColumn = memo<{ geometry: ScrollbarGeometry | null }>(
  ({ geometry }) => {
    if (!geometry || !geometry.scrollable) return null;

    let track = "";
    for (let row = 0; row < geometry.trackHeight; row++) {
      const inThumb =
        row >= geometry.thumbTop &&
        row < geometry.thumbTop + geometry.thumbHeight;
      track += inThumb ? THUMB_GLYPH : TRACK_GLYPH;
    }

    return (
      <Box flexShrink={0} width={1}>
        <Text dimColor wrap="truncate-end">
          {track}
        </Text>
      </Box>
    );
  },
);

ScrollBarColumn.displayName = "ScrollBarColumn";
