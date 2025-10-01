import fs from "fs";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { isWithinWorkspace } from "../permissions/workspacePath.js";
import { scheduleFileRefresh } from "../retrieval/writeRefresh.js";

import { changedSinceSeen, markFileAsSeen } from "./fileState.js";
import { Tool } from "./types.js";

/**
 * A patch that names several files at once.
 *
 * `Edit` and `MultiEdit` work on one file, so a change that crosses files costs
 * one call - and one approval - per file, and a half-applied set is left behind
 * when the third one fails. This grammar is the shape `git apply` reads, which
 * is what a model has already seen in its training: file by file, removed lines
 * and added lines, with `@@` naming the surrounding context.
 */
export interface PatchHunk {
  context?: string;
  remove: string[];
  add: string[];
}

export interface PatchedFile {
  kind: "add" | "update" | "delete";
  path: string;
  added?: string[];
  hunks?: PatchHunk[];
}

class PatchFormatError extends Error {}

function fail(message: string): never {
  throw new PatchFormatError(message);
}

/**
 * Read one file section of the patch: the lines that follow `*** Add File:` or
 * `*** Update File:` until the next section or the end marker.
 */
function readSection(
  lines: string[],
  start: number,
): { body: string[]; next: number } {
  const body: string[] = [];

  let index = start;
  while (
    index < lines.length &&
    !lines[index].startsWith("*** Update File:") &&
    !lines[index].startsWith("*** Add File:") &&
    !lines[index].startsWith("*** Delete File:") &&
    !lines[index].startsWith("*** End Patch")
  ) {
    body.push(lines[index]);
    index++;
  }

  return { body, next: index };
}

function parseUpdateBody(body: string[]): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: PatchHunk = { remove: [], add: [] };
  let opened = false;

  for (const line of body) {
    if (line.startsWith("@@")) {
      if (opened) {
        hunks.push(current);
      }
      current = { context: line.slice(2).trim(), remove: [], add: [] };
      opened = true;
      continue;
    }

    if (line.startsWith("-")) {
      opened = true;
      current.remove.push(line.slice(1));
      continue;
    }

    if (line.startsWith("+")) {
      opened = true;
      current.add.push(line.slice(1));
      continue;
    }

    // An unmarked line is context the patch quotes to locate the change. A
    // second one in the same hunk means the writer stopped matching the grammar,
    // so it is an error rather than a line to insert.
    if (line.trim() !== "") {
      if (current.context === undefined) {
        current.context = line;
      } else {
        fail(`unrecognized line in an Update File section: ${line}`);
      }
    }
  }

  if (opened) {
    hunks.push(current);
  }

  return hunks;
}

/** Turn the patch text into the files it names, or say what is malformed. */
export function parseApplyPatch(patch: string): PatchedFile[] {
  const lines = patch.split("\n");
  if (!lines.some((line) => line.trim() === "*** Begin Patch")) {
    fail("the patch does not start with '*** Begin Patch'");
  }

  const files: PatchedFile[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (
      line.startsWith("*** Update File:") ||
      line.startsWith("*** Add File:") ||
      line.startsWith("*** Delete File:")
    ) {
      const kind = line.startsWith("*** Add")
        ? "add"
        : line.startsWith("*** Delete")
          ? "delete"
          : "update";
      const target = line.slice(line.indexOf(":") + 1).trim();
      if (!target) {
        fail(`a ${kind} section names no file`);
      }

      const { body, next } = readSection(lines, index + 1);

      if (kind === "delete") {
        files.push({ kind, path: target });
      } else if (kind === "add") {
        files.push({
          kind,
          path: target,
          added: body.filter((entry) => entry.startsWith("+")),
        });
      } else {
        files.push({ kind, path: target, hunks: parseUpdateBody(body) });
      }

      index = next;
      continue;
    }

    index++;
  }

  if (files.length === 0) {
    fail("the patch names no files");
  }

  return files;
}

/** The lines a file should hold afterwards, or a named failure to locate one. */
export function applyHunks(
  filePath: string,
  original: string[],
  hunks: PatchHunk[],
): string[] {
  let result = [...original];

  for (const hunk of hunks) {
    if (hunk.remove.length === 0) {
      if (hunk.context === undefined) {
        result = [...result, ...hunk.add];
        continue;
      }

      const at = result.findIndex((line) =>
        line.includes(hunk.context as string),
      );
      if (at === -1) {
        fail(
          `${filePath}: no line matches the context '${hunk.context}' - nothing was changed in this file`,
        );
      }
      result.splice(at + 1, 0, ...hunk.add);
      continue;
    }

    const at = findSequence(result, hunk.remove);
    if (at === -1) {
      fail(
        `${filePath}: the lines to remove were not found, starting at '${hunk.remove[0]}' - nothing was changed in this file`,
      );
    }
    result.splice(at, hunk.remove.length, ...hunk.add);
  }

  return result;
}

function findSequence(haystack: string[], needle: string[]): number {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) {
      return start;
    }
  }
  return -1;
}

function describe(files: PatchedFile[]): string {
  return files.map((file) => `${file.kind} ${file.path}`).join(", ");
}

/**
 * Every destination has to be nameable before anything is written: the approval
 * the user gives is for the paths listed in the preview, and a path that escapes
 * the workspace is refused rather than asked about twice.
 */
function checkedTargets(files: PatchedFile[]): string[] {
  return files.map((file) => {
    const resolved = path.resolve(file.path);
    if (!isWithinWorkspace(resolved)) {
      throw new Error(
        `ApplyPatch writes inside the workspace only; '${file.path}' is outside it.`,
      );
    }
    return resolved;
  });
}

/** Compute the whole patch first, so a failure halfway leaves no file written. */
function planWrites(
  files: PatchedFile[],
): { kind: PatchedFile["kind"]; path: string; content?: string }[] {
  return files.map((file) => {
    const resolved = path.resolve(file.path);

    if (file.kind === "delete") {
      if (!fs.existsSync(resolved)) {
        fail(`${file.path}: there is no file to delete`);
      }
      return { kind: "delete", path: resolved };
    }

    if (file.kind === "add") {
      if (fs.existsSync(resolved)) {
        fail(
          `${file.path}: already exists, so an Add File section would overwrite it`,
        );
      }
      return {
        kind: "add",
        path: resolved,
        content:
          (file.added ?? []).map((line) => line.slice(1)).join("\n") + "\n",
      };
    }

    if (!fs.existsSync(resolved)) {
      fail(
        `${file.path}: does not exist, so an Update File section has nothing to change`,
      );
    }
    if (changedSinceSeen(resolved)) {
      fail(
        `${file.path}: changed since it was read; read it again before patching it`,
      );
    }

    const current = fs.readFileSync(resolved, "utf-8").split("\n");

    return {
      kind: "update",
      path: resolved,
      content: applyHunks(file.path, current, file.hunks ?? []).join("\n"),
    };
  });
}

export const applyPatchTool: Tool = {
  name: "ApplyPatch",
  displayName: "Apply Patch",
  description: `Apply a patch that changes several files in one step, in the shape git apply reads. One call covers the whole change and is approved once, and nothing is written unless every file and every hunk can be applied.

*** Begin Patch
*** Add File: src/new.ts
+export const value = 1;
*** Update File: src/old.ts
@@ const legacy = 0;
-const legacy = 0;
+const legacy = 1;
*** Delete File: src/gone.ts
*** End Patch

A '@@' line names surrounding context. Lines starting with '-' must be found in the file and are replaced by the '+' lines that follow them; '+' lines with no '-' lines are inserted after the context, or appended when there is none. When a hunk cannot be located the result names it and no file is touched. Paths stay inside the workspace, an Add never overwrites, and a file that changed since you read it is refused rather than written over.`,
  parameters: {
    type: "object",
    required: ["patch"],
    properties: {
      patch: {
        type: "string",
        description:
          "The whole patch, from '*** Begin Patch' to '*** End Patch'",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => {
    const raw = typeof args?.patch === "string" ? args.patch : "";
    let files: PatchedFile[];
    try {
      files = parseApplyPatch(raw);
      checkedTargets(files);
    } catch (error) {
      throw new Error(
        `Could not read the patch: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      args: { patch: raw },
      preview: [
        {
          type: "text",
          content: `Will apply a patch to ${files.length} file${files.length === 1 ? "" : "s"}: ${describe(files)}`,
        },
      ],
    };
  },
  run: async (args: { patch: string }): Promise<string> => {
    const files = parseApplyPatch(args.patch);
    checkedTargets(files);

    // Planned before written: a patch that fails on its third file leaves the
    // first two alone, which is the promise the description makes.
    const planned = planWrites(files);

    const done: string[] = [];
    for (const entry of planned) {
      if (entry.kind === "delete") {
        fs.rmSync(entry.path);
        markFileAsSeen(entry.path);
        scheduleFileRefresh(entry.path);
        done.push(`deleted ${entry.path}`);
        continue;
      }

      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      writeFileAtomically(entry.path, entry.content ?? "");
      markFileAsSeen(entry.path);
      scheduleFileRefresh(entry.path);
      done.push(
        `${entry.kind === "add" ? "created" : "updated"} ${entry.path}`,
      );
    }

    return `Patch applied:\n${done.map((line) => `- ${line}`).join("\n")}`;
  },
};
