/**
 * Artwork for the app shell (sidebar, title bar, status bar, empty state).
 *
 * Every glyph here was traced from the Claude Code desktop reference at 1x,
 * so the geometry is expressed in the reference's own pixels rather than in
 * a generic 16px grid. Each entry is a complete SVG document; the sprite
 * installer turns it into a `<symbol>` so the shell can reference it with
 * `<use>` and inherit `currentColor`.
 */

/** One shell glyph: rendered box and the SVG document that draws it. */
export interface ShellArtwork {
  width: number;
  height: number;
  svg: string;
}

/** Stroke width the reference uses for its one-pixel shell outlines. */
const STROKE = 1.5;

/**
 * Wrap path data in a stroked SVG document.
 * @param viewBox - the coordinate system the paths are authored in.
 * @param body - path elements to place inside the document.
 * @param stroke - stroke width in viewBox units.
 * @returns a complete SVG document string.
 */
function outline(
  viewBox: string,
  body: string,
  stroke: number = STROKE,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${stroke}">${body}</svg>`;
}

/**
 * Wrap path data in a filled SVG document.
 * @param viewBox - the coordinate system the paths are authored in.
 * @param body - path elements to place inside the document.
 * @returns a complete SVG document string.
 */
function filled(viewBox: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor" stroke="none">${body}</svg>`;
}

/** Shell artwork keyed by glyph name. */
export const SHELL_ARTWORK = {
  /** Three-bar menu; the reference's third bar is half width. */
  menu: {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M2 4H14"/><path d="M2 8.5H14"/><path d="M2 13H7.5"/>',
    ),
  },

  /** Panel toggle: a square split by a vertical rule a third from the left. */
  "panel-left": {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<rect x="4.5" y="3.5" width="10" height="10" rx="0.5"/><path d="M8 3.5V13.5"/>',
    ),
  },

  /** Left-pointing arrow with a 1.5px shaft. */
  "arrow-left": {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M2 9H13.5"/><path d="M8 3.5L1.5 9L8 14.5"/>',
    ),
  },

  /** Right-pointing arrow with a 1.5px shaft. */
  "arrow-right": {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M2 9H13.5"/><path d="M7.5 3.5L14 9L7.5 14.5"/>',
    ),
  },

  /** Cowork segment glyph: two diagonals beside two rules. */
  cowork: {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M3 1L0 4"/><path d="M0 7L2 10"/><path d="M4 3H10"/><path d="M4 8H10"/>',
    ),
  },

  /** Code segment glyph: a left chevron, a slash, and a right chevron. */
  "code-brackets": {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M3 2L0 4.5L3 7"/><path d="M6.5 0.5L4.5 9"/><path d="M7 2L11 4.5L7 7"/>',
    ),
  },

  /** Plus sign for the New button. */
  plus: {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M7.5 3V11"/><path d="M3.5 7H11.5" stroke-width="2"/>',
    ),
  },

  /** The composer's leading plus: a 12px cross with a 2px stroke. */
  "plus-compact": {
    width: 12,
    height: 12,
    svg: outline("0 0 12 12", '<path d="M6 1V11"/><path d="M1 6H11"/>', 2),
  },

  /** Toolbox for the Customize row: a case with a handle and a seam. */
  toolbox: {
    width: 12,
    height: 12,
    svg: outline(
      "0 0 12 12",
      '<path d="M3.5 3.5V2.5C3.5 2.22386 3.72386 2 4 2H8C8.27614 2 8.5 2.22386 8.5 2.5V3.5"/><rect x="0.5" y="3.5" width="11" height="8" rx="0.5"/><path d="M0.5 6.5H11.5"/>',
      1.25,
    ),
  },

  /** Clock for the Routines row. */
  clock: {
    width: 12,
    height: 12,
    svg: outline(
      "0 0 12 12",
      '<circle cx="6" cy="6" r="5.25"/><path d="M6 3.25V6L8 7.75"/>',
      1.25,
    ),
  },

  /** Three horizontal dots for the More row. */
  dots: {
    width: 12,
    height: 12,
    svg: filled(
      "0 0 12 12",
      '<circle cx="1.5" cy="6" r="1.25"/><circle cx="6" cy="6" r="1.25"/><circle cx="10.5" cy="6" r="1.25"/>',
    ),
  },

  /** Outlined lightning bolt with the mid crossbar, for the empty-state suggestion. */
  lightning: {
    width: 12,
    height: 12,
    svg: outline(
      "0 0 12 12",
      '<path d="M9.5 0.5L1.5 6.5H5.5L4.5 11.5L10.5 4.5H6.5L9.5 0.5Z"/>',
      1.1,
    ),
  },

  /** Laptop for the "this computer" status entry. */
  laptop: {
    width: 14,
    height: 14,
    svg: outline(
      "0 0 14 14",
      '<rect x="2" y="2.5" width="10" height="7" rx="0.5"/><path d="M0.5 11.5H13.5"/>',
      1.25,
    ),
  },

  /** Git branch: two top circles and one bottom circle joined by an elbow. */
  branch: {
    width: 12,
    height: 12,
    svg: outline(
      "0 0 12 12",
      '<circle cx="3" cy="2.5" r="1.75"/><circle cx="9" cy="2.5" r="1.75"/><circle cx="3" cy="9.5" r="1.75"/><path d="M3 4.25V6H9"/>',
      1.1,
    ),
  },

  /** Terminal prompt: a right chevron over an underscore. */
  terminal: {
    width: 16,
    height: 16,
    svg: outline("0 0 16 16", '<path d="M2 1L7 5L2 9"/><path d="M7 9H13"/>'),
  },

  /** Folder outline with a tab on the upper left. */
  folder: {
    width: 16,
    height: 16,
    svg: outline(
      "0 0 16 16",
      '<path d="M1 1.5H6.5L8 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V13.5C14.5 14.0523 14.0523 14.5 13.5 14.5H1.5C0.947715 14.5 0.5 14.0523 0.5 13.5V2.5C0.5 1.94772 0.947715 1.5 1.5 1.5H1Z"/>',
    ),
  },

  /** The Anthropic sunburst mark. */
  sunburst: {
    width: 16,
    height: 16,
    svg: filled(
      "0 0 16 16",
      '<path d="M6.55 9L7.5 14.5L8.45 9ZM5.93 8.32L4 13.56L7.57 9.27ZM5.73 7.43L1.44 11L6.68 9.07ZM6 6.55L0.5 7.5L6 8.45ZM6.68 5.93L1.44 4L5.73 7.57ZM7.57 5.73L4 1.44L5.93 6.68ZM8.45 6L7.5 0.5L6.55 6ZM9.07 6.68L11 1.44L7.43 5.73ZM9.27 7.57L13.56 4L8.32 5.93ZM9 8.45L14.5 7.5L9 6.55ZM8.32 9.07L13.56 11L9.27 7.43ZM7.43 9.27L11 13.56L9.07 8.32Z"/>',
    ),
  },

  /** The empty-state mascot, traced pixel by pixel from the reference. */
  robot: {
    width: 34,
    height: 23,
    svg: filled(
      "0 0 34 23",
      '<path d="M5 0h24v1h-24zM5 1h24v1h-24zM5 2h4v1h-4zM11 2h12v1h-12zM26 2h3v1h-3zM5 3h3v1h-3zM12 3h11v1h-11zM26 3h3v1h-3zM5 4h3v1h-3zM12 4h11v1h-11zM26 4h3v1h-3zM0 5h8v1h-8zM11 5h12v1h-12zM26 5h8v1h-8zM0 6h34v1h-34zM0 7h34v1h-34zM0 8h34v1h-34zM0 9h34v1h-34zM0 10h34v1h-34zM5 11h24v1h-24zM5 12h24v1h-24zM5 13h24v1h-24zM5 14h24v1h-24zM5 15h24v1h-24zM5 16h24v1h-24zM5 17h3v1h-3zM11 17h3v1h-3zM20 17h3v1h-3zM26 17h3v1h-3zM5 18h3v1h-3zM11 18h3v1h-3zM20 18h3v1h-3zM26 18h3v1h-3zM5 19h3v1h-3zM11 19h3v1h-3zM20 19h3v1h-3zM26 19h3v1h-3zM5 20h3v1h-3zM11 20h3v1h-3zM20 20h3v1h-3zM26 20h3v1h-3zM5 21h3v1h-3zM11 21h3v1h-3zM20 21h3v1h-3zM26 21h3v1h-3zM5 22h3v1h-3zM11 22h3v1h-3zM20 22h3v1h-3zM26 22h3v1h-3z"></path>',
    ),
  },
} satisfies Record<string, ShellArtwork>;

/** Glyph name accepted by {@link shellSymbolId}. */
export type ShellGlyph = keyof typeof SHELL_ARTWORK;

/**
 * Name the sprite symbol that carries one shell glyph.
 * @param glyph - glyph key in {@link SHELL_ARTWORK}.
 * @returns the `dsh-shell-icon-<glyph>` element id.
 */
export function shellSymbolId(glyph: ShellGlyph): string {
  return `dsh-shell-icon-${glyph}`;
}

/** Every shell symbol document, keyed by symbol id. */
export const SHELL_SYMBOLS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SHELL_ARTWORK).map(([glyph, artwork]) => [
      shellSymbolId(glyph as ShellGlyph),
      artwork.svg,
    ]),
  ),
);
