/*
 * The theme applies a superellipse to every corner, which bends a fully rounded
 * radius into a squircle and squares off capsule ends. corner-shape.css records
 * the contract: an uncapped radius has to opt out with `corner-shape: round` in
 * the same rule. This is the machine-readable half of that contract, so a new
 * circle cannot ship as a rounded square again.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A radius that reaches or passes half the box: a circle, an ellipse, a capsule. */
const UNCAPPED = /(?:^|[\s,(])(?:50%|100%|var\(--dsw-radius-full\)|\d{3,}px)/;

/** True when the rule's own box says a corner is fully rounded. */
function isUncapped(body: string): boolean {
  const radius = body.match(/(?:^|;)\s*border-radius:\s*([^;]+)/)?.[1];
  if (!radius) return false;
  if (UNCAPPED.test(radius)) return true;
  // A px radius is a circle only in relation to its box, which the rule states.
  const px = radius.match(/^\s*(\d+)px/);
  if (!px) return false;
  const sides = ["height", "width"]
    .map((side) =>
      Number(body.match(new RegExp(`(?:^|;)\\s*${side}:\\s*(\\d+)px`))?.[1]),
    )
    .filter((n) => Number.isFinite(n));
  return sides.some((side) => Number(px[1]) * 2 >= side);
}

function cssFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...cssFiles(path));
    else if (entry.endsWith(".css")) found.push(path);
  }
  return found.sort();
}

/** Every rule body with its selector, at any nesting depth. */
function rules(css: string): { selector: string; body: string }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selector: string; body: string }[] = [];
  for (const match of source.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().split("\n").pop()?.trim() ?? "";
    if (!selector.startsWith("@")) rules.push({ selector, body: match[2] });
  }
  return rules;
}

describe("corner-shape pairing", () => {
  it("keeps the theme rule this guard reads", () => {
    const theme = readFileSync("src/ui/theme/corner-shape.css", "utf8");
    expect(theme).toContain("@supports (corner-shape: superellipse(1.5))");
    expect(theme).toContain("corner-shape: var(--dsw-corner-shape)");
  });

  it("pairs every uncapped radius with corner-shape: round", () => {
    // src/ui/zcode is a verbatim port of ZCode's own stylesheet; rewriting
    // its radii would break the 1:1 with the upstream source.
    const PORTED = join("src", "ui", "zcode") + "/";
    const missing: string[] = [];
    for (const file of cssFiles("src")) {
      if (file.replaceAll("\\", "/").startsWith(PORTED)) continue;
      for (const rule of rules(readFileSync(file, "utf8"))) {
        if (!isUncapped(rule.body)) continue;
        if (!/corner-shape:\s*round/.test(rule.body))
          missing.push(`${file}  ${rule.selector}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
