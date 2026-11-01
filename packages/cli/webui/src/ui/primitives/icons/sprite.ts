/**
 * Document icon sprite.
 *
 * Every product glyph is published once as a `<symbol>` inside a hidden SVG
 * that lives at the top of `<body>`. Components reference the symbols with
 * `<use href="#dsw-icon-...">`, so the artwork is defined in one place and
 * inherits `currentColor` from the caller.
 */
import { ICON_SYMBOLS } from "./artwork.ts";
import { SHELL_SYMBOLS } from "../../shell/artwork.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Root attributes that must not be copied onto a symbol: the symbol inherits
 * its box from the referencing `<use>`, and `xmlns`/`class`/`aria-hidden` are
 * not meaningful there.
 */
const DROPPED_ATTRIBUTES = new Set([
  "width",
  "height",
  "xmlns",
  "class",
  "aria-hidden",
]);

/**
 * Turn one SVG document into a `<symbol>` the sprite can host.
 * @param id - element id of the resulting symbol.
 * @param markup - the SVG document source.
 * @returns a symbol element ready to be appended to the sprite.
 */
function toSymbol(id: string, markup: string): SVGSymbolElement {
  const root = new DOMParser().parseFromString(markup, "image/svg+xml")
    .documentElement;
  const symbol = document.createElementNS(SVG_NS, "symbol");
  for (const { name, value } of root.attributes) {
    if (!DROPPED_ATTRIBUTES.has(name)) {
      symbol.setAttribute(name, value);
    }
  }
  symbol.id = id;
  symbol.append(
    ...[...root.childNodes].map((node) => document.importNode(node, true)),
  );
  return symbol;
}

/**
 * Mount the icon sprite on the document.
 *
 * Safe to call more than once: the second call replaces the sprite instead of
 * appending a second one, so a hot reload cannot leave two copies behind.
 */
export function installIconSprite(): void {
  if (typeof document === "undefined") {
    return;
  }

  document.querySelector("[data-dsh-icon-sprite]")?.remove();

  const sprite = document.createElementNS(SVG_NS, "svg");
  sprite.setAttribute("aria-hidden", "true");
  sprite.setAttribute("data-dsh-icon-sprite", "");
  sprite.style.cssText =
    "position: absolute; width: 0; height: 0; overflow: hidden";

  for (const [id, markup] of Object.entries({
    ...ICON_SYMBOLS,
    ...SHELL_SYMBOLS,
  })) {
    sprite.append(toSymbol(id, markup));
  }

  document.body.prepend(sprite);
}
