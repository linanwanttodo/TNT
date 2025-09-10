import * as fs from "fs";
import * as path from "path";

// An instruction file is copied into the request prefix every round, so it is
// bounded the way the reference bounds its own: a size limit, a depth limit for
// @includes, and a note in the text whenever either one cut something.
export const MAX_INSTRUCTION_CHARS = 40000;
export const MAX_INCLUDE_DEPTH = 5;
const MAX_READ_BYTES = 1024 * 1024;

const NON_TEXT_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".avif",
  ".mp3",
  ".mp4",
  ".mov",
  ".wav",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".jar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

// A token is an include when it names a path: a slash, an instruction file
// ending, or a dotted name that is actually on disk. That leaves "@author",
// "@v2.1" and an address in prose alone, and still refuses "@flow.pdf".
const INCLUDED_SUFFIXES = [".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc"];
const INCLUDE = /(^|[\s,([{])@((?:[~/][\w.~/-]*)|[\w.~-][\w.~/-]*)/g;

function isIncludeIntent(target: string, resolved: string): boolean {
  return (
    target.includes("/") ||
    INCLUDED_SUFFIXES.some((suffix) => target.endsWith(suffix)) ||
    fs.existsSync(resolved)
  );
}

function labelFor(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return !relative || relative.startsWith("..") ? filePath : relative;
}

function looksBinary(content: string): boolean {
  return content.slice(0, 8192).includes("\0");
}

function resolveInclude(target: string, fromFile: string): string {
  if (target.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", target.slice(2));
  }
  if (path.isAbsolute(target)) return target;
  return path.resolve(path.dirname(fromFile), target);
}

function expand(
  filePath: string,
  depth: number,
  stack: Set<string>,
  notes: string[],
): string {
  const label = labelFor(filePath);

  if (stack.has(filePath)) {
    notes.push(`@${label} is circular, so it was followed only once`);
    return "";
  }
  if (depth > MAX_INCLUDE_DEPTH) {
    notes.push(
      `@${label} was not followed: includes stop at ${MAX_INCLUDE_DEPTH} levels`,
    );
    return "";
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    notes.push(`${label} could not be read`);
    return "";
  }
  if (!stat.isFile()) {
    notes.push(`${label} is not a file`);
    return "";
  }
  if (NON_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    notes.push(`${label} is not a text file, so it was not included`);
    return "";
  }
  if (stat.size > MAX_READ_BYTES) {
    notes.push(
      `${label} is ${stat.size.toLocaleString()} bytes, over the ${MAX_READ_BYTES.toLocaleString()} byte limit, so it was not read`,
    );
    return "";
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    notes.push(`${label} could not be read (${String(error)})`);
    return "";
  }
  if (looksBinary(content)) {
    notes.push(`${label} is not a text file, so it was not included`);
    return "";
  }

  stack.add(filePath);
  let out = "";
  let fenced = false;

  for (const rawLine of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      fenced = !fenced;
      out += `${rawLine}\n`;
      continue;
    }
    let line = rawLine;
    if (!fenced) {
      line = rawLine.replace(
        INCLUDE,
        (match, before: string, target: string) => {
          const resolved = resolveInclude(target, filePath);
          if (!isIncludeIntent(target, resolved)) return match;
          if (!fs.existsSync(resolved)) {
            notes.push(`@${target} in ${label} does not exist`);
            return match;
          }
          const included = expand(resolved, depth + 1, stack, notes);
          return `${before}${included.trimEnd()}`;
        },
      );
    }
    out += `${line}\n`;
  }

  stack.delete(filePath);
  return out.replace(/\n+$/, "");
}

/**
 * Read an instruction file with its @includes expanded, saying in the returned
 * text whatever had to be skipped, stopped or cut.
 */
export function loadInstructionFile(filePath: string): string {
  const notes: string[] = [];
  const text = expand(path.resolve(filePath), 1, new Set<string>(), notes);
  let result = text;

  if (result.length > MAX_INSTRUCTION_CHARS) {
    // Cut before a split surrogate pair, so the note cannot end on half a glyph
    const head = result.slice(0, MAX_INSTRUCTION_CHARS);
    const dropped = result.length - head.length;
    result = `${/[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head}

[Truncated: ${dropped.toLocaleString()} more characters of this file are not shown. The limit is ${MAX_INSTRUCTION_CHARS.toLocaleString()} characters.]`;
  }

  if (notes.length > 0) {
    result = `${result}\n\n[Includes: ${[...new Set(notes)].join("; ")}]`;
  }

  return result;
}
