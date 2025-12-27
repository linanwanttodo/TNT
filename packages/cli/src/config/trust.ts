import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { logger } from "../utils/logger.js";

import { globalDir } from "./globalDir.js";

/**
 * Project-level configuration can run hooks, start MCP servers and widen
 * permissions. Cloning a repository must not be enough to do any of that, so
 * the first load asks for trust and records the content hash it was granted
 * for; changing any of these files revokes the grant.
 */
const PROJECT_FILES = [
  path.join(".claude", "settings.json"),
  path.join(".claude", "settings.local.json"),
  path.join(".tnt", "settings.json"),
  path.join(".tnt", "settings.local.json"),
  path.join(".tnt", "mcp.json"),
  ".mcp.json",
];

export function trustedProjectsPath(home: string = os.homedir()): string {
  return path.join(globalDir(home), "trusted-projects.json");
}

export function projectConfigFiles(cwd: string = process.cwd()): string[] {
  return PROJECT_FILES.map((relative) => path.join(cwd, relative)).filter(
    (file) => fs.existsSync(file),
  );
}

/** Hash of every project config file that exists; null when there are none. */
export function projectConfigHash(cwd: string = process.cwd()): string | null {
  const files = projectConfigFiles(cwd).sort();
  if (files.length === 0) return null;

  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(cwd, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file, "utf-8"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function projectKey(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

function readTrusted(): Record<string, string> {
  const file = trustedProjectsPath();
  try {
    if (!fs.existsSync(file)) return {};
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return Object.fromEntries(entries);
  } catch (error) {
    logger.warn("Failed to read trusted-projects.json", { error });
    return {};
  }
}

/** True when there is nothing to trust, or the current contents were trusted. */
export function isProjectTrusted(cwd: string = process.cwd()): boolean {
  const hash = projectConfigHash(cwd);
  if (!hash) return true;
  return readTrusted()[projectKey(cwd)] === hash;
}

/** Records trust for the current project contents. */
export function trustProject(cwd: string = process.cwd()): void {
  const hash = projectConfigHash(cwd);
  if (!hash) return;

  const file = trustedProjectsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const trusted = { ...readTrusted(), [projectKey(cwd)]: hash };
  writeFileAtomically(file, `${JSON.stringify(trusted, null, 2)}\n`);
  logger.info("Trusted project configuration", { project: projectKey(cwd) });
}
