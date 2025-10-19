import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const hooksDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * `HookHandler` is a union of interfaces discriminated on `type`, and the
 * runner switches on that field. A fifth variant would compile while no case
 * ran it - the same silent-inert failure the hook events had, where a plugin or
 * a settings file asks for something that never happens.
 *
 * The check lives inside `executeHandler`, because that is where the promise is
 * kept. A case label elsewhere in the file proves nothing: the dedupe key has
 * its own switch, and breaking only the dispatch label is exactly the mistake
 * this guard had when it first searched the whole file.
 */
function declaredHandlerTypes(): string[] {
  const types = fs.readFileSync(path.join(hooksDir, "types.ts"), "utf-8");
  return [
    ...new Set(
      [...types.matchAll(/^\s*type:\s*"([a-z]+)"/gm)].map((match) => match[1]),
    ),
  ].sort();
}

function executeHandlerBody(runner: string): string {
  const start = runner.indexOf("async function executeHandler(");
  if (start < 0) return "";
  const open = runner.indexOf("{", start);
  let depth = 0;
  let close = open;
  while (close < runner.length) {
    if (runner[close] === "{") {
      depth += 1;
    } else if (runner[close] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
    close += 1;
  }
  return runner.slice(open, close);
}

describe("the hook handler types the runner accepts", () => {
  const runner = fs.readFileSync(path.join(hooksDir, "hookRunner.ts"), "utf-8");
  const body = executeHandlerBody(runner);

  it("reads the dispatch body and a real set of handler types", () => {
    expect(body.length).toBeGreaterThan(100);
    expect(declaredHandlerTypes().length).toBeGreaterThanOrEqual(4);
  });

  it("dispatches every declared type to its implementation", () => {
    const undispatched = declaredHandlerTypes().filter((type) => {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      const reachesIt = new RegExp(
        `case "${type}":[\\s\\S]{0,160}execute${label}Hook\\(`,
      ).test(body);
      const implemented = new RegExp(`function execute${label}Hook\\b`).test(
        runner,
      );
      return !reachesIt || !implemented;
    });

    expect(undispatched).toEqual([]);
  });
});
