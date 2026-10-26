/**
 * The point at which a streaming answer can be handed to the settled side.
 *
 * An update that lands in the middle of a code fence would render a broken
 * block while it is still arriving, so the split stops before the fence; the
 * last blank line outside any fence is the natural boundary otherwise. When
 * neither exists the whole answer stays live.
 */
interface FenceRange {
  start: number;
  end: number;
  open: boolean;
}

function fenceRanges(content: string): FenceRange[] {
  const ranges: FenceRange[] = [];
  let openStart: number | undefined;
  let offset = 0;
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (openStart === undefined) {
        openStart = offset;
      } else {
        ranges.push({
          start: openStart,
          end: offset + line.length,
          open: false,
        });
        openStart = undefined;
      }
    }
    offset += line.length + 1;
  }
  if (openStart !== undefined) {
    ranges.push({ start: openStart, end: content.length, open: true });
  }
  return ranges;
}

function insideFence(ranges: readonly FenceRange[], index: number): boolean {
  return ranges.some((range) => index > range.start && index <= range.end);
}

export function findLastSafeSplitPoint(content: string): number {
  const ranges = fenceRanges(content);
  const open = ranges.find((range) => range.open);
  if (open) {
    return open.start;
  }

  let search = content.length;
  while (search >= 0) {
    const index = content.lastIndexOf("\n\n", search);
    if (index === -1) {
      break;
    }
    const point = index + 2;
    if (!insideFence(ranges, point)) {
      return point;
    }
    search = index - 1;
  }
  return content.length;
}
