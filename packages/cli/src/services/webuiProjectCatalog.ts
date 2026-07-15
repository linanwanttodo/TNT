/**
 * The local project catalog the web shell writes to.
 *
 * TNT has no project database: a project is a real directory the operator
 * opened. This module keeps the small amount of organization state that the
 * shell persists - name, order, pin, soft deletion and timestamps - in one
 * JSON file under the global directory. The served workspace is not required
 * to be stored; the project service synthesizes it and adds it on the first
 * mutation, so the shell always has a host project even before any write.
 *
 * Every path is canonicalized before it is stored or compared. A relative or
 * malformed entry is dropped at load time; a symlink is resolved so the record
 * names the directory it really points at instead of a path that could later
 * be re-pointed somewhere else.
 */
import fs from "node:fs";
import path from "node:path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { globalDir } from "../config/globalDir.js";
import { logger } from "../utils/logger.js";
import type {
  LocalProjectCatalog,
  LocalProjectRecord,
  LocalProjectUpdate,
} from "../webuiZcode/services/projects.js";

export const WEBUI_PROJECTS_FILE = "webui-projects.json";
/** A bounded catalog keeps one bad writer from growing the file without end. */
export const MAX_WEBUI_PROJECTS = 50;

const CATALOG_VERSION = 1;
const MAX_NAME_LENGTH = 200;

export function webUiProjectId(projectPath: string): string {
  return `local:${projectPath}`;
}

export function defaultWebUiProjectsPath(): string {
  return path.join(globalDir(), WEBUI_PROJECTS_FILE);
}

export interface WebUiProjectCatalog extends LocalProjectCatalog {
  readonly filePath: string;
  /** Re-reads the file; used by tests and by a host that replaced the file. */
  reload(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absolute, symlink-free when the directory exists; null for a bad entry. */
function canonicalPath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return null;
  }
  if (!path.isAbsolute(candidate)) {
    return null;
  }
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // A workspace that has disappeared still belongs in the list; it shows as
    // missing rather than vanishing from under the shell.
    return resolved;
  }
}

function sanitizeName(candidate: unknown, projectPath: string): string {
  const raw = typeof candidate === "string" ? candidate : "";
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = cleaned.slice(0, MAX_NAME_LENGTH);
  if (bounded) {
    return bounded;
  }
  return path.basename(projectPath) || projectPath;
}

function timestamp(candidate: unknown): number {
  return typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate > 0
    ? Math.floor(candidate)
    : 0;
}

function copyRecord(record: LocalProjectRecord): LocalProjectRecord {
  return { ...record };
}

function byPosition(
  left: LocalProjectRecord,
  right: LocalProjectRecord,
): number {
  return (
    left.position - right.position ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
}

interface LoadedDocument {
  projects: unknown[];
}

function documentProjects(parsed: unknown): unknown[] {
  const document: LoadedDocument = Array.isArray(parsed)
    ? { projects: parsed }
    : isRecord(parsed) && Array.isArray(parsed.projects)
      ? { projects: parsed.projects }
      : { projects: [] };
  return document.projects;
}

function loadRecords(filePath: string): Map<string, LocalProjectRecord> {
  const records = new Map<string, LocalProjectRecord>();

  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Could not read the web UI project catalog", {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return records;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger.warn("Ignoring a malformed web UI project catalog", {
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return records;
  }

  for (const entry of documentProjects(parsed)) {
    if (!isRecord(entry)) {
      continue;
    }
    const projectPath = canonicalPath(entry.path);
    if (!projectPath) {
      continue;
    }
    const id = webUiProjectId(projectPath);
    if (records.has(id)) {
      continue;
    }
    const createdAt = timestamp(entry.createdAt);
    records.set(id, {
      id,
      path: projectPath,
      name: sanitizeName(entry.name, projectPath),
      position:
        typeof entry.position === "number" &&
        Number.isInteger(entry.position) &&
        entry.position >= 0
          ? entry.position
          : records.size,
      pinned: entry.pinned === true,
      deleted: entry.deleted === true,
      createdAt,
      updatedAt: timestamp(entry.updatedAt) || createdAt,
    });
  }

  return records;
}

class WebUiProjectCatalogStore implements WebUiProjectCatalog {
  readonly filePath: string;
  private records: Map<string, LocalProjectRecord>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.records = loadRecords(filePath);
  }

  reload(): void {
    this.records = loadRecords(this.filePath);
  }

  all(): LocalProjectRecord[] {
    return [...this.records.values()].sort(byPosition).map(copyRecord);
  }

  find(id: string): LocalProjectRecord | undefined {
    const record = this.records.get(id);
    return record ? copyRecord(record) : undefined;
  }

  findByPath(candidate: string): LocalProjectRecord | undefined {
    const projectPath = canonicalPath(candidate);
    return projectPath ? this.find(webUiProjectId(projectPath)) : undefined;
  }

  ensure(
    candidate: string,
    defaults: { name?: string; position?: number } = {},
  ): LocalProjectRecord {
    const projectPath = canonicalPath(candidate);
    if (!projectPath) {
      throw new Error(
        `A local project path must be an absolute directory: ${candidate}`,
      );
    }
    const id = webUiProjectId(projectPath);
    const existing = this.records.get(id);
    if (existing) {
      return copyRecord(existing);
    }

    const now = Date.now();
    const record: LocalProjectRecord = {
      id,
      path: projectPath,
      name: sanitizeName(defaults.name, projectPath),
      position: defaults.position ?? this.nextPosition(),
      pinned: false,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, record);
    this.persist();
    return copyRecord(record);
  }

  update(
    id: string,
    patch: LocalProjectUpdate,
  ): LocalProjectRecord | undefined {
    const existing = this.records.get(id);
    if (!existing) {
      return undefined;
    }
    const next: LocalProjectRecord = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now(),
    };
    if (patch.name !== undefined) {
      next.name = sanitizeName(patch.name, existing.path);
    }
    if (patch.position !== undefined) {
      next.position = Math.max(0, Math.floor(patch.position));
    }
    this.records.set(id, next);
    this.persist();
    return copyRecord(next);
  }

  remove(id: string): boolean {
    const removed = this.records.delete(id);
    if (removed) {
      this.persist();
    }
    return removed;
  }

  reorder(ids: readonly string[]): void {
    const ordered = ids.filter((id) => this.records.has(id));
    let position = 0;
    for (const id of ordered) {
      const record = this.records.get(id);
      if (record) {
        record.position = position;
        position += 1;
      }
    }
    const seen = new Set(ordered);
    for (const record of [...this.records.values()].sort(byPosition)) {
      if (!seen.has(record.id)) {
        record.position = position;
        position += 1;
      }
    }
    this.persist();
  }

  private nextPosition(): number {
    let max = -1;
    for (const record of this.records.values()) {
      max = Math.max(max, record.position);
    }
    return max + 1;
  }

  private trim(): void {
    if (this.records.size <= MAX_WEBUI_PROJECTS) {
      return;
    }
    const keep = [...this.records.values()]
      .sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          right.updatedAt - left.updatedAt ||
          left.id.localeCompare(right.id),
      )
      .slice(0, MAX_WEBUI_PROJECTS);
    this.records = new Map(keep.map((record) => [record.id, record]));
  }

  private persist(): void {
    this.trim();
    const projects = [...this.records.values()]
      .sort(byPosition)
      .map((record) => ({
        path: record.path,
        name: record.name,
        position: record.position,
        pinned: record.pinned,
        deleted: record.deleted,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    try {
      fs.mkdirSync(path.dirname(this.filePath), {
        recursive: true,
        mode: 0o700,
      });
      writeFileAtomically(
        this.filePath,
        `${JSON.stringify({ version: CATALOG_VERSION, projects }, null, 2)}\n`,
      );
      try {
        // The catalog names directories the operator has visited, which is not
        // public state: keep it readable by this account only even when the
        // file was created by an older build with a wider mode.
        fs.chmodSync(this.filePath, 0o600);
      } catch (error) {
        logger.debug("Could not restrict the web UI project catalog mode", {
          file: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      logger.warn("Could not write the web UI project catalog", {
        file: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createWebUiProjectCatalog(
  filePath: string = defaultWebUiProjectsPath(),
): WebUiProjectCatalog {
  return new WebUiProjectCatalogStore(filePath);
}

let processCatalog: WebUiProjectCatalog | null = null;
let processCatalogPath: string | null = null;

/** The catalog shared by every connection the process serves. */
export function getWebUiProjectCatalog(): WebUiProjectCatalog {
  const file = defaultWebUiProjectsPath();
  if (!processCatalog || processCatalogPath !== file) {
    processCatalog = createWebUiProjectCatalog(file);
    processCatalogPath = file;
  }
  return processCatalog;
}

export function resetWebUiProjectCatalogForTests(): void {
  processCatalog = null;
  processCatalogPath = null;
}
