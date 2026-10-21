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
  // surface and were invisible to both scans until now. What is left here is what a
  // Chinese-speaking user is meant to leave alone: example command lines, whose flags
  // and arguments are tokens, and the `Error:` label that prefixes a hook's own reason.
  // Two rows that first appeared here have been translated - `index.ts`'s prompt refusal
  // with its "Usage examples:" label, and `flagValidator.ts`'s count-bearing summary - and
  // nine e2e cases assert the English wording of the former while staying green without a
  // locale pin, because the harness's child does not inherit this box's
  // `LANG=zh_CN.UTF-8` the way a bare `node dist/tnt.js` run does.
  //
  // Read a row as a site, not as printed text: an interpolation is stripped, so English
  // that lives *inside* one is hidden from the entry. `flagValidator.ts:348` reads
  // "Found validation errors." here but really prints "Found 3 validation errors.", and
  // `chat.ts:729` shows a bare "Error:" while the sentence sat in the `??` default. The
  // throw shape outside `src/commands/**` is counted by the ratchet below, which measures 138
  // raw sites there today. `flagValidator.ts:353` "Exiting due to validation errors".
  "commands/chat.ts :: Error:",
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

/**
 * Thrown copy outside `src/commands/**`. That directory is held to zero raw throws by
 * `src/commands/outputCopy.test.ts`, which lists every message there by text; the rest of
 * `src` holds far too many to freeze one row per string, so the ratchet here is a count per
 * top-level directory. Equality makes it self-flooring: a scan that broke would report an
 * empty object rather than a passing one, and translating a message lowers its directory's
 * number, which has to be edited down here in the same commit - the release form, not an
 * accident.
 *
 * Measured 2026-10-20 with the argument read by a paren counter rather than a lazy `);`:
 * 33 occurrences left, after the translation lane took this total down from 138. The two
 * sites the head-only rule could not see are in - the `?? "Failed to load assistant."`
 * default in `config/loader.ts` and the ternary arm of `Tool <name> not found` in
 * `services/MCPService.ts` - and both were translated in the commit that widened the scan.
 *
 * What is left is deliberate English under the owner's 2026-10-17 split, or structurally
 * blocked, and this list is the whole record of that:
 * - diagnostics: the `Error reading/list/searching` prefixes in `tools`, the
 *   `Failed to fetch diff/state: <status>` throws in the remote hooks, the storage and
 *   artifact `... failed ():` lines, `HTTP <status> from <url>`, `Client for <name> not
 *   available` / `Connection <name> not found` (internal state), and the three
 *   `Request aborted` markers in `utils/exponentialBackoff.ts`, which a test asserts by text;
 * - control flow that never reaches a reader: `Exiting due to validation errors`, and
 *   `Rule file not found`, which its own `catch` immediately re-throws as a read failure;
 * - the two `utils` wrappers, which stay English by measurement, not by blockage:
 *   `Request failed:` only wraps what the typed `AuthenticationRequiredError` /
 *   `ApiRequestError` let through, so it is shown wherever a caller prints a cause and has no
 *   single display point to translate at; the environment-install throw sits beside an
 *   identical `logger.error` and is a setup diagnostic. (`utils` still may not import the
 *   table - see `architecture.test.ts` - but moving these to call sites would be a structural
 *   rewrite for two prefixes);
 * - measured since: only `utils -> <group>` is constrained (except config/services/session/
 *   telemetry), so `subagent`, `permissions` and this types module took the import with the
 *   architecture guard green; `lsp` is the one leaf still uninspected.
 * A new raw throw still turns this red; translating one of the above lowers its number here.
 */
const RAW_THROWN_COPY_OUTSIDE_COMMANDS: Record<string, number> = {
  config: 2,
  plugins: 1,
  services: 6,
  tools: 4,
  ui: 7,
  utils: 5,
};

/**
 * The argument list of every `throw new …Error(`, read with a paren counter rather than a
 * lazy `);`: a lazy match stops at the first `)` inside the expression, which is how English
 * sitting in `errors.map(…).join("\n") ?? "Failed to load assistant."` stayed invisible.
 * A quoted run is skipped as a unit, so a `)` inside a message string cannot unbalance it.
 */
function throwArguments(source: string): string[] {
  const args: string[] = [];

  for (const call of source.matchAll(/throw new (?:[A-Za-z]*Error)\(/g)) {
    let depth = 1;
    let quote: string | null = null;
    let out = "";

    for (let i = (call.index ?? 0) + call[0].length; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        out += ch;
        if (ch === "\\") {
          out += source[i + 1] ?? "";
          i++;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        out += ch;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      out += ch;
    }

    args.push(out);
  }

  return args;
}

function thrownCopyCountByDirectory(): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of everyProductionSource(src)) {
    const relative = path.relative(src, file);
    if (relative.startsWith("commands" + path.sep)) continue;
    const bucket = relative.includes(path.sep)
      ? relative.split(path.sep)[0]
      : "(src root)";

    for (const arg of throwArguments(fs.readFileSync(file, "utf-8"))) {
      const head = arg.trim();
      const quote = head[0];
      // `t("…")` is already translated, and a re-thrown error is not copy.
      if (quote === "t" && head[1] === "(") continue;
      if (quote === '"' || quote === "'" || quote === "`") {
        const literal = head
          .slice(1, head.indexOf(quote, 1))
          .replace(/\$\{[^{}]*\}/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (/[A-Za-z]{4,}/.test(literal)) {
          counts[bucket] = (counts[bucket] ?? 0) + 1;
        }
        continue;
      }
      // English deeper in the same argument: a `??` / `||` fallback or a ternary branch. Two
      // words is the floor, so a code, a flag or a single token in quotes does not count.
      for (const inner of arg.matchAll(
        /(?:\?\?|\|\||:)\s*(["'`])([\s\S]{1,200}?)\1/g,
      )) {
        const literal = (inner[2] ?? "")
          .replace(/\$\{[^{}]*\}/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!/(?:[A-Za-z]{2,}[\s,.'/:;()-]+){2,}/.test(literal)) continue;
        counts[bucket] = (counts[bucket] ?? 0) + 1;
      }
    }
  }

  return counts;
}

describe("the copy the rest of the CLI throws", () => {
  it("adds no raw thrown message outside the counted directories", () => {
    expect(thrownCopyCountByDirectory()).toEqual(
      RAW_THROWN_COPY_OUTSIDE_COMMANDS,
    );
  });
});
