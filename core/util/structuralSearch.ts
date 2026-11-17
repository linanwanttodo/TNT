import Parser, { SyntaxNode } from "web-tree-sitter";

import { supportedLanguages } from "./treeSitter.js";
import { getUriFileExtension } from "./uri.js";

/**
 * A structural (shape-based) code search over the vendored tree-sitter
 * grammars - the local stand-in for an ast-grep dependency.
 *
 * A pattern is source code in the target language with two metavariable
 * forms: `$NAME` binds to exactly one node, and `$$$NAME` binds to any run
 * of sibling nodes. The pattern is parsed with the same grammar as the
 * searched files, so matching compares grammar node types rather than text,
 * which is what makes it insensitive to formatting while still strict about
 * operators and keywords (those are children too, and they are compared).
 *
 * Everything here is local: a pattern compiles against a grammar file from
 * `tree-sitter-wasms`, and the search walks an in-memory tree. No network,
 * no external process.
 */

const SINGLE_PREFIX = "__TNT_META_1_";
const SPLAT_PREFIX = "__TNT_META_2_";
const PLACEHOLDER_SUFFIX = "__";
const ANONYMOUS_NAME = "_";

/** Statement/program wrappers a one-child pattern descends through. */
const WRAPPER_TYPES = new Set([
  "program",
  "module",
  "source_file",
  "translation_unit",
  "document",
  "expression_statement",
]);

/** Node types that carry no structural meaning for matching. */
const TRIVIA_PATTERN = /comment|hash_bang|shebang/;

export interface StructuralMatch {
  /** 1-based, as an editor shows them. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
  /** Metavariable name -> the text it matched. `$_` and `$$$` stay out. */
  captures: Record<string, string>;
}

export interface StructuralSearchOutcome {
  matches: StructuralMatch[];
  /** True when the caller's limit stopped the walk, not the tree. */
  reachedLimit: boolean;
}

/** The compiled pattern, as plain data so callers never touch wasm types. */
export interface CompiledStructuralPattern {
  /** The grammar the pattern was compiled against, e.g. "typescript". */
  languageId: string;
  /** The pattern exactly as the caller wrote it, for display. */
  source: string;
  root: PatternNode;
}

export interface PatternNode {
  type: string;
  text: string;
  isMeta: boolean;
  isSplat: boolean;
  /** Set for a single-node metavariable (`$NAME`). */
  metaName?: string;
  /** Set for a sequence metavariable (`$$$NAME`). */
  splatName?: string;
  children: PatternNode[];
}

export type StructuralPatternCompile =
  | { ok: true; pattern: CompiledStructuralPattern }
  | {
      ok: false;
      reason:
        | "unsupported-language"
        | "empty-pattern"
        | "parse-error"
        | "bare-metavariable";
      detail?: string;
    };

interface PlaceholderTable {
  text: string;
  singleByName: Map<string, string>;
  splatByName: Map<string, string>;
}

interface MetaRead {
  name: string;
  splat: boolean;
  end: number;
}

function readIdentifierAt(source: string, start: number): string | undefined {
  if (start >= source.length) return undefined;
  const first = source[start];
  if (!/[A-Za-z_]/.test(first)) return undefined;
  let end = start + 1;
  while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end += 1;
  return source.slice(start, end);
}

function readMetavariable(source: string, start: number): MetaRead | undefined {
  if (source.startsWith("$$$", start)) {
    const name = readIdentifierAt(source, start + 3);
    return name
      ? { name, splat: true, end: start + 3 + name.length }
      : undefined;
  }
  const name = readIdentifierAt(source, start + 1);
  return name
    ? { name, splat: false, end: start + 1 + name.length }
    : undefined;
}

/**
 * Rewrites `$NAME` / `$$$NAME` into placeholder identifiers the grammar can
 * parse. String literals are copied verbatim, so a `$` inside quotes stays a
 * literal dollar and does not become a wildcard.
 */
function preprocessMetavariables(source: string): PlaceholderTable {
  const singleByName = new Map<string, string>();
  const splatByName = new Map<string, string>();
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        const inner = source[index];
        out += inner;
        index += 1;
        if (inner === "\\") {
          out += source[index] ?? "";
          index += 1;
          continue;
        }
        if (inner === quote) break;
      }
      continue;
    }
    if (char === "$") {
      const meta = readMetavariable(source, index);
      if (meta) {
        const prefix = meta.splat ? SPLAT_PREFIX : SINGLE_PREFIX;
        const placeholder = `${prefix}${meta.name}${PLACEHOLDER_SUFFIX}`;
        if (meta.splat) {
          splatByName.set(placeholder, meta.name);
        } else {
          singleByName.set(placeholder, meta.name);
        }
        out += placeholder;
        index = meta.end;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return { text: out, singleByName, splatByName };
}

function placeholderName(
  text: string,
  prefix: string,
  names: Map<string, string>,
): string | undefined {
  if (!text.startsWith(prefix) || !text.endsWith(PLACEHOLDER_SUFFIX)) {
    return undefined;
  }
  const name = names.get(text);
  return name;
}

function isTrivia(node: SyntaxNode): boolean {
  return TRIVIA_PATTERN.test(node.type);
}

function compileNode(
  node: SyntaxNode,
  singleByName: Map<string, string>,
  splatByName: Map<string, string>,
): PatternNode {
  const text = node.text;
  const splatName = placeholderName(text, SPLAT_PREFIX, splatByName);
  if (splatName !== undefined) {
    return {
      type: node.type,
      text,
      isMeta: false,
      isSplat: true,
      splatName,
      children: [],
    };
  }
  const metaName = placeholderName(text, SINGLE_PREFIX, singleByName);
  if (metaName !== undefined) {
    return {
      type: node.type,
      text,
      isMeta: true,
      isSplat: false,
      metaName,
      children: [],
    };
  }
  const children: PatternNode[] = [];
  for (const child of node.children) {
    if (isTrivia(child)) continue;
    // `function $A() { $$$B }`: the splat lands inside an expression_statement
    // wrapper. Collapsing it is what lets a body splat stand for the whole
    // statement sequence, which is how ast-grep reads that shape too.
    if (
      child.type === "expression_statement" &&
      child.namedChildCount === 1 &&
      placeholderName(
        child.namedChild(0)?.text ?? "",
        SPLAT_PREFIX,
        splatByName,
      ) !== undefined
    ) {
      children.push(
        compileNode(child.namedChild(0)!, singleByName, splatByName),
      );
      continue;
    }
    children.push(compileNode(child, singleByName, splatByName));
  }
  return { type: node.type, text, isMeta: false, isSplat: false, children };
}

/** The grammars' parsers, one per language, reused across files. */
const parsersByLanguage = new Map<string, Parser>();

function languageIdFor(filepath: string): string | undefined {
  const extension = getUriFileExtension(filepath);
  if (!extension) return undefined;
  return supportedLanguages[extension];
}

async function parserForPath(filepath: string): Promise<Parser | undefined> {
  const languageId = languageIdFor(filepath);
  if (!languageId) return undefined;
  const cached = parsersByLanguage.get(languageId);
  if (cached) return cached;
  const { getLanguageForFile } = await import("./treeSitter.js");
  const language = await getLanguageForFile(filepath);
  if (!language) return undefined;
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(language);
  parsersByLanguage.set(languageId, parser);
  return parser;
}

function parserForLanguageId(languageId: string): Parser | undefined {
  return parsersByLanguage.get(languageId);
}

function firstErrorNode(node: SyntaxNode): SyntaxNode | undefined {
  if (node.isError() || node.isMissing()) return node;
  for (const child of node.children) {
    const found = firstErrorNode(child);
    if (found) return found;
  }
  return undefined;
}

function truncateDetail(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export async function compileStructuralPattern(
  samplePath: string,
  source: string,
): Promise<StructuralPatternCompile> {
  const parser = await parserForPath(samplePath);
  const languageId = languageIdFor(samplePath);
  if (!parser || !languageId) {
    return { ok: false, reason: "unsupported-language" };
  }
  const { text, singleByName, splatByName } = preprocessMetavariables(source);
  if (text.trim() === "") {
    return { ok: false, reason: "empty-pattern" };
  }
  const tree = parser.parse(text);
  try {
    if (tree.rootNode.hasError()) {
      const errorNode = firstErrorNode(tree.rootNode);
      return {
        ok: false,
        reason: "parse-error",
        detail: errorNode
          ? `near "${truncateDetail(errorNode.text)}"`
          : undefined,
      };
    }
    let node = tree.rootNode;
    while (WRAPPER_TYPES.has(node.type) && node.namedChildCount === 1) {
      node = node.namedChild(0)!;
    }
    if (node.childCount === 0) {
      return { ok: false, reason: "empty-pattern" };
    }
    const root = compileNode(node, singleByName, splatByName);
    if (root.isMeta || root.isSplat) {
      return { ok: false, reason: "bare-metavariable" };
    }
    return { ok: true, pattern: { languageId, source, root } };
  } finally {
    tree.delete();
  }
}

/** Bindings keyed by variable kind + name, so `$A` and `$$$A` stay apart. */
type Bindings = Map<string, string>;

function bindingKey(splat: boolean, name: string): string {
  return `${splat ? "s" : "v"}:${name}`;
}

function namedText(nodes: readonly SyntaxNode[]): string {
  return nodes
    .filter((node) => node.isNamed())
    .map((node) => node.text)
    .join("\n");
}

function matchPatternNode(
  pattern: PatternNode,
  node: SyntaxNode,
  bindings: Bindings,
): Bindings | undefined {
  if (pattern.isMeta) {
    const name = pattern.metaName!;
    if (!node.isNamed()) return undefined;
    const key = bindingKey(false, name);
    const bound = bindings.get(key);
    if (bound !== undefined) {
      return bound === node.text ? bindings : undefined;
    }
    const next = new Map(bindings);
    next.set(key, node.text);
    return next;
  }
  if (pattern.isSplat) {
    // A splat outside a sibling sequence matches any single node; the run
    // semantics only exist where the pattern's parent compares children.
    const name = pattern.splatName!;
    const key = bindingKey(true, name);
    const bound = bindings.get(key);
    if (bound !== undefined && bound !== node.text) return undefined;
    const next = new Map(bindings);
    next.set(key, node.text);
    return next;
  }
  if (pattern.type !== node.type) return undefined;
  if (pattern.children.length === 0) {
    if (node.childCount !== 0) return undefined;
    return pattern.text === node.text ? bindings : undefined;
  }
  return matchSequence(pattern.children, node.children, 0, 0, bindings);
}

function matchSequence(
  patterns: readonly PatternNode[],
  nodes: readonly SyntaxNode[],
  patternIndex: number,
  nodeIndex: number,
  bindings: Bindings,
): Bindings | undefined {
  if (patternIndex === patterns.length) {
    return nodeIndex === nodes.length ? bindings : undefined;
  }
  const item = patterns[patternIndex];
  if (item.isSplat) {
    const name = item.splatName!;
    const key = bindingKey(true, name);
    const bound = bindings.get(key);
    for (let end = nodeIndex; end <= nodes.length; end += 1) {
      const captured = namedText(nodes.slice(nodeIndex, end));
      if (bound !== undefined && bound !== captured) continue;
      const next = new Map(bindings);
      if (bound === undefined) next.set(key, captured);
      const result = matchSequence(
        patterns,
        nodes,
        patternIndex + 1,
        end,
        next,
      );
      if (result) return result;
    }
    return undefined;
  }
  if (nodeIndex >= nodes.length) return undefined;
  if (isTrivia(nodes[nodeIndex])) {
    // Trivia in the target cannot be matched by the pattern (it was stripped
    // there too), so skip it rather than fail the whole match.
    return matchSequence(
      patterns,
      nodes,
      patternIndex,
      nodeIndex + 1,
      bindings,
    );
  }
  const after = matchPatternNode(item, nodes[nodeIndex], bindings);
  if (!after) return undefined;
  return matchSequence(patterns, nodes, patternIndex + 1, nodeIndex + 1, after);
}

function toMatch(node: SyntaxNode, bindings: Bindings): StructuralMatch {
  const captures: Record<string, string> = {};
  for (const [key, text] of bindings) {
    const name = key.slice(2);
    if (name === ANONYMOUS_NAME) continue;
    captures[name] = text;
  }
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
    text: node.text,
    captures,
  };
}

function walkMatches(
  root: SyntaxNode,
  limit: number,
  matchesAt: (node: SyntaxNode) => Bindings | undefined,
): StructuralSearchOutcome {
  const matches: StructuralMatch[] = [];
  let reachedLimit = false;
  const visit = (node: SyntaxNode): void => {
    if (reachedLimit) return;
    const bindings = matchesAt(node);
    if (bindings) {
      matches.push(toMatch(node, bindings));
      if (matches.length >= limit) {
        reachedLimit = true;
        return;
      }
      // The outermost match is the report; walking into it would list the
      // same construct once per nesting level.
      return;
    }
    for (const child of node.namedChildren) {
      if (isTrivia(child)) continue;
      visit(child);
    }
  };
  visit(root);
  return { matches, reachedLimit };
}

export async function findStructuralMatches(
  filepath: string,
  contents: string,
  compiled: CompiledStructuralPattern,
  limit: number,
): Promise<StructuralSearchOutcome | undefined> {
  const parser = parserForLanguageId(compiled.languageId);
  if (!parser) return undefined;
  let tree: Parser.Tree;
  try {
    tree = parser.parse(contents);
  } catch {
    return undefined;
  }
  try {
    return walkMatches(tree.rootNode, limit, (node) =>
      matchPatternNode(compiled.root, node, new Map()),
    );
  } finally {
    tree.delete();
  }
}

export async function findNodesOfKinds(
  filepath: string,
  contents: string,
  kinds: readonly string[],
  limit: number,
): Promise<StructuralSearchOutcome | undefined> {
  const parser = await parserForPath(filepath);
  if (!parser) return undefined;
  const kindSet = new Set(kinds);
  let tree: Parser.Tree;
  try {
    tree = parser.parse(contents);
  } catch {
    return undefined;
  }
  try {
    return walkMatches(tree.rootNode, limit, (node) =>
      kindSet.has(node.type) ? new Map() : undefined,
    );
  } finally {
    tree.delete();
  }
}
