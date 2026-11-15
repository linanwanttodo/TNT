import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const EVENTS = ["loading", "ready", "error", "changed"];

/**
 * Every subscriber in the TUI reaches the shared container through these two
 * hooks, and the container tolerates 50 handlers per event before it warns. A
 * handler taken without being given back stays attached to a closure over
 * unmounted state, invisible until a long session has spent the warning. This
 * reads the source for the one property that matters, so it needs no renderer.
 */
function countHandlers(source: string, method: string, event: string): number {
  const pattern =
    "container\\." + method + "\\(\\`\\$\\{[^}]+\\}:" + event + "\\`";
  return (source.match(new RegExp(pattern, "g")) ?? []).length;
}

describe("the lifecycle handlers the service hooks take out", () => {
  it("gives back every handler it registers, per event", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "useService.ts"),
      "utf-8",
    );

    for (const event of EVENTS) {
      const taken = countHandlers(source, "on", event);
      const givenBack = countHandlers(source, "off", event);

      expect(taken, event).toBeGreaterThan(0);
      expect(givenBack, event).toBe(taken);
    }
  });
});
