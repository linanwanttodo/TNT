import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { walkDir } from "core/indexing/walkDir.js";
import FileSystemIde from "core/util/filesystem.js";
import { getIndexSqlitePath } from "core/util/paths.js";
import { localPathToUri } from "core/util/pathToUri.js";
import { getParserForFile } from "core/util/treeSitter.js";

import { logger } from "../utils/logger.js";

/**
 * The local knowledge layer for declarations: a bounded, fingerprinted index
 * of the names a workspace declares, built by parsing files with the
 * tree-sitter grammars the CLI already ships. It answers "where is X
 * declared" with no language server configured and no network request, and
 * it is the layer a caller consults first - a miss there is what justifies
 * reaching for the heavier tools.
 */

const MAX_INDEXED_FILES = 600;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SYMBOLS_PER_FILE = 200;
const STORE_VERSION = 1;

/**
 * Node types that carry a `name` field but are not declarations a reader is
 * looking for: parameters, object keys and interface members would drown the
 * index in every identifier of the workspace.
 */
const NOISY_DECLARATION_TYPES = new Set([
  "required_parameter",
  "optional_parameter",
  "rest_parameter",
  "pair",
  "property",
  "property_signature",
  "method_signature",
  "abstract_method_signature",
  "public_field_definition",
  "field_declaration",
  "decorator",
]);

export interface IndexedSymbol {
  name: string;
  /** The grammar's node type, e.g. "function_declaration". */
  kind: string;
  /** 1-based line of the declaration. */
  line: number;
}

export interface SymbolIndexHit {
  path: string;
  name: string;
  kind: string;
  line: number;
}

interface StoredWorkspace {
  fingerprint: string;
  files: Record<string, IndexedSymbol[]>;
}

interface StoreShape {
  version: 1;
  workspaces: Record<string, StoredWorkspace>;
}

function storePath(): string {
  return path.join(path.dirname(getIndexSqlitePath()), "symbol-index.json");
}

function workspaceKey(root: string): string {
  return root.toLowerCase();
}

function readStore(file: string): StoreShape {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as StoreShape;
    if (parsed?.version === STORE_VERSION && parsed.workspaces) {
      return parsed;
    }
  } catch {
    // A missing or unreadable store is an empty index, not a failure.
  }
  return { version: STORE_VERSION, workspaces: {} };
}

function writeStore(file: string, store: StoreShape): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store));
    fs.renameSync(temporary, file);
  } catch (error) {
    // Persistence is an optimisation: a read-only home still gets this
    // turn's answer, and only the next build pays for it again.
    logger.debug("Symbol index store not written", { error });
  }
}

/** True when the index layer is switched off for the process. */
export function isSymbolIndexDisabled(): boolean {
  const value = (process.env.TNT_SYMBOL_INDEX ?? "").trim().toLowerCase();
  return value === "0" || value === "false" || value === "off";
}

/**
 * Extracts the declarations of one file. A node counts when its grammar
 * names it through a `name` field and that name is a plain identifier, which
 * covers functions, classes, methods, variables, types, interfaces, enums,
 * structs and traits across the languages the CLI ships grammars for. The
 * depth cap keeps the index to file scope and class members: a binding local
 * to one function body is a name-search question, not a declaration lookup.
 */
export async function declarationsForFile(
  filepath: string,
  contents: string,
): Promise<IndexedSymbol[] | undefined> {
  const parser = await getParserForFile(filepath);
  if (!parser) return undefined;
  try {
    const tree = parser.parse(contents);
    const rootNode = tree.rootNode;
    const symbols: IndexedSymbol[] = [];
    const seen = new Set<string>();
    const visit = (node: typeof rootNode, depth: number): void => {
      if (depth > 3 || symbols.length >= MAX_SYMBOLS_PER_FILE) return;
      const nameNode =
        !NOISY_DECLARATION_TYPES.has(node.type) && node.childCount > 0
          ? node.childForFieldName("name")
          : null;
      if (nameNode && nameNode.childCount === 0 && nameNode.text) {
        const key = `${nameNode.text}|${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push({
            name: nameNode.text,
            kind: node.type,
            line: node.startPosition.row + 1,
          });
        }
      }
      for (const child of node.namedChildren) {
        visit(child, depth + 1);
      }
    };
    visit(rootNode, 0);
    tree.delete();
    return symbols;
  } catch (error) {
    logger.debug("Symbol index could not parse a file", { filepath, error });
    return undefined;
  }
}

interface WorkspaceIndex {
  fingerprint: string;
  files: Map<string, IndexedSymbol[]>;
}

const indexCache = new Map<string, WorkspaceIndex>();

/** Test seam: a changed workspace or a new process starts cold. */
export function forgetSymbolIndex(root: string): void {
  indexCache.delete(workspaceKey(root));
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const uri = localPathToUri(root);
  const ide = new FileSystemIde(uri, "cli");
  const found = await walkDir(uri, ide, { include: "files" });
  return found
    .map((entry) => fileURLToPath(entry))
    .filter((file) => file.startsWith(root + path.sep))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function fingerprintOf(
  root: string,
  files: readonly string[],
): string | undefined {
  const hash = createHash("sha256");
  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return undefined;
    }
    hash.update(
      `${path.relative(root, file)}|${stat.size}|${Math.round(stat.mtimeMs)}\n`,
    );
  }
  return hash.digest("hex").slice(0, 16);
}

/** The bounded file set the index covers, plus the fingerprint over it. */
async function selectIndexFiles(
  root: string,
): Promise<{ files: string[]; fingerprint: string } | undefined> {
  const walked = await walkSourceFiles(root);
  const files: string[] = [];
  for (const file of walked) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    files.push(file);
    if (files.length >= MAX_INDEXED_FILES) break;
  }
  const fingerprint = fingerprintOf(root, files);
  return fingerprint ? { files, fingerprint } : undefined;
}

async function parseWorkspaceIndex(
  root: string,
  files: readonly string[],
): Promise<Map<string, IndexedSymbol[]>> {
  const index = new Map<string, IndexedSymbol[]>();
  for (const file of files) {
    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const symbols = await declarationsForFile(file, contents);
      if (symbols && symbols.length > 0) {
        index.set(path.relative(root, file).split(path.sep).join("/"), symbols);
      }
    } catch (error) {
      // One unreadable or unparseable file is skipped, not fatal.
      logger.debug("Symbol index skipped a file", { file, error });
    }
  }
  return index;
}

async function workspaceIndex(
  root: string,
): Promise<WorkspaceIndex | undefined> {
  const key = workspaceKey(root);
  const cached = indexCache.get(key);
  if (cached) return cached;

  const absolute = path.resolve(root);
  const selection = await selectIndexFiles(absolute);
  if (!selection) return undefined;

  const store = readStore(storePath());
  const stored = store.workspaces[workspaceKey(absolute)];
  if (stored && stored.fingerprint === selection.fingerprint) {
    const index = {
      fingerprint: stored.fingerprint,
      files: new Map(Object.entries(stored.files)),
    };
    indexCache.set(key, index);
    return index;
  }

  const files = new Map<string, IndexedSymbol[]>(
    await parseWorkspaceIndex(absolute, selection.files),
  );
  const built = { fingerprint: selection.fingerprint, files };
  indexCache.set(key, built);
  store.workspaces[workspaceKey(absolute)] = {
    fingerprint: built.fingerprint,
    files: Object.fromEntries(built.files),
  };
  writeStore(storePath(), store);
  return built;
}

/**
 * The declaration locations the local index has for `query`, exact matches
 * (case-insensitive) only. `undefined` means the layer is off or could not
 * be built - a miss that hands the question back to the caller's tools.
 */
export async function lookupLocalSymbols(
  root: string,
  query: string,
  limit = 5,
): Promise<SymbolIndexHit[] | undefined> {
  if (isSymbolIndexDisabled()) return undefined;
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return undefined;
  try {
    const index = await workspaceIndex(root);
    if (!index) return undefined;
    const wanted = trimmed.toLowerCase();
    const hits: SymbolIndexHit[] = [];
    for (const [file, symbols] of index.files) {
      for (const symbol of symbols) {
        if (symbol.name.toLowerCase() !== wanted) continue;
        hits.push({
          path: file,
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
        });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  } catch (error) {
    logger.debug("Symbol index lookup failed", { root, query, error });
    return undefined;
  }
}
