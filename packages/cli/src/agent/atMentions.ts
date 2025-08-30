import * as fs from "fs";
import * as path from "path";

import type { ContextItemWithId } from "core/index.js";

import { markFileAsSeen } from "../tools/fileState.js";

/**
 * What `@path` in a prompt does. The reference expands a mention into the
 * message the model receives; without expansion the model only sees the
 * literal token and spends a round on Read for something the user already
 * named.
 */
const MAX_MENTION_LINES = 2_000;
const MAX_MENTION_CHARS = 100_000;
const MAX_TOTAL_CHARS = 250_000;
const MAX_MENTIONS = 8;
const MAX_LISTING_ENTRIES = 1_000;

/** Trailing prose punctuation is not part of a path; a line spec is. */
const TRAILING_PUNCTUATION = /[.,;:!?)"'\]]+$/;

export interface ExpandedMentions {
  contextItems: ContextItemWithId[];
  /**
   * Mentions that were not attached, each with the reason. They stay in the
   * prompt text so the model can act on them (search, or read a range) instead
   * of concluding the user referred to nothing.
   */
  notes: string[];
}

function parseLineSpec(token: string): { raw: string; range?: string } {
  const match = /^(.+?):(\d+)(?:-(\d+))?$/.exec(token);
  if (!match) {
    return { raw: token.replace(TRAILING_PUNCTUATION, "") };
  }
  const start = Number(match[2]);
  const end = match[3] ? Number(match[3]) : start;
  return { raw: match[1], range: `${start}-${Math.max(start, end)}` };
}

function findMentions(input: string): string[] {
  const found: string[] = [];
  for (const match of input.matchAll(/(?:^|\s)@([^\s]+)/g)) {
    const token = match[1];
    if (token && !found.includes(token)) {
      found.push(token);
    }
  }
  return found;
}

function displayName(cwd: string, resolved: string, range?: string): string {
  const relative = path.relative(cwd, resolved) || path.basename(resolved);
  return range ? `${relative}:${range}` : relative;
}

function contextItem(
  name: string,
  description: string,
  content: string,
  resolved: string,
): ContextItemWithId {
  return {
    id: { providerTitle: "file", itemId: resolved },
    name,
    description,
    content,
    uri: { type: "file", value: resolved },
  };
}

/**
 * `alreadyAttached` is what the interface put on the message before this ran -
 * a file picked from the `@` autocomplete arrives as an attachment while its
 * `@path` text stays in the prompt, so expanding it again would pay for the
 * same file twice. Attachments name their file as a `file://` uri, so both
 * spellings are compared.
 */
export function expandMentions(
  input: string,
  cwd: string = process.cwd(),
  alreadyAttached: ContextItemWithId[] = [],
): ExpandedMentions {
  const result: ExpandedMentions = { contextItems: [], notes: [] };
  const attached = new Set(
    alreadyAttached.map((item) => {
      const value = item.uri?.value ?? item.name;
      return value.startsWith("file://")
        ? path.resolve(value.slice("file://".length))
        : value;
    }),
  );
  let usedChars = alreadyAttached.reduce(
    (total, item) => total + item.content.length,
    0,
  );
  const tokens = findMentions(input);

  for (const [index, token] of tokens.entries()) {
    if (index >= MAX_MENTIONS) {
      result.notes.push(
        `@${token}: not attached, more than ${MAX_MENTIONS} mentions in one prompt`,
      );
      continue;
    }

    const { raw, range } = parseLineSpec(token);
    const absolute = path.isAbsolute(raw)
      ? path.normalize(raw)
      : path.resolve(cwd, raw);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      result.notes.push(`@${token}: not found at ${absolute}`);
      continue;
    }

    if (attached.has(absolute)) {
      // The interface already put these bytes on the message.
      continue;
    }

    const room = MAX_TOTAL_CHARS - usedChars;
    if (room <= 0) {
      result.notes.push(
        `@${token}: not attached, the context gathered from earlier mentions already fills ${MAX_TOTAL_CHARS.toLocaleString()} characters`,
      );
      continue;
    }

    if (stat.isDirectory()) {
      const entries = fs
        .readdirSync(absolute)
        .sort()
        .slice(0, MAX_LISTING_ENTRIES);
      const listing = entries.join("\n").slice(0, room);
      usedChars += listing.length;
      result.contextItems.push(
        contextItem(
          displayName(cwd, absolute) + "/",
          `${entries.length} entries`,
          listing,
          absolute,
        ),
      );
      continue;
    }

    const content = fs.readFileSync(absolute, "utf-8");
    if (content.includes("\0")) {
      result.notes.push(`@${token}: binary file, not attached`);
      continue;
    }

    const allLines = content.split("\n");
    let selected = allLines;
    let note: string | undefined;

    if (range) {
      const [from, to] = range.split("-").map(Number);
      selected = allLines.slice(Math.max(0, from - 1), to);
      if (selected.length === 0) {
        result.notes.push(
          `@${token}: lines ${range} are past the end of a ${allLines.length}-line file`,
        );
        continue;
      }
    } else if (allLines.length > MAX_MENTION_LINES) {
      selected = allLines.slice(0, MAX_MENTION_LINES);
      note = ` first ${MAX_MENTION_LINES} of ${allLines.length} lines`;
    }

    let excerpt = selected.join("\n");
    if (excerpt.length > MAX_MENTION_CHARS) {
      excerpt = excerpt.slice(0, MAX_MENTION_CHARS);
      note = `${note ?? ""} truncated at ${MAX_MENTION_CHARS.toLocaleString()} characters`;
    }
    if (excerpt.length > room) {
      excerpt = excerpt.slice(0, room);
      note = `${note ?? ""} cut at the ${MAX_TOTAL_CHARS.toLocaleString()}-character budget for this prompt`;
    }
    usedChars += excerpt.length;

    // The mention is the read: from here the agent may edit the file without a
    // separate Read, and the stamp makes a later outside change visible.
    markFileAsSeen(absolute);

    result.contextItems.push(
      contextItem(
        displayName(cwd, absolute, range),
        `${selected.length} lines${note ?? ""}`,
        excerpt,
        absolute,
      ),
    );
  }

  if (result.notes.length > 0) {
    // The user's text is left exactly as typed; what the model learns about a
    // mention that could not be honoured rides alongside it.
    result.contextItems.push({
      id: { providerTitle: "file", itemId: "unattached-mentions" },
      name: "unattached mentions",
      description: `${result.notes.length} mentioned paths were not attached`,
      content: result.notes.join("\n"),
    });
  }

  return result;
}
