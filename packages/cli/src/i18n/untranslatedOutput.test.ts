import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Everything outside this list is a refusal that a Chinese-speaking user meets in
 * English. Each entry is a file and the literal text it prints, not a line
 * number: translating one of these must never turn this guard red, and a line
 * that moved for an unrelated reason must not either.
 *
 * The list is a ratchet, not an approval. `src/commands/**` is already held to
 * zero by its own guard; the rest is 25 sites that nothing checked before, and
 * turning them into a frozen set is what makes the next raw `console.error` a
 * test failure instead of folklore. Translating them changes copy users see, so
 * that is the owner's call, not something to do silently here.
 */
const KNOWN_UNTRANSLATED_OUTPUT = [
  "agent/systemMessage.ts :: Warning: Could not read agent configuration file:",
  'agent/systemMessage.ts :: Warning: Failed to process rule "":',
  "config/loader.ts :: Failed to load user assistants, falling back to default agent",
  "config/loader.ts :: Warning:",
  "index.ts :: Error: Unknown command ''\\n",
  "index.ts :: Filter this session: grep '\\\\[\\\\]'",
  "index.ts :: Logs:",
  "index.ts :: Verbose logging enabled (session: )",
  "platform/CLIPlatformClient.ts :: Error reading .env file at :",
  "platform/CLIPlatformClient.ts :: Error resolving FQSNs through API:",
  "startup/version.ts :: Warning: Could not read version from package.json",
  "ui/FileSearchUI.tsx :: Error filtering files:",
  "ui/FileSearchUI.tsx :: FileSearchUI: Filtered to files",
  'ui/FileSearchUI.tsx :: FileSearchUI: Filtering files with "", total files in state:',
  "ui/TUIChat.tsx :: Error loading session:",
  "ui/UserInput.tsx :: Error reading file :",
  "ui/hooks/useConfigSelector.ts :: Failed to open browser:",
  "ui/utils/historySplitting.ts :: Message splitting exceeded maximum iterations, stopping",
  "utils/fileWatcher.ts :: Error closing file watcher:",
  "utils/fileWatcher.ts :: Error in file watcher callback:",
  "utils/fileWatcher.ts :: Failed to create watcher for :",
  "utils/fileWatcher.ts :: Failed to watch directory :",
  "utils/fileWatcher.ts :: File watcher error for :",
  "utils/inputHistory.ts :: Failed to load input history:",
  "utils/inputHistory.ts :: Failed to save input history:",
];

const SKIP_DIRS = new Set(["node_modules", "dist", "test-utils", "__mocks__"]);

function productionSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.relative(src, full) !== "commands") {
        found.push(...productionSources(full));
      }
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes(".test.")
    ) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The message is the first argument to `console.log`, `console.error` or
 * `console.warn`, which may sit on the next line and may be wrapped in a colour
 * call. Only its literal part is copy: an interpolation is a value.
 */
function untranslatedOutput(): string[] {
  const offenders: string[] = [];

  for (const file of productionSources(src)) {
    const source = fs.readFileSync(file, "utf-8");
    for (const call of source.matchAll(
      /console\.(?:log|error|warn)\(\s*(?:chalk\.\w+\(\s*)?(["'`])([\s\S]{0,200}?)\1/g,
    )) {
      const literal = (call[2] ?? "")
        .replace(/\$\{[\s\S]*?\}/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/[A-Za-z]{4,}/.test(literal)) continue;
      offenders.push(`${path.relative(src, file)} :: ${literal}`);
    }
  }

  return [...new Set(offenders)].sort();
}

describe("the copy the rest of the CLI prints", () => {
  it("adds no raw English message outside the frozen list", () => {
    const offenders = untranslatedOutput();

    expect(
      offenders.filter(
        (offender) => !KNOWN_UNTRANSLATED_OUTPUT.includes(offender),
      ),
    ).toEqual([]);
  });

  it("keeps the frozen list down to the sites that still print", () => {
    const offenders = new Set(untranslatedOutput());

    expect(
      KNOWN_UNTRANSLATED_OUTPUT.filter((known) => !offenders.has(known)),
    ).toEqual([]);
  });
});
