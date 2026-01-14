import type { DOMElement } from "ink";
import { useEffect, useRef, type RefObject } from "react";

import { registerClickRegion } from "../utils/clickRegions.js";

/**
 * Makes the box behind `ref` clickable. The handler is read through a ref so a
 * region registered once does not need to be re-registered on every render.
 */
export function useClickRegion(
  ref: RefObject<DOMElement | null>,
  onClick: () => void,
): void {
  const handlerRef = useRef(onClick);
  handlerRef.current = onClick;

  useEffect(
    () =>
      registerClickRegion(
        () => ref.current,
        () => handlerRef.current(),
      ),
    [ref],
  );
}
