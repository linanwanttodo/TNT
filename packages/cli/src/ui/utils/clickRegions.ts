import type { DOMElement } from "ink";

/**
 * Mouse hit testing for Ink components.
 *
 * Ink reports a click as a terminal row and column, not as an element, and it
 * has no per-element mouse events. A component that wants clicks registers
 * itself with the node it renders; the dispatcher walks the node's ancestors to
 * turn its layout position into a screen row and decides which region was hit.
 * The transcript's scroll offset is part of that layout, so a panel stays
 * clickable at whatever row it is drawn on.
 */
interface ClickRegion {
  id: number;
  getNode: () => DOMElement | null | undefined;
  onClick: () => void;
}

const regions = new Map<number, ClickRegion>();
let nextId = 1;

interface Point {
  top: number;
  left: number;
}

/** Absolute layout position of a node, in cells from the top-left of the frame. */
function absolutePosition(node: DOMElement): Point {
  let top = 0;
  let left = 0;
  let current: DOMElement | undefined = node;

  while (current) {
    const yoga = current.yogaNode;
    if (yoga) {
      top += yoga.getComputedTop();
      left += yoga.getComputedLeft();
    }
    current = current.parentNode;
  }

  return { top, left };
}

/** Registers a click handler for the node `getNode` returns. */
export function registerClickRegion(
  getNode: () => DOMElement | null | undefined,
  onClick: () => void,
): () => void {
  const id = nextId++;
  regions.set(id, { id, getNode, onClick });

  return () => {
    regions.delete(id);
  };
}

/**
 * Dispatches a left click at a 1-based terminal row and column. Returns true
 * when a region handled it. The innermost region wins so a click inside a
 * nested control does not also toggle its container.
 */
export function dispatchClick(row: number, col: number): boolean {
  const y = row - 1;
  const x = col - 1;
  let winner: ClickRegion | undefined;
  let winnerTop = Number.NEGATIVE_INFINITY;

  for (const region of regions.values()) {
    const node = region.getNode();
    const yoga = node?.yogaNode;
    if (!node || !yoga) continue;

    const { top, left } = absolutePosition(node);
    const height = yoga.getComputedHeight();
    const width = yoga.getComputedWidth();
    if (y < top || y >= top + height || x < left || x >= left + width) {
      continue;
    }

    if (top >= winnerTop) {
      winner = region;
      winnerTop = top;
    }
  }

  if (!winner) {
    return false;
  }

  winner.onClick();

  return true;
}

/** Drops every registration. Used between tests. */
export function clearClickRegions(): void {
  regions.clear();
}
