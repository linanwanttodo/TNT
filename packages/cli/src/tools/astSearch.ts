import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import util from "util";

import type {
  CompiledStructuralPattern,
  StructuralMatch,
} from "core/util/structuralSearch.js";

import { policySearchIgnorePatterns } from "../permissions/searchIgnore.js";
import { isWithinWorkspace } from "../permissions/workspacePath.js";
import { parseEnvNumber } from "../utils/truncateOutput.js";

import { checkIfRipgrepIsInstalled } from "./searchCode.js";
import { Tool, ToolRunContext } from "./types.js";

const execFilePromise = util.promisify(execFile);

/**
 * Structural search: the workspace's answer to ast-grep, on the tree-sitter
 * grammars the CLI already ships. A pattern is source code with metavariables,
 * so a shape matches every formatting of that shape; `Search` stays the tool
 * for regexes and plain text. Everything runs locally - the grammars are
 * vendored wasm files, and no request leaves the machine.
 */

const DEFAULT_HEAD_LIMIT = 40;
const MAX_HEAD_LIMIT = 200;
const DEFAULT_MAX_FILES = 4000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_CHARS = 20_000;
const MIN_TOTAL_CHARS = 2000;
const MAX_SNIPPET_LINES = 3;
const MAX_SNIPPET_LINE_CHARS = 200;
const MAX_CAPTURE_CHARS = 60;
const MAX_SUBJECT_CHARS = 80;

const SEARCH_LANGUAGE_NAMES = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "c_sharp",
  "ruby",
  "php",
  "bash",
  "lua",
  "elixir",
] as const;

const SEARCH_LANGUAGES = new Set<string>(SEARCH_LANGUAGE_NAMES);

interface AstSearchArgs {
  pattern?: string;
  kind?: string;
  path?: string;
  file_pattern?: string;
  head_limit?: number;
}

interface MatchLine {
  file: string;
  match: StructuralMatch;
}

interface ScanRequest {
  root: string;
  displayRoot: string;
  rootIsFile: boolean;
  patternMode: boolean;
  pattern: string;
  kinds: string[];
  maxMatches: number;
  filePattern: string | undefined;
}

interface ScanStats {
  matches: MatchLine[];
  reachedLimit: boolean;
  stopped: boolean;
  oversized: number;
  unreadable: number;
  languageProblems: Map<string, string>;
}

interface ScanEngines {
  supportedLanguages: Record<string, string>;
  compileStructuralPattern: (typeof import("core/util/structuralSearch.js"))["compileStructuralPattern"];
  findNodesOfKinds: (typeof import("core/util/structuralSearch.js"))["findNodesOfKinds"];
  findStructuralMatches: (typeof import("core/util/structuralSearch.js"))["findStructuralMatches"];
}

function maxFiles(): number {
  return parseEnvNumber(
    process.env.TNT_AST_SEARCH_MAX_FILES,
    DEFAULT_MAX_FILES,
  );
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** A minimal glob: `**` crosses directories, `*` and `?` stay inside one. */
function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("**")
    .map((segment) =>
      segment
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]"),
    )
    .join(".*");
  return new RegExp(`^${body}$`);
}

function matchesFilePattern(pattern: string, relativePath: string): boolean {
  const regex = globToRegExp(pattern);
  if (pattern.includes("/")) return regex.test(relativePath);
  const base = relativePath.split("/").pop() ?? relativePath;
  return regex.test(base) || regex.test(relativePath);
}

/**
 * The permission policies' path refusals join the listing: a rule that denies
 * reading a file must not let a search print that file's contents.
 * Service-less processes (bare unit tests) get no rules.
 */
async function deniedGlobs(): Promise<string[]> {
  try {
    const { services } = await import("../services/index.js");
    return policySearchIgnorePatterns(
      services.toolPermissions.getState().permissions,
    );
  } catch {
    return [];
  }
}

async function listCandidateFiles(
  root: string,
  globs: string[],
  filePattern: string | undefined,
  limit: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const patterns = await deniedGlobs();
  let listed: string;
  try {
    const { stdout } = await execFilePromise(
      "rg",
      [
        "--files",
        ...globs.flatMap((glob) => ["--glob", glob]),
        ...patterns.flatMap((denied) => ["--glob", `!${denied}`]),
        ".",
      ],
      { maxBuffer: 10 * 1024 * 1024, cwd: root },
    );
    listed = stdout;
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    if (failure.code !== 1 || (failure.stdout ?? "").trim()) {
      throw error;
    }
    listed = "";
  }

  let files = listed
    .split("\n")
    .map((file) => (file.startsWith("./") ? file.slice(2) : file))
    // Windows rg outputs backslash paths; the file_pattern glob uses `/`.
    .map((file) => file.replace(/\\/g, "/"))
    .filter(Boolean);
  if (filePattern) {
    files = files.filter((file) => matchesFilePattern(filePattern, file));
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const truncated = files.length > limit;
  return { files: files.slice(0, limit), truncated };
}

function fileExtension(file: string): string {
  const base = file.split("/").pop() ?? file;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function snippetOf(match: StructuralMatch): string[] {
  return match.text
    .split("\n")
    .slice(0, MAX_SNIPPET_LINES)
    .map((line) => truncate(line, MAX_SNIPPET_LINE_CHARS));
}

function capturesOf(match: StructuralMatch): string | undefined {
  const entries = Object.entries(match.captures);
  if (entries.length === 0) return undefined;
  return entries
    .map(
      ([name, text]) =>
        `${name}=${truncate(text.replace(/\s+/g, " ").trim(), MAX_CAPTURE_CHARS)}`,
    )
    .join(", ");
}

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Validates the call into a scan request, or names what the model should fix
 * instead of an argument error it would have to guess around.
 */
function parseScanRequest(args: AstSearchArgs): ScanRequest | string {
  const pattern = typeof args?.pattern === "string" ? args.pattern : "";
  const kind = typeof args?.kind === "string" ? args.kind.trim() : "";
  if (!pattern.trim() && !kind) {
    return "AstSearch needs a pattern (code with $NAME metavariables) or a kind (comma-separated node kinds).";
  }
  if (pattern.trim() && kind) {
    return "AstSearch takes pattern or kind, not both.";
  }

  const rootArg = args?.path?.trim() ? args.path.trim() : process.cwd();
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root)) {
    return `Path does not exist: ${rootArg}`;
  }
  const rootStat = fs.statSync(root);

  const requested = Number(args?.head_limit);
  const maxMatches =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_HEAD_LIMIT)
      : DEFAULT_HEAD_LIMIT;

  return {
    root,
    displayRoot: rootStat.isFile() ? path.dirname(root) : root,
    rootIsFile: rootStat.isFile(),
    patternMode: pattern.trim() !== "",
    pattern,
    kinds: kind
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    maxMatches,
    filePattern:
      typeof args?.file_pattern === "string" && args.file_pattern.trim()
        ? args.file_pattern.trim()
        : undefined,
  };
}

async function candidateFiles(
  request: ScanRequest,
  extensionGlobs: string[],
): Promise<{ files: string[]; listingTruncated: boolean; rgMissing: boolean }> {
  if (request.rootIsFile) {
    return { files: [request.root], listingTruncated: false, rgMissing: false };
  }
  if (!(await checkIfRipgrepIsInstalled())) {
    return { files: [], listingTruncated: false, rgMissing: true };
  }
  const listing = await listCandidateFiles(
    request.root,
    extensionGlobs,
    request.filePattern,
    maxFiles(),
  );
  return {
    files: listing.files.map((file) => path.resolve(request.root, file)),
    listingTruncated: listing.truncated,
    rgMissing: false,
  };
}

async function scanWorkspace(
  request: ScanRequest,
  engines: ScanEngines,
  candidates: readonly string[],
  context?: ToolRunContext,
): Promise<ScanStats> {
  const compiledByLanguage = new Map<string, CompiledStructuralPattern>();
  const failedLanguages = new Set<string>();
  const languageProblems = new Map<string, string>();
  const matches: MatchLine[] = [];
  const stats: ScanStats = {
    matches,
    reachedLimit: false,
    stopped: false,
    oversized: 0,
    unreadable: 0,
    languageProblems,
  };

  for (const file of candidates) {
    if (context?.signal?.aborted) {
      stats.stopped = true;
      break;
    }
    const languageId = engines.supportedLanguages[fileExtension(file)];
    if (!languageId || !SEARCH_LANGUAGES.has(languageId)) continue;

    let compiled = compiledByLanguage.get(languageId);
    if (
      request.patternMode &&
      compiled === undefined &&
      !failedLanguages.has(languageId)
    ) {
      const attempt = await engines.compileStructuralPattern(
        file,
        request.pattern,
      );
      if (attempt.ok) {
        compiledByLanguage.set(languageId, attempt.pattern);
        compiled = attempt.pattern;
      } else {
        failedLanguages.add(languageId);
        if (!languageProblems.has(languageId)) {
          languageProblems.set(
            languageId,
            attempt.detail
              ? `${attempt.reason} (${attempt.detail})`
              : attempt.reason,
          );
        }
      }
    }
    if (request.patternMode && !compiled) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      stats.unreadable += 1;
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      stats.oversized += 1;
      continue;
    }
    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf-8");
    } catch {
      stats.unreadable += 1;
      continue;
    }

    const remaining = request.maxMatches - matches.length;
    const outcome = request.patternMode
      ? await engines.findStructuralMatches(
          file,
          contents,
          compiled!,
          remaining,
        )
      : await engines.findNodesOfKinds(
          file,
          contents,
          request.kinds,
          remaining,
        );
    if (!outcome) continue;
    for (const match of outcome.matches) {
      matches.push({ file, match });
    }
    if (outcome.reachedLimit) {
      stats.reachedLimit = true;
      break;
    }
  }
  return stats;
}

function renderScan(
  request: ScanRequest,
  stats: ScanStats,
  listingTruncated: boolean,
): string {
  const lines: string[] = [];
  const subject = request.patternMode
    ? `\`${truncate(flatten(request.pattern), MAX_SUBJECT_CHARS)}\``
    : `kinds ${request.kinds.join(", ")}`;
  lines.push(
    `${stats.matches.length} match${stats.matches.length === 1 ? "" : "es"} for ${subject}`,
  );

  let budget = Math.max(MIN_TOTAL_CHARS, Math.floor(MAX_TOTAL_CHARS / 1));
  let budgetCapped = false;
  for (const { file, match } of stats.matches) {
    const relative = path
      .relative(request.displayRoot, file)
      .split(path.sep)
      .join("/");
    const where = `${relative}:${match.startLine}:${match.startColumn}`;
    const snippet = snippetOf(match).map((line) => `  ${line}`);
    const captures = capturesOf(match);
    const block = [
      where,
      ...snippet,
      ...(captures ? [`  ${captures}`] : []),
    ].join("\n");
    if (block.length > budget) {
      budgetCapped = true;
      break;
    }
    budget -= block.length;
    lines.push(block);
  }

  if (stats.reachedLimit) {
    lines.push(
      `[stopped at the ${request.maxMatches}-match limit; raise head_limit or narrow the pattern]`,
    );
  }
  if (budgetCapped && !stats.reachedLimit) {
    lines.push("[stopped early: the answer budget ran out]");
  }
  if (stats.stopped) {
    lines.push("[stopped early: the run was cancelled]");
  }
  for (const [languageId, problem] of stats.languageProblems) {
    lines.push(`[pattern not usable for ${languageId}: ${problem}]`);
  }
  if (stats.oversized > 0) {
    lines.push(
      `[${stats.oversized} file(s) over ${MAX_FILE_BYTES} bytes were not parsed]`,
    );
  }
  if (stats.unreadable > 0) {
    lines.push(`[${stats.unreadable} file(s) could not be read]`);
  }
  if (listingTruncated) {
    lines.push(
      `[file listing stopped at ${maxFiles()} files; narrow path or file_pattern]`,
    );
  }
  return lines.join("\n");
}

/**
 * Lists files whose extension one of the curated grammars covers, and
 * compiles the pattern once per language on the first file that needs it.
 */
export const astSearchTool: Tool = {
  name: "AstSearch",
  displayName: "AST Search",
  description: `Search code by syntax-tree shape instead of text: parses files with the workspace's local tree-sitter grammars and reports every node that matches a structural pattern. Metavariables make the pattern general - $NAME matches one node (repeated names must match equal text), $$$NAME matches any run of nodes, $_ and $$$ are anonymous wildcards - so 'console.log($A)' finds every call regardless of its argument, and formatting or comments never break a match. kind lists every node of the named grammar kinds instead (e.g. 'call_expression'). Give either pattern or kind, not both. Languages: ${SEARCH_LANGUAGE_NAMES.join(", ")}. Searches only files ripgrep lists (gitignore honoured), at most ${DEFAULT_MAX_FILES} of them and ${MAX_FILE_BYTES / 1000000}MB each, and says when it stopped early. Use Search for regexes and text, FindSymbol for declarations the language server knows; edits go through Edit or ApplyPatch, never here.`,
  parameters: {
    type: "object",
    required: [],
    properties: {
      pattern: {
        type: "string",
        description:
          "Code pattern in the target language, with $NAME / $$$NAME metavariables (e.g. 'console.log($A)' or 'function $F($$$ARGS) { $$$BODY }')",
      },
      kind: {
        type: "string",
        description:
          "Comma-separated tree-sitter node kinds to list instead of a pattern (e.g. 'call_expression')",
      },
      path: {
        type: "string",
        description:
          "Directory or file to search (defaults to the current working directory)",
      },
      file_pattern: {
        type: "string",
        description: "Restrict to files matching this glob, e.g. 'src/**/*.ts'",
      },
      head_limit: {
        type: "number",
        description: `Maximum matches to return (default ${DEFAULT_HEAD_LIMIT}, ceiling ${MAX_HEAD_LIMIT})`,
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  /**
   * A search reads whatever the pattern matches, including files outside the
   * project when the caller names a target there. The rule that allows Search
   * speaks for the workspace, so a call that leaves it still needs the human.
   */
  evaluateToolCallPolicy: (basePolicy, parsedArgs: Record<string, unknown>) => {
    if (basePolicy === "disabled") {
      return basePolicy;
    }
    const named = parsedArgs.path;
    const target =
      typeof named === "string" && named.trim() !== "" ? named : process.cwd();
    return isWithinWorkspace(target) ? basePolicy : "allowedWithPermission";
  },
  preprocess: async (args) => {
    const pattern = typeof args?.pattern === "string" ? args.pattern : "";
    const kind = typeof args?.kind === "string" ? args.kind : "";
    const shown = truncate(flatten(pattern || kind), MAX_SUBJECT_CHARS);
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will structurally search for: "${shown}"`,
        },
      ],
    };
  },
  run: async (
    args: AstSearchArgs,
    context?: ToolRunContext,
  ): Promise<string> => {
    const request = parseScanRequest(args);
    if (typeof request === "string") return request;

    const engines = {
      supportedLanguages: (await import("core/util/treeSitter.js"))
        .supportedLanguages,
      ...(await import("core/util/structuralSearch.js")),
    } as ScanEngines;

    const extensionGlobs = Object.entries(engines.supportedLanguages)
      .filter(([, language]) => SEARCH_LANGUAGES.has(language))
      .map(([extension]) => `*.${extension}`);

    const { files, listingTruncated, rgMissing } = await candidateFiles(
      request,
      extensionGlobs,
    );
    if (rgMissing) {
      return "AstSearch needs ripgrep (rg) to list files; Search and Glob need it too. Install ripgrep and retry.";
    }

    const stats = await scanWorkspace(request, engines, files, context);
    return renderScan(request, stats, listingTruncated);
  },
};
