import * as fs from "fs";
import * as path from "path";

import { loadInstructionFile } from "./instructionIncludes.js";

/**
 * Project instruction files are discovered the way Codex discovers them: walk
 * from the project root down to the working directory, taking one file per
 * directory, and keep the order stable. The root is the first directory at or
 * above the working directory that carries a `.git` marker; a file above that
 * marker belongs to another project and is not this session's rule.
 */
export const PROJECT_DOC_SEPARATOR = "--- project-doc ---";

/**
 * The whole set rides in the cached prefix, so it is bounded. When the budget
 * runs out the text says where it stopped rather than silently dropping rules.
 */
export const PROJECT_DOCS_MAX_CHARS = 32 * 1024;

/**
 * Per directory, in preference order: the override first, then `AGENTS.md`, then
 * the names TNT already read. A directory contributes one file, so a
 * `.tnt/AGENTS.md` is the local project instruction only where no
 * `AGENTS.md` claims the directory.
 */
const AGENT_FILE_NAMES = [
  "AGENTS.override.md",
  "AGENTS.md",
  ".tnt/AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "CODEX.md",
] as const;

export interface ProjectDoc {
  /** The file's path relative to the project root, with forward slashes. */
  readonly label: string;
  /** The labelled body, including the separator when it is not the first doc. */
  readonly text: string;
}

/**
 * The project root, found by marker and never above it. Without a `.git`
 * marker anywhere on the way up, the working directory is the whole project
 * and the search stops there rather than adopting a parent project.
 */
export function projectRoot(start: string = process.cwd()): string {
  const resolved = path.resolve(start);
  let cursor = resolved;
  for (;;) {
    if (fs.existsSync(path.join(cursor, ".git"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return resolved;
    cursor = parent;
  }
}

function directoriesRootToCwd(root: string, cwd: string): string[] {
  const relative = path.relative(root, cwd);
  if (relative === "") return [root];
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [cwd];

  const directories = [root];
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    directories.push(cursor);
  }
  return directories;
}

/**
 * The instruction files this project contributes, root first and working
 * directory last. A directory contributes at most one file: the override when
 * it exists, otherwise the first name in the table.
 */
export function projectDocFiles(cwd: string = process.cwd()): {
  root: string;
  files: string[];
} {
  const root = projectRoot(cwd);
  const files: string[] = [];

  for (const directory of directoriesRootToCwd(root, path.resolve(cwd))) {
    for (const name of AGENT_FILE_NAMES) {
      const file = path.join(directory, name);
      try {
        if (fs.statSync(file).isFile()) {
          files.push(file);
          break;
        }
      } catch {
        // Not here; the next name, then the next directory.
      }
    }
  }

  return { root, files };
}

function labelFor(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function truncatedNote(label: string, budget: number): string {
  return `\n\n[Truncated: project instructions stop at ${budget.toLocaleString()} characters; ${label} was cut here and any later file is not shown.]`;
}

/**
 * Read the discovered files in order, expanding their `@includes`, and bound
 * the result. The budget counts the labels and separators too, because those
 * are billed bytes as well.
 */
export function loadProjectDocs(
  cwd: string = process.cwd(),
  maxChars: number = PROJECT_DOCS_MAX_CHARS,
): ProjectDoc[] {
  const { root, files } = projectDocFiles(cwd);
  const docs: ProjectDoc[] = [];
  let used = 0;

  for (const file of files) {
    const label = labelFor(root, file);
    const header = `Rules from ${label}:\n`;
    const separator = docs.length === 0 ? "" : `${PROJECT_DOC_SEPARATOR}\n\n`;
    const body = loadInstructionFile(file);
    const entry = `${separator}${header}${body}`;

    if (used + entry.length <= maxChars) {
      docs.push({ label, text: entry });
      used += entry.length;
      continue;
    }

    const room = maxChars - used - separator.length - header.length;
    const kept = room > 0 ? body.slice(0, room) : "";
    docs.push({
      label,
      text: `${separator}${header}${kept}${truncatedNote(label, maxChars)}`,
    });
    break;
  }

  return docs;
}
