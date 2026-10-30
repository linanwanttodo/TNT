import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

/**
 * The README is the first command surface a reader tries. Its subcommands,
 * flags and the headless permission sentence are read back from the command
 * registration and the shared options, so a removed command or flag cannot
 * survive in the quick start.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(packageRoot, ...segments), "utf-8");
}

const readme = read("README.md");
const entry = read("src", "index.ts");
const shared = read("src", "config", "sharedOptions.ts");
const sessions = read("src", "session", "index.ts");
const policy = read("src", "permissions", "defaultPolicies.ts");
const loader = read("src", "config", "loader.ts");
const pkg = JSON.parse(read("package.json")) as { name: string };

const registered = [...entry.matchAll(/\.command\("([a-z][a-z-]*)/g)].map(
  (match) => match[1],
);

function codeLines(): string[] {
  const lines = readme.split("\n");
  const code: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) code.push(line);
  }
  return code;
}

describe("README quick start agrees with the command surface", () => {
  it("registers the commands the README lists", () => {
    expect(new Set(registered)).toEqual(
      new Set(["ls", "serve", "checks", "review", "webui"]),
    );
  });

  it("only invokes registered subcommands", () => {
    for (const line of codeLines()) {
      const match = line.match(/^tnt\s+(?!--)([a-z][a-z-]*)/);
      if (!match) continue;
      expect(registered).toContain(match[1]);
    }
  });

  it("does not advertise removed commands", () => {
    for (const gone of ["login", "logout", "remote"]) {
      expect(readme).not.toContain(`tnt ${gone}`);
      expect(registered).not.toContain(gone);
    }
  });

  it("only documents flags that exist", () => {
    const ownLines = [
      ...codeLines().filter((line) => /^(?:\|\s*)?tnt(?:\s|$)/.test(line)),
      ...readme.split("\n").filter((line) => /^- `(?:--|tnt )/.test(line)),
    ];
    const documented = new Set(
      ownLines.flatMap((line) => line.match(/--[a-z][a-z-]+/g) ?? []),
    );

    expect(documented.size).toBeGreaterThan(4);
    for (const flag of documented) {
      expect(entry + shared).toContain(`"${flag}`);
    }
  });

  it("installs from the GitHub release, not from a registry", () => {
    expect(pkg.name).toBe("@tnt/cli");
    expect(readme).toContain("scripts/install.sh");
    expect(readme).toContain("releases/latest");
    // The package is not published to npm; the README must not suggest it.
    expect(readme).not.toContain("npm i -g");
  });

  it("states the session limit the lister uses", () => {
    expect(sessions).toContain("limit: number = 100");
    expect(readme).toContain("up to 100 sessions");
    expect(readme).not.toContain("always shows 10");
  });

  it("matches the headless denial and its escape hatches", () => {
    expect(policy).toContain("A headless run cannot answer");
    expect(policy).toContain('--allow "*"');
    expect(policy).toContain("DONT_ASK_MODE_POLICIES");
    expect(readme).toMatch(/write tools and Bash are denied by\s+default/);
    expect(readme).toContain("--allow <tool>");
    expect(readme).toContain("--allow '*'");
  });

  it("describes --config as a local file", () => {
    expect(loader).toContain('t("config.slugRemoved")');
    expect(readme).toContain("hub slugs are refused");
  });
});
