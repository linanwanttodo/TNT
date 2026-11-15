import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { walkDir } from "core/indexing/walkDir.js";
import FileSystemIde from "core/util/filesystem.js";
import { getIndexSqlitePath } from "core/util/paths.js";
import { localPathToUri } from "core/util/pathToUri.js";

export type ImportKind =
  "typescript" | "python" | "go" | "java" | "rust" | "cpp";

export interface ImportEdge {
  specifier: string;
  kind: ImportKind;
  /** Workspace-relative target, or null when the specifier is external. */
  target: string | null;
}

export interface ImportHit {
  path: string;
  depth: number;
  via?: string;
}

interface StoredFile {
  cacheKey: string;
  edges: ImportEdge[];
}

interface StoredWorkspace {
  files: Record<string, StoredFile>;
}

interface StoreShape {
  version: 1;
  workspaces: Record<string, StoredWorkspace>;
}

const STORE_VERSION = 1;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 5;

const EXTENSIONS: Record<string, ImportKind> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
  ".c": "cpp",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
};

const SCRIPT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

interface RawMatch {
  specifier: string;
  index: number;
}

function commentedAt(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const prefix = text.slice(lineStart, index);
  return prefix.includes("//");
}

function collect(text: string, pattern: RegExp, target: RawMatch[]): void {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || !match[1]) continue;
    if (commentedAt(text, match.index)) continue;
    target.push({ specifier: match[1].trim(), index: match.index });
  }
}

function scriptSpecifiers(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  collect(text, /^\s*import\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']/gm, matches);
  collect(
    text,
    /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/gm,
    matches,
  );
  collect(text, /\brequire\(\s*["']([^"']+)["']\s*\)/g, matches);
  collect(text, /\bimport\(\s*["']([^"']+)["']\s*\)/g, matches);
  return matches;
}

function pythonSpecifiers(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  collect(text, /^\s*from\s+([.\w]+)\s+import\b/gm, matches);
  for (const line of text.matchAll(/^\s*import\s+([^#\n]+)/gm)) {
    if (line.index === undefined) continue;
    for (const part of line[1].split(",")) {
      const name = part.split(/\s+as\s+/)[0]?.trim();
      if (name) {
        matches.push({ specifier: name, index: line.index });
      }
    }
  }
  return matches;
}

function goSpecifiers(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  collect(text, /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm, matches);
  for (const block of text.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) {
    if (block.index === undefined) continue;
    const innerStart = block.index + block[0].indexOf(block[1]);
    const inner: RawMatch[] = [];
    collect(block[1], /^\s*(?:[._\w]+\s+)?"([^"]+)"/gm, inner);
    for (const match of inner) {
      matches.push({
        specifier: match.specifier,
        index: innerStart + match.index,
      });
    }
  }
  return matches;
}

function simpleSpecifiers(
  text: string,
  pattern: RegExp,
  transform?: (value: string) => string,
): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || !match[1]) continue;
    const value = transform ? transform(match[1]) : match[1];
    if (value) matches.push({ specifier: value, index: match.index });
  }
  return matches;
}

/** The module specifiers a source file names, in the order they appear. */
export function extractSpecifiers(
  text: string,
  kind: ImportKind,
): Array<{ specifier: string; kind: ImportKind }> {
  const matches =
    kind === "python"
      ? pythonSpecifiers(text)
      : kind === "go"
        ? goSpecifiers(text)
        : kind === "java"
          ? simpleSpecifiers(text, /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm)
          : kind === "rust"
            ? simpleSpecifiers(text, /^\s*use\s+([\w:]+)/gm, (value) =>
                value.replace(/:+$/, ""),
              )
            : kind === "cpp"
              ? simpleSpecifiers(text, /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)
              : scriptSpecifiers(text);

  const seen = new Set<string>();
  return matches
    .sort((a, b) => a.index - b.index)
    .filter((match) => {
      const key = `${kind}:${match.specifier}`;
      if (!match.specifier || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((match) => ({ specifier: match.specifier, kind }));
}

const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

function fileCandidates(base: string): string[] {
  const mapped: string[] = [];
  for (const [jsExtension, tsExtensions] of Object.entries(JS_TO_TS)) {
    if (!base.endsWith(jsExtension)) continue;
    const stem = base.slice(0, -jsExtension.length);
    for (const extension of tsExtensions) {
      mapped.push(`${stem}${extension}`);
    }
  }
  return [
    base,
    ...mapped,
    ...SCRIPT_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SCRIPT_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
}

function resolveScript(base: string, exists: (rel: string) => boolean) {
  return fileCandidates(base).find(exists) ?? null;
}

function resolvePython(
  source: string,
  specifier: string,
  exists: (rel: string) => boolean,
): string | null {
  const relative = /^(\.+)(.*)$/.exec(specifier);
  if (relative) {
    const up = Math.max(0, relative[1].length - 1);
    const parts = relative[2].split(".").filter(Boolean);
    const dir = path.posix.dirname(source);
    const base = path.posix.normalize(
      path.posix.join(dir, ...Array(up).fill(".."), ...parts),
    );
    return [`${base}.py`, `${base}/__init__.py`].find(exists) ?? null;
  }
  const base = specifier.split(".").join("/");
  return [`${base}.py`, `${base}/__init__.py`].find(exists) ?? null;
}

/** Resolve a specifier against the workspace; null means external or unknown. */
export function resolveImportTarget(
  source: string,
  specifier: string,
  kind: ImportKind,
  exists: (relative: string) => boolean,
): string | null {
  if (kind === "python") {
    return resolvePython(source, specifier, exists);
  }
  if (kind === "cpp") {
    if (specifier.startsWith("<")) return null;
    const local = path.posix.normalize(
      path.posix.join(path.posix.dirname(source), specifier),
    );
    return exists(local) ? local : exists(specifier) ? specifier : null;
  }
  if (kind !== "typescript" || !specifier.startsWith(".")) {
    return null;
  }
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(source), specifier),
  );
  return resolveScript(base, exists);
}

function defaultStorePath(): string {
  return path.join(path.dirname(getIndexSqlitePath()), "import-graph.json");
}

function emptyStore(): StoreShape {
  return { version: STORE_VERSION, workspaces: {} };
}

function supportedKind(filePath: string): ImportKind | undefined {
  return EXTENSIONS[path.extname(filePath).toLowerCase()];
}

/**
 * A persisted, file-level import graph.
 *
 * Imports are line-anchored declarations, so the extractor reads them without
 * a full parse; edges are stored by content hash and only changed files are
 * re-read. It answers dependencies and dependents, not symbol resolution -
 * that is what the language-server tools are for.
 */
export class ImportGraphService {
  private readonly root: string;
  private readonly storePath: string;

  constructor(
    workspaceDir: string = process.cwd(),
    storePath: string = defaultStorePath(),
  ) {
    this.root = path.resolve(workspaceDir);
    this.storePath = storePath;
  }

  private load(): StoreShape {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf-8"));
      if (parsed?.version === STORE_VERSION && parsed.workspaces) {
        return parsed as StoreShape;
      }
    } catch {
      // A missing or unreadable store is an empty graph, not a failure.
    }
    return emptyStore();
  }

  private save(store: StoreShape): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const temporary = `${this.storePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(store));
    fs.renameSync(temporary, this.storePath);
  }

  private async files(): Promise<string[]> {
    const uri = localPathToUri(this.root);
    const ide = new FileSystemIde(uri, "cli");
    const found = await walkDir(uri, ide, { include: "files" });
    return (
      found
        // `relativeToRoot`, not a bare `path.relative`: these strings are the keys
        // of the persisted graph, and a query arrives in `/` form on every
        // platform, so a Windows-shaped key would never be found again.
        .map((entry) => this.relativeToRoot(fileURLToPath(entry)))
        .filter((relative) => !relative.startsWith(".."))
        .filter((relative) => supportedKind(relative) !== undefined)
    );
  }

  private edgeFor(
    relative: string,
    raw: {
      specifier: string;
      kind: ImportKind;
    },
  ): ImportEdge {
    return {
      specifier: raw.specifier,
      kind: raw.kind,
      target: resolveImportTarget(relative, raw.specifier, raw.kind, (rel) =>
        fs.existsSync(path.join(this.root, rel)),
      ),
    };
  }

  /** Walk the workspace, re-read changed files, and persist the result. */
  async refresh(): Promise<{ files: number; parsed: number }> {
    const store = this.load();
    const workspace = (store.workspaces[this.root] ??= { files: {} });
    const found = await this.files();
    const seen = new Set(found);
    let parsed = 0;

    for (const relative of found) {
      const absolute = path.join(this.root, relative);
      let text: string;
      try {
        if (fs.statSync(absolute).size > MAX_SOURCE_BYTES) continue;
        text = fs.readFileSync(absolute, "utf-8");
      } catch {
        continue;
      }
      const cacheKey = createHash("sha1").update(text).digest("hex");
      if (workspace.files[relative]?.cacheKey === cacheKey) {
        continue;
      }
      const kind = supportedKind(relative);
      if (!kind) continue;
      workspace.files[relative] = {
        cacheKey,
        edges: extractSpecifiers(text, kind).map((raw) =>
          this.edgeFor(relative, raw),
        ),
      };
      parsed += 1;
    }

    for (const relative of Object.keys(workspace.files)) {
      if (!seen.has(relative)) {
        delete workspace.files[relative];
      }
    }

    // A target that was deleted, or created after the source was parsed,
    // changes the answer without changing the source. Re-resolve every edge
    // against the files that exist now.
    for (const [relative, stored] of Object.entries(workspace.files)) {
      stored.edges = stored.edges.map((edge) => ({
        ...edge,
        target: resolveImportTarget(
          relative,
          edge.specifier,
          edge.kind,
          (rel) => fs.existsSync(path.join(this.root, rel)),
        ),
      }));
    }

    store.workspaces[this.root] = workspace;
    this.save(store);
    return { files: found.length, parsed };
  }

  private relativeToRoot(file: string): string {
    const absolute = path.resolve(this.root, file);
    return path.relative(this.root, absolute).split(path.sep).join("/");
  }

  private workspace(): StoredWorkspace {
    return this.load().workspaces[this.root] ?? { files: {} };
  }

  /** What the file imports, following resolved edges to the requested depth. */
  async dependencies(file: string, depth = 1): Promise<ImportHit[]> {
    const workspace = this.workspace();
    const start = this.relativeToRoot(file);
    const limit = Math.max(1, Math.min(MAX_DEPTH, depth));
    const hits: ImportHit[] = [];
    const seen = new Set([start]);
    let frontier = [start];
    for (let level = 1; level <= limit && frontier.length > 0; level++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const edge of workspace.files[current]?.edges ?? []) {
          if (!edge.target || seen.has(edge.target)) continue;
          seen.add(edge.target);
          hits.push({ path: edge.target, depth: level, via: edge.specifier });
          next.push(edge.target);
        }
      }
      frontier = next;
    }
    return hits;
  }

  /** Who imports the file, following reverse edges to the requested depth. */
  async dependents(file: string, depth = 1): Promise<ImportHit[]> {
    const workspace = this.workspace();
    const start = this.relativeToRoot(file);
    const reverse = new Map<
      string,
      Array<{ source: string; specifier: string }>
    >();
    for (const [source, stored] of Object.entries(workspace.files)) {
      for (const edge of stored.edges) {
        if (!edge.target) continue;
        const list = reverse.get(edge.target) ?? [];
        list.push({ source, specifier: edge.specifier });
        reverse.set(edge.target, list);
      }
    }

    const limit = Math.max(1, Math.min(MAX_DEPTH, depth));
    const hits: ImportHit[] = [];
    const seen = new Set([start]);
    let frontier = [start];
    for (let level = 1; level <= limit && frontier.length > 0; level++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const edge of reverse.get(current) ?? []) {
          if (seen.has(edge.source)) continue;
          seen.add(edge.source);
          hits.push({
            path: edge.source,
            depth: level,
            via: edge.specifier,
          });
          next.push(edge.source);
        }
      }
      frontier = next;
    }
    return hits;
  }

  /** Names the file imports that do not resolve inside the workspace. */
  async unresolved(file: string): Promise<string[]> {
    const workspace = this.workspace();
    const start = this.relativeToRoot(file);
    return (workspace.files[start]?.edges ?? [])
      .filter((edge) => !edge.target)
      .map((edge) => edge.specifier);
  }
}

let instance: ImportGraphService | undefined;
let instanceRoot: string | undefined;

export function getImportGraphService(
  workspaceDir: string = process.cwd(),
): ImportGraphService {
  const root = path.resolve(workspaceDir);
  if (!instance || instanceRoot !== root) {
    instance = new ImportGraphService(root);
    instanceRoot = root;
  }
  return instance;
}
