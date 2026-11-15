import type { Tool } from "./types.js";

/**
 * Puts tools into an order that is identical on every machine.
 *
 * Tool definitions sit in the cached prompt prefix, so any reordering
 * invalidates the cache from the first difference onward, even when the set of
 * tools has not changed. The order therefore has to be a pure function of the
 * tool names rather than of registration order, which can vary with the order
 * a provider returns tools in or with which optional tools are present.
 *
 * The comparison is on UTF-16 code units via the default string comparison.
 * A locale-aware comparison is deliberately not used: its result depends on the
 * machine's locale, so two machines could emit the same tools in a different
 * order and each would consider the other's prefix valid.
 */
export function sortToolsByName(tools: readonly Tool[]): Tool[] {
  return [...tools].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * True when two tool lists would serialize to the same request fragment.
 *
 * Tools are compared in order, since the order is part of what gets cached.
 */
export function toolListsEqual(
  a: readonly Tool[],
  b: readonly Tool[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((tool, i) => JSON.stringify(tool) === JSON.stringify(b[i]));
}
