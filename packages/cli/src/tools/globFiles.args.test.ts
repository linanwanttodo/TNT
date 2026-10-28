import path from "path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above the module body, so the spy has to be built inside
// the hoisted block or the factory reads a name that does not exist yet.
// `promisify.custom` is reached through its registered symbol for the same
// reason: a top-level `util` import is not resolved before the factory runs.
const proc = vi.hoisted(() => {
  const calls: any[] = [];
  const execFile: any = (...args: any[]) => {
    calls.push(args);
    const done = args[args.length - 1];
    done(null, "", "");
    return {};
  };
  execFile[Symbol.for("nodejs.util.promisify.custom")] = (
    file: any,
    args: any,
    options: any,
  ) =>
    new Promise((resolve, reject) => {
      execFile(file, args, options, (err: any, stdout: any, stderr: any) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { calls, execFile };
});

vi.mock("child_process", () => ({ execFile: proc.execFile }));
vi.mock("./searchCode.js", () => ({
  checkIfRipgrepIsInstalled: async () => true,
}));

import { globFilesTool } from "./globFiles.js";

/**
 * `globFiles.test.ts` runs the real search program. These cases read the spawn
 * instead, because the claim is about where a pattern is anchored, and the three
 * supported platforms spell the same temporary directory differently enough that
 * only the argument list is something they all agree on.
 */
describe("the Glob tool's spawn contract", () => {
  beforeEach(() => {
    proc.calls.length = 0;
  });

  it("asks for the pattern against the directory it was given", async () => {
    // A directory that exists and is not the one the run sits in.
    const target = path.resolve(process.cwd(), "..");

    await globFilesTool.run({ pattern: "src/**/*.ts", path: target });

    const searched = proc.calls.filter((args: any[]) =>
      args[1]?.includes("--files"),
    );
    expect(searched.length).toBe(1);

    const [, args, options] = searched[0] as any[];
    expect(args).toContain("--glob");
    expect(args).toContain("src/**/*.ts");
    expect(args).toContain(target);
    // A `--glob` with a slash in it is anchored at the working directory, so the
    // listing has to run from the directory the pattern was written against.
    expect(options.cwd).toBe(target);
  });

  it("lists the workspace when no path is named", async () => {
    await globFilesTool.run({ pattern: "**/*.md" });

    const [, args, options] = proc.calls[0] as any[];
    expect(args).toContain(process.cwd());
    expect(options.cwd).toBe(process.cwd());
  });
});
