import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const APIS_DIR = fileURLToPath(new URL(".", import.meta.url));

const CEILING = "ANTHROPIC_MAX_CACHE_BREAKPOINTS";
const KEPT = "ANTHROPIC_BREAKPOINTS_KEPT";

const declaration = (name: string) =>
  new RegExp(`export const ${name} = (\\d+);`);

describe("the two breakpoint numbers are different numbers", () => {
  const sources = readdirSync(APIS_DIR).filter(
    (file) => file.endsWith(".ts") && !file.includes(".test."),
  );
  const bodies = new Map(
    sources.map((file) => [file, readFileSync(APIS_DIR + file, "utf8")]),
  );

  it("declares the provider ceiling exactly once, at four", () => {
    // Floor first: a scan that read nothing would otherwise pass by finding no
    // offender, which is how a guard goes mute without going red.
    expect(sources.length).toBeGreaterThan(15);
    expect(bodies.has("AnthropicUtils.ts")).toBe(true);
    expect(bodies.has("cacheControl.ts")).toBe(true);

    const found = [...bodies].filter(([, text]) =>
      declaration(CEILING).test(text),
    );
    expect(found.map(([file]) => file)).toEqual(["AnthropicUtils.ts"]);
    expect(found[0][1].match(declaration(CEILING))?.[1]).toBe("4");
  });

  it("declares the send policy exactly once, at two", () => {
    const found = [...bodies].filter(([, text]) =>
      declaration(KEPT).test(text),
    );
    expect(found.map(([file]) => file)).toEqual(["cacheControl.ts"]);
    expect(found[0][1].match(declaration(KEPT))?.[1]).toBe("2");
  });

  it("never narrows the body with the provider ceiling", () => {
    // The request-narrowing call used to read
    // `capBreakpointsForAnthropic(pruned, ANTHROPIC_MAX_CACHE_BREAKPOINTS)`
    // while that name held 2 here and 4 in `AnthropicUtils.ts`, so which module
    // the caller imported decided how much of the request stayed cached. Only
    // the send policy may decide that.
    const offenders = [...bodies]
      .filter(([, text]) =>
        /capBreakpointsForAnthropic\([^)]*\bANTHROPIC_MAX_CACHE_BREAKPOINTS\b/.test(
          text,
        ),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
