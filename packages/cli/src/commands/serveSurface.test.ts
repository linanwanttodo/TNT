import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * `tnt serve` is an HTTP contract, and three artifacts have to agree about it: the
 * routes `serve.ts` registers, the endpoints the remote client calls, and
 * `spec/wire-format.md`, which is what an integrator reads. Two of the three agreed
 * when this file was written - the client called four routes and the spec named those
 * four, while `serve.ts` actually registers six (`pause` and `permission` were
 * reachable but undocumented, and nothing in this package calls them).
 *
 * Both directions are checked here from the sources that keep the promise, so adding
 * a route cannot leave the document behind and a client cannot start calling a path
 * nobody serves - which fails as a silent 404 in remote mode rather than an error.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const SERVE = path.join(packageRoot, "src", "commands", "serve.ts");
const CLIENT = path.join(
  packageRoot,
  "src",
  "ui",
  "hooks",
  "useChat.remote.helpers.ts",
);
const SPEC = path.join(packageRoot, "spec", "wire-format.md");

function routes(): string[] {
  const source = readFileSync(SERVE, "utf-8");
  return [
    ...new Set(
      [
        ...source.matchAll(
          /app\.(?:get|post|put|delete)\(\s*"\/([A-Za-z0-9_-]+)"/g,
        ),
      ].map((m) => m[1]),
    ),
  ].sort();
}

function clientCalls(): string[] {
  const source = readFileSync(CLIENT, "utf-8");
  return [
    ...new Set(
      [...source.matchAll(/remoteUrl\}\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
    ),
  ].sort();
}

describe("the serve HTTP surface agrees with its client and its spec", () => {
  const served = routes();
  const called = clientCalls();
  const spec = readFileSync(SPEC, "utf-8");

  it("reads a server that really registers routes", () => {
    // Without the floor, a pattern that stopped matching would agree with any spec.
    expect(served.length).toBeGreaterThanOrEqual(6);
  });

  it("documents every route the server registers", () => {
    expect(served.filter((route) => !spec.includes(`/${route}`))).toEqual([]);
  });

  it("serves every endpoint the remote client calls", () => {
    expect(called.length).toBeGreaterThanOrEqual(4);
    expect(called.filter((route) => !served.includes(route))).toEqual([]);
  });
});
