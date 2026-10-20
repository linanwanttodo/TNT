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
 * The list is a ratchet, not an approval. `src/commands/**` is already held to zero
 * by its own guard (`src/commands/outputCopy.test.ts`, "sends every console message
 * through the translation table"); the rest are the sites below, which nothing checked
 * before, and freezing them is what makes the next raw `console.error` a test failure
 * instead of folklore. Count them here rather than trusting a number written in prose -
 * the one that used to sit above said "25 sites" against the thirteen real ones.
 * Translating them changes copy users see, so that is the owner's call, not something
 * to do silently here.
 *
 * The rule the owner set on 2026-10-17: translate what a user is meant to read (errors,
 * hints, interaction copy) and leave pure diagnostics in English. What stays listed here
 * after a translation round is therefore two kinds - not yet translated, and deliberately
 * English (watcher, history and component logs). The list is the record of that split.
 */
const KNOWN_UNTRANSLATED_OUTPUT = [
  "platform/CLIPlatformClient.ts :: Error reading .env file at :",
  "platform/CLIPlatformClient.ts :: Error resolving FQSNs through API:",
  "startup/version.ts :: Warning: Could not read version from package.json",
  "ui/FileSearchUI.tsx :: FileSearchUI: Filtered to files",
  'ui/FileSearchUI.tsx :: FileSearchUI: Filtering files with "", total files in state:',
  "ui/utils/historySplitting.ts :: Message splitting exceeded maximum iterations, stopping",
  "utils/fileWatcher.ts :: Error closing file watcher:",
  "utils/fileWatcher.ts :: Error in file watcher callback:",
  "utils/fileWatcher.ts :: Failed to create watcher for :",
  "utils/fileWatcher.ts :: Failed to watch directory :",
  "utils/fileWatcher.ts :: File watcher error for :",
  "utils/inputHistory.ts :: Failed to load input history:",
  "utils/inputHistory.ts :: Failed to save input history:",
  // The whole user-facing validation surface, in English; translating it is the
  // owner's call like the rest of this list, and freezing it is what stops a
  // seventeenth string from arriving unnoticed.
  //
  // The `safeStdout`/`safeStderr` writers (`src/startup/init.ts`) are a third print
  // surface and were invisible to both scans until now. Two of these rows are copy a
  // user is meant to read and are the next candidates; the rest are example command
  // lines and a bare `Error:` prefix - tokens, not prose. One row is not free to
  // translate on its own: `index.ts`'s "A prompt is required…" is asserted in English
  // by six e2e cases, and this box's `LANG=zh_CN.UTF-8` means a spawned CLI resolves
  // `zh-CN` (`npx tnt --mode bogus -p hi` prints 错误：… with no settings file at all),
  // so those cases pass today only because the string is still raw. Pinning the locale
  // in those fixtures is the prerequisite, not an optional cleanup.
  "commands/chat.ts :: Error:",
  "config/flagValidator.ts :: Found validation errors.",
  "index.ts :: Error: A prompt is required when using the -p/--print flag, unless --prompt, --agent, or --resume is provided.",
  "index.ts :: Usage examples:",
  'index.ts :: echo "hello" | tnt -p',
  'index.ts :: tnt -p "analyze the code in src/"',
  'index.ts :: tnt -p "please review my current git diff"',
  "index.ts :: tnt -p --agent my-org/my-agent",
  "index.ts :: tnt -p --prompt my-org/my-prompt",
  "index.ts :: tnt -p --resume",
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
 * `commands/**` belongs to `src/commands/outputCopy.test.ts` for the shapes it owns, but
 * the `safeStdout`/`safeStderr` writers are used in that directory too, and no guard had
 * them at all, so this one walk covers the whole of `src`.
 */
function everyProductionSource(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...everyProductionSource(full));
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes(".test.")
    ) {
      found.push(full);
    }
  }
  return found;
}

/** An escape sequence in a printed message is spacing, not copy. */
function copyOf(literal: string): string {
  return literal
    .replace(/\$\{[\s\S]*?\}/g, "")
    .replace(/\\[nrt]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The message is the first argument to `console.log`, `console.error` or
 * `console.warn`, which may sit on the next line and may be wrapped in a colour
 * call. Only its literal part is copy: an interpolation is a value.
 */
export function untranslatedOutput(): string[] {
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
    // A validation error's copy is the `message` field, not a console call, so the
    // scan above never saw it: sixteen `Error: ...` values in `config/flagValidator.ts`
    // reached the user in English while this guard stayed green.
    for (const call of source.matchAll(
      /(?:message|error):\s*(["'\`])([\s\S]{0,200}?)\1/g,
    )) {
      const literal = (call[2] ?? "")
        .replace(/\$\{[\s\S]*?\}/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!literal.startsWith("Error: ")) continue;
      offenders.push(`${path.relative(src, file)} :: ${literal}`);
    }
  }

  for (const file of everyProductionSource(src)) {
    const source = fs.readFileSync(file, "utf-8");
    for (const call of source.matchAll(
      /[^A-Za-z]safe(?:Stdout|Stderr)\(\s*(?:chalk\.\w+\(\s*)?(["'`])([\s\S]{0,300}?)\1/g,
    )) {
      const literal = copyOf(call[2] ?? "");
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
