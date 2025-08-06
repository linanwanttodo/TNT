import {
  LumpToolbar,
  useHasLumpToolbarContent,
} from "./LumpToolbar/LumpToolbar";

/**
 * The strip that sits above the editor inside the composer card. It carries
 * state-dependent controls (streaming, pending tool calls) and, when idle,
 * nothing at all.
 */
export function Lump() {
  const hasContent = useHasLumpToolbarContent();

  // An empty band above the editor reads as a stray divider, so the strip
  // goes away entirely rather than rendering an empty row.
  if (!hasContent) {
    return null;
  }

  return (
    <div className="composer-strip">
      <div className="composer-strip-inner">
        <LumpToolbar />
      </div>
    </div>
  );
}
