import { Box, type DOMElement, measureElement } from "ink";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useLayoutRevision } from "../hooks/layoutDirty.js";
import { scrollbarGeometry } from "../utils/scrollbar.js";

import { ScrollBarColumn } from "./ScrollBarColumn.js";
import type { ScrollViewMetrics } from "./ScrollView.js";

export interface VirtualItem {
  /** Stable identity for the height cache across renders and compactions. */
  key: string;
  node: React.ReactNode;
  /**
   * Rows this item is expected to occupy before it has been measured. A wrong
   * estimate only moves the window for the frame that measures it; once a row
   * of content is committed its measured height wins.
   */
  estimate?: number;
}

interface VirtualTranscriptProps {
  items: readonly VirtualItem[];
  scrollTop: number;
  onMetrics: (metrics: ScrollViewMetrics) => void;
  /**
   * Rows the content above the window moved by after a measurement. The owner
   * adds this to the scroll offset so the row the reader is looking at does
   * not jump when an off-screen estimate becomes a measurement.
   */
  onContentShift?: (rows: number) => void;
  showScrollbar?: boolean;
  /** Width the estimates were computed for; a resize invalidates heights. */
  width?: number;
}

/** Extra viewports rendered above and below the visible window. */
const OVERSCAN_VIEWPORTS = 0.25;
/**
 * The height assumed on the commit before the viewport has been measured.
 * Without it the first commit would mount the whole history once, which is
 * exactly the cost this component exists to avoid.
 */
const ASSUMED_VIEWPORT_ROWS = 24;
/** A default for an item nobody estimated: three rows is a short paragraph. */
const DEFAULT_ESTIMATE = 3;

function clampRows(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ESTIMATE;
  return Math.max(1, Math.min(4000, Math.round(value)));
}

/**
 * The visible slice of a long transcript.
 *
 * Ink lays out every mounted node on every commit, and the terminal renderer
 * diffs every emitted row. Drawing the whole conversation inside a clipped
 * viewport therefore costs O(history) per wheel notch - the transcript got
 * slower the longer the session ran, while native scrollback stayed constant.
 * This component keeps the row-addressed contract of `ScrollView` but mounts
 * only the rows near the window, with spacer boxes standing in for the rest.
 *
 * Heights are measured from the committed layout. Before an item has been
 * measured its `estimate` is used, which only decides which nodes to mount;
 * the measurement replaces it and `onContentShift` compensates the offset, so
 * a wrong estimate costs one frame, not a visible jump.
 */
/**
 * Drops the measured heights when a nested block reports that its own height
 * changed. Such a block (an expanded tool panel, an opened thought) keeps its
 * node identity, so the per-node check would otherwise trust a stale number.
 */
function useRevalidatedMeasurements(
  measuredNodes: React.MutableRefObject<Map<string, React.ReactNode>>,
): void {
  const layoutRevision = useLayoutRevision();
  const measuredRevision = useRef(layoutRevision);
  if (measuredRevision.current !== layoutRevision) {
    measuredRevision.current = layoutRevision;
    measuredNodes.current.clear();
  }
}

export const VirtualTranscript: React.FC<VirtualTranscriptProps> = ({
  items,
  scrollTop,
  onMetrics,
  onContentShift,
  showScrollbar = false,
  width = 0,
}) => {
  const viewportRef = useRef<DOMElement>(null);
  const itemRefs = useRef(new Map<string, DOMElement>());
  const heights = useRef(new Map<string, number>());
  /**
   * The node each cached height was measured from. A row whose node reference
   * has not changed cannot have changed height, so it is not measured again.
   */
  const measuredNodes = useRef(new Map<string, React.ReactNode>());
  const [, setRevision] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // A measured height belongs to a width: a resize re-wraps every paragraph,
  // and keeping the old numbers would put every row at the wrong offset.
  useEffect(() => {
    heights.current.clear();
    measuredNodes.current.clear();
    setRevision((value) => value + 1);
  }, [width]);

  useRevalidatedMeasurements(measuredNodes);

  const setItemRef = useCallback(
    (key: string) => (element: DOMElement | null) => {
      if (element) itemRefs.current.set(key, element);
      else itemRefs.current.delete(key);
    },
    [],
  );

  const rows = items.map((item) =>
    clampRows(
      heights.current.get(item.key) ?? item.estimate ?? DEFAULT_ESTIMATE,
    ),
  );
  const offsets: number[] = [];
  let total = 0;
  for (const height of rows) {
    offsets.push(total);
    total += height;
  }
  const effectiveHeight = viewportHeight || ASSUMED_VIEWPORT_ROWS;
  const overscan = effectiveHeight * OVERSCAN_VIEWPORTS;
  const atTail = items.length > 0 && scrollTop + effectiveHeight >= total - 1;

  let start = 0;
  let end = items.length - 1;
  if (items.length > 0) {
    if (atTail) {
      // Walk back from the end so the tail is correct even when the items
      // above it are still estimates.
      let covered = 0;
      end = items.length - 1;
      start = end;
      while (start >= 0 && covered < effectiveHeight + overscan) {
        covered += rows[start];
        start -= 1;
      }
      start = Math.max(0, start);
    } else {
      const windowTop = Math.max(0, scrollTop - overscan);
      const windowBottom = scrollTop + effectiveHeight + overscan;
      start = 0;
      for (let index = 0; index < items.length; index += 1) {
        if (offsets[index] + rows[index] > windowTop) {
          start = index;
          break;
        }
      }
      end = items.length - 1;
      for (let index = start; index < items.length; index += 1) {
        if (offsets[index] > windowBottom) {
          end = Math.max(start, index - 1);
          break;
        }
      }
    }
  }

  const offsetWithinStart = offsets[start] ?? 0;
  const rendered = items.slice(start, end + 1);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      const measured = measureElement(viewport).height;
      if (measured !== viewportHeight) setViewportHeight(measured);
    }

    let changed = false;
    let shiftAbove = 0;
    // The item containing the first visible row: its top is the anchor a
    // measurement must not move.
    let anchorIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const top = offsets[index];
      if (top <= scrollTop && top + rows[index] > scrollTop) {
        anchorIndex = index;
        break;
      }
    }
    const anchorKey = anchorIndex >= 0 ? items[anchorIndex]?.key : undefined;
    const anchorTop = anchorIndex >= 0 ? offsets[anchorIndex] : undefined;

    // A row whose node is untouched cannot have changed height. Measuring the
    // whole window on every commit was the per-frame cost that made scrolling
    // and typing wait behind layout queries: a streaming delta only changes
    // the live row, and a scroll notch changes no content at all.
    for (const item of rendered) {
      const element = itemRefs.current.get(item.key);
      if (!element) continue;
      const measuredFor = measuredNodes.current.get(item.key);
      if (measuredFor === item.node && heights.current.has(item.key)) {
        continue;
      }
      const height = measureElement(element).height;
      if (!Number.isFinite(height) || height <= 0) continue;
      measuredNodes.current.set(item.key, item.node);
      if (heights.current.get(item.key) !== height) {
        heights.current.set(item.key, height);
        changed = true;
      }
    }

    if (changed && anchorKey !== undefined && anchorTop !== undefined) {
      const anchorPosition = items.findIndex((item) => item.key === anchorKey);
      if (anchorPosition >= 0) {
        // Recompute the anchor's top with the new heights.
        let nextTop = 0;
        for (let index = 0; index < anchorPosition; index += 1) {
          nextTop += clampRows(
            heights.current.get(items[index]!.key) ??
              items[index]!.estimate ??
              DEFAULT_ESTIMATE,
          );
        }
        shiftAbove = nextTop - anchorTop;
      }
    }

    if (changed) {
      // Drop entries for messages the history no longer holds (compaction,
      // rewind) so the cache cannot grow with the session.
      if (heights.current.size > items.length * 2) {
        const live = new Set(items.map((item) => item.key));
        for (const key of heights.current.keys()) {
          if (!live.has(key)) {
            heights.current.delete(key);
            measuredNodes.current.delete(key);
          }
        }
      }
      setRevision((value) => value + 1);
    }

    if (shiftAbove !== 0 && anchorKey !== undefined) {
      onContentShift?.(shiftAbove);
    }

    onMetrics({ contentHeight: total, viewportHeight });
  });

  const geometry = showScrollbar
    ? scrollbarGeometry(scrollTop, viewportHeight, total)
    : null;
  // The spacer keeps every mounted row at its absolute offset, so the whole
  // column is translated by the scroll position itself.
  const marginTop = -Math.max(0, Math.round(scrollTop));
  const topSpacer = offsetWithinStart;
  const bottomSpacer = Math.max(
    0,
    total - (offsets[end] ?? 0) - (rows[end] ?? 0),
  );

  return (
    <Box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0}>
      <Box
        ref={viewportRef}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflowY="hidden"
      >
        <Box flexDirection="column" flexShrink={0} marginTop={marginTop}>
          {topSpacer > 0 && <Box height={topSpacer} />}
          {rendered.map((item) => (
            <Box
              key={item.key}
              ref={setItemRef(item.key)}
              flexDirection="column"
              flexShrink={0}
            >
              {item.node}
            </Box>
          ))}
          {bottomSpacer > 0 && <Box height={bottomSpacer} />}
        </Box>
      </Box>
      {showScrollbar && <ScrollBarColumn geometry={geometry} />}
    </Box>
  );
};
