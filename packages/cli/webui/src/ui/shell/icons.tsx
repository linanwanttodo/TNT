/**
 * Shell glyphs. Unlike the shared product icon set, these are fixed artwork
 * traced from the Claude Code desktop reference, so they carry no stroke
 * weight variants: one symbol per glyph.
 */
import { SHELL_ARTWORK, shellSymbolId, type ShellGlyph } from "./artwork.ts";

export type { ShellGlyph } from "./artwork.ts";

/** Props every shell glyph accepts. */
export interface ShellIconProps {
  /** Rendered width in pixels; the height follows the glyph's aspect. */
  size?: number | undefined;
  className?: string | undefined;
}

/**
 * Render one shell glyph from the document sprite.
 * @param glyph - glyph name.
 * @param props - rendered size and class name.
 * @returns the SVG element that references the sprite symbol.
 */
export function ShellIcon({
  glyph,
  size,
  className,
}: ShellIconProps & { glyph: ShellGlyph }): React.JSX.Element {
  const artwork = SHELL_ARTWORK[glyph];
  const width = size ?? artwork.width;
  const height = (size ?? artwork.height) * (artwork.height / artwork.width);
  return (
    <svg
      width={width}
      height={height}
      className={className}
      data-icon={shellSymbolId(glyph)}
      aria-hidden="true"
    >
      <use href={`#${shellSymbolId(glyph)}`} />
    </svg>
  );
}
