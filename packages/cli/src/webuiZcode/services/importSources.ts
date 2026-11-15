import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ZCodeImportSessionsResult,
  ZCodeImportableSessionCandidate,
} from "@zcode/shared";
import type { Session } from "core/index.js";

import { sessionStore } from "../../session/store.js";
import { resolveWithin } from "../../utils/pathGuard.js";

/**
 * Import of another agent's local state into TNT. Sessions become TNT
 * transcripts; MCP servers, skills and commands are copied into the global
 * state tree. Only whitelisted file names reach the filesystem, and every
 * derived path is anchored with resolveWithin.
 */
export interface ImportCandidate extends ZCodeImportableSessionCandidate {
  kind: "session" | "mcp" | "skill" | "tool";
}

export interface ImportScanOptions {
  workspacePath?: string;
  modifiedSince?: number;
  limit?: number;
  claudeDir?: string;
  tntDir?: string;
}

export interface ImportResult extends ZCodeImportSessionsResult {
  assets: Array<{ kind: "mcp" | "skill" | "tool"; name: string; path: string }>;
}

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_SCAN_DEPTH = 4;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Every read of an external file is anchored to its own directory first. */
function readVerified(file: string): string {
  const anchored = resolveWithin(path.dirname(file), path.basename(file));
  return fs.readFileSync(anchored, "utf8");
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readVerified(file)) as unknown;
  } catch {
    return null;
  }
}

export function claudeHome(override?: string): string {
  return override ?? path.join(os.homedir(), ".claude");
}

function tntHome(override?: string): string {
  return override ?? path.join(os.homedir(), ".tnt");
}

export function collectJsonlFiles(root: string, depth = 0): string[] {
  if (depth > MAX_SCAN_DEPTH) return [];
  const anchoredRoot = path.resolve(root);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(anchoredRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!SAFE_NAME.test(entry.name)) continue;
    const target = resolveWithin(anchoredRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(target, depth + 1));
    } else if (entry.name.endsWith(".jsonl")) {
      files.push(target);
    }
  }
  return files;
}

/** First JSON object of a JSONL file, or null when the file is unusable. */
export function headRecord(file: string): Record<string, unknown> | null {
  try {
    const text = readVerified(file).split("\n")[0];
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Convert one Claude Code JSONL transcript into TNT history items. */
export function claudeTranscriptToHistory(file: string): Session["history"] {
  const history: Session["history"] = [];
  let raw: string;
  try {
    raw = readVerified(file);
  } catch {
    return history;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record: Record<string, unknown> | null = null;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : "";
    const message = asRecord(record.message);
    const content = message?.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((part) => {
          const item = asRecord(part);
          return item?.type === "text" && typeof item.text === "string"
            ? item.text
            : "";
        })
        .filter(Boolean)
        .join("\n");
    }
    if (!text.trim()) continue;
    const role =
      type === "user" ? "user" : type === "assistant" ? "assistant" : "";
    if (!role) continue;
    history.push({
      message: { role, content: text },
      contextItems: [],
    });
  }
  return history;
}

function assetCandidates(
  home: string,
  kind: "skills" | "commands",
): ImportCandidate[] {
  const dir = resolveWithin(home, kind);
  if (!fs.existsSync(dir)) return [];
  const result: ImportCandidate[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!SAFE_NAME.test(entry)) continue;
    const file = resolveWithin(dir, entry);
    if (!fs.statSync(file).isFile()) continue;
    result.push({
      provider: "claude",
      kind: kind === "skills" ? "skill" : "tool",
      sessionId: `${kind}:${entry}`,
      workspacePath: "",
      sourcePath: file,
      updatedAt: Date.now(),
      previewTitle: entry,
    });
  }
  return result;
}

export function scanImportCandidates(
  options: ImportScanOptions = {},
): ImportCandidate[] {
  const home = claudeHome(options.claudeDir);
  const projectsDir = resolveWithin(home, "projects");
  const candidates: ImportCandidate[] = [];
  for (const file of collectJsonlFiles(projectsDir)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const updatedAt = Math.trunc(stat.mtimeMs);
    if (options.modifiedSince && updatedAt < options.modifiedSince) continue;
    const head = headRecord(file);
    const workspacePath =
      typeof head?.cwd === "string"
        ? head.cwd
        : typeof head?.workspacePath === "string"
          ? head.workspacePath
          : "";
    if (
      options.workspacePath &&
      workspacePath &&
      path.resolve(workspacePath) !== path.resolve(options.workspacePath)
    ) {
      continue;
    }
    const sessionId = path.basename(file, ".jsonl");
    if (!sessionId) continue;
    const title =
      typeof head?.title === "string"
        ? head.title
        : typeof head?.summary === "string"
          ? head.summary
          : undefined;
    candidates.push({
      provider: "claude",
      kind: "session",
      sessionId,
      workspacePath,
      sourcePath: file,
      updatedAt,
      createdAt: Math.trunc(stat.birthtimeMs),
      ...(title ? { previewTitle: title } : {}),
    });
  }
  const settings = asRecord(readJson(resolveWithin(home, "settings.json")));
  const mcpServers = asRecord(settings?.mcpServers);
  for (const [name, value] of Object.entries(mcpServers ?? {})) {
    if (!SAFE_NAME.test(name)) continue;
    const record = asRecord(value);
    const command = typeof record?.command === "string" ? record.command : name;
    candidates.push({
      provider: "claude",
      kind: "mcp",
      sessionId: `mcp:${name}`,
      workspacePath: "",
      sourcePath: JSON.stringify({ command, args: record?.args ?? [] }),
      updatedAt: Date.now(),
      previewTitle: name,
    });
  }
  candidates.push(...assetCandidates(home, "skills"));
  candidates.push(...assetCandidates(home, "commands"));
  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return options.limit ? candidates.slice(0, options.limit) : candidates;
}

export function importCandidates(
  ids: readonly string[],
  options: ImportScanOptions = {},
): ImportResult {
  const all = scanImportCandidates(options);
  const selected = all.filter((item) => ids.includes(item.sessionId));
  const result: ImportResult = {
    imported: [],
    skipped: [],
    failed: [],
    assets: [],
  };
  const destinationRoot = tntHome(options.tntDir);
  for (const item of selected) {
    try {
      if (item.kind === "session") {
        if (sessionStore.load(item.sessionId)) {
          result.skipped.push({
            provider: "claude",
            sessionId: item.sessionId,
            reason: "already-imported",
            workspacePath: item.workspacePath,
          });
          continue;
        }
        const history = claudeTranscriptToHistory(item.sourcePath);
        if (history.length === 0) {
          result.skipped.push({
            provider: "claude",
            sessionId: item.sessionId,
            reason: "empty-transcript",
          });
          continue;
        }
        sessionStore.ensureSession(
          {
            sessionId: item.sessionId,
            title: item.previewTitle?.slice(0, 120) || item.sessionId,
            workspaceDirectory: item.workspacePath || process.cwd(),
            history,
          },
          { source: "import" },
        );
        result.imported.push({
          provider: "claude",
          sessionId: item.sessionId,
          taskId: item.sessionId,
          workspacePath: item.workspacePath,
        });
        continue;
      }
      const kindDir =
        item.kind === "mcp"
          ? "mcp"
          : item.kind === "skill"
            ? "skills"
            : "commands";
      const targetDir = resolveWithin(destinationRoot, kindDir);
      fs.mkdirSync(targetDir, { recursive: true });
      const name = item.sessionId.replace(/^(mcp|skills|commands):/, "");
      if (!SAFE_NAME.test(name)) {
        result.failed.push({
          provider: "claude",
          sessionId: item.sessionId,
          reason: "unsafe-name",
        });
        continue;
      }
      const target = resolveWithin(targetDir, name);
      if (item.kind === "mcp") {
        fs.writeFileSync(`${target}.json`, `${item.sourcePath}\n`, {
          mode: 0o600,
        });
      } else {
        fs.copyFileSync(item.sourcePath, target);
      }
      result.assets.push({
        kind: item.kind,
        name,
        path: item.kind === "mcp" ? `${target}.json` : target,
      });
    } catch (error) {
      result.failed.push({
        provider: "claude",
        sessionId: item.sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
