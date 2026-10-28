/**
 * Turning what each tool answers into ranked hits, and resolving the labelled
 * markers to the lines they name.
 *
 * CodebaseSearch is scored from the retrieval layer's own ranked list: the tool
 * around it only formats and caps what the layer already ordered, so ranking it
 * here is ranking what the model sees. Search and Glob are scored from their
 * tool output, because for those two the answer *is* the tool's formatting.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { EvalQuery, ToolName } from "./labels.js";
import { RankedHit, ResolvedExpectation } from "./metrics.js";

/** Every file under the corpus root, as a corpus-relative path. */
export function corpusFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return found.sort();
}

export interface LabelProblem {
  file: string;
  marker: string;
  why: string;
}

/**
 * A label is only worth anything while its marker sits on exactly one line of
 * the file it names, so a fixture edit that moves, duplicates or deletes the
 * phrase is reported here rather than scored against a line nobody can find.
 */
export function resolveExpectations(
  root: string,
  queries: EvalQuery[],
): { resolved: Map<string, ResolvedExpectation[]>; problems: LabelProblem[] } {
  const lineCache = new Map<string, string[]>();
  const read = (file: string): string[] => {
    let lines = lineCache.get(file);
    if (!lines) {
      lines = fs.readFileSync(path.join(root, file), "utf-8").split(/\r?\n/);
      lineCache.set(file, lines);
    }
    return lines;
  };

  const resolved = new Map<string, ResolvedExpectation[]>();
  const problems: LabelProblem[] = [];

  for (const query of queries) {
    const list: ResolvedExpectation[] = [];
    for (const expectation of query.expect) {
      if (!fs.existsSync(path.join(root, expectation.file))) {
        problems.push({
          file: expectation.file,
          marker: expectation.marker,
          why: `query ${query.id} labels a file the corpus does not contain`,
        });
        continue;
      }
      const hits = read(expectation.file)
        .map((line, index) =>
          line.includes(expectation.marker) ? index + 1 : 0,
        )
        .filter((line) => line > 0);
      if (hits.length !== 1) {
        problems.push({
          file: expectation.file,
          marker: expectation.marker,
          why: `${query.id}: "${expectation.marker}" matched ${hits.length} lines in ${expectation.file}, expected exactly 1`,
        });
        continue;
      }
      list.push({ ...expectation, line: hits[0] });
    }
    resolved.set(query.id, list);
  }

  return { resolved, problems };
}

/** The retrieval layer's ranked chunks, with absolute paths made corpus-relative. */
export function fromRetrievalHits(
  root: string,
  hits: { filepath: string; startLine: number; endLine: number }[],
): RankedHit[] {
  return hits.map((hit) => ({
    file: relative(root, hit.filepath),
    startLine: hit.startLine,
    endLine: hit.endLine,
  }));
}

/** `Search` answers with `<path>:<line>:<text>` lines under a header. */
export function fromSearchOutput(root: string, output: string): RankedHit[] {
  const hits: RankedHit[] = [];
  for (const line of output.split("\n")) {
    const match = /^(.*?):(\d+):/.exec(line);
    if (!match) {
      continue;
    }
    const startLine = Number(match[2]);
    hits.push({
      file: relative(root, match[1]),
      startLine,
      endLine: startLine,
    });
  }
  return hits;
}

/** `Glob` answers with bare paths, newest first, and a trailing note when capped. */
export function fromGlobOutput(root: string, output: string): RankedHit[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("("))
    .map((line) => ({ file: relative(root, line) }));
}

function relative(root: string, target: string): string {
  // The index reports the workspace as the operating system canonicalized it,
  // while the run created it through another spelling of the same file:
  // `/private/var` where the temp directory says `/var` on macOS, and on Windows
  // `realpath` answered one side with the 8.3 short form (`C:\Users\RUNNER~1\...`)
  // and the other with the long name. Subtracting those walks out of the corpus
  // instead of naming a file in it, and reads as "the tool found nothing".
  const plain = target.startsWith("file:") ? fileURLToPath(target) : target;
  const absolute = path.isAbsolute(plain) ? plain : path.resolve(root, plain);

  // Identity first: both spellings of every corpus file, resolved.
  const indexed = identities(root);
  const known = indexed.byPath.get(canonical(absolute));
  if (known) {
    return known;
  }

  // Then the only tail the two spellings are guaranteed to agree on: the corpus
  // directory the run created and everything under it. Windows gave realpath a
  // short name on one side and a long name on the other, and neither resolved
  // through the other, so no amount of canonicalizing matches them - the suffix
  // below is what survives both.
  const tail = `/${forward(path.basename(root))}/`;
  const normalized = forward(absolute).toLowerCase();
  for (const rel of indexed.names) {
    if (normalized.endsWith(tail + forward(rel).toLowerCase())) {
      return rel;
    }
  }

  return forward(path.relative(canonical(root), canonical(absolute)));
}

function forward(file: string): string {
  return file.split(path.sep).join("/");
}

interface CorpusIdentities {
  byPath: Map<string, string>;
  names: string[];
}

const identitiesByRoot = new Map<string, CorpusIdentities>();

/** Every corpus file, under each spelling it is reachable by. */
function identities(root: string): CorpusIdentities {
  const cached = identitiesByRoot.get(root);
  if (cached) {
    return cached;
  }
  const byPath = new Map<string, string>();
  const names = corpusFiles(root);
  for (const rel of names) {
    const given = path.resolve(root, rel);
    byPath.set(given, rel);
    try {
      byPath.set(fs.realpathSync(given), rel);
    } catch {
      // An unresolvable file keeps only the spelling it was given; the suffix
      // rule above still answers for it.
    }
  }
  const created = { byPath, names };
  identitiesByRoot.set(root, created);
  return created;
}

function canonical(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    // A path that cannot be resolved is used as given; it will simply not match,
    // which is the same answer the old string comparison gave.
    return path.resolve(file);
  }
}

export type Runner = (tool: ToolName, query: string) => Promise<RankedHit[]>;
