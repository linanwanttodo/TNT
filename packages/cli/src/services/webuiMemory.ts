import fs from "node:fs";
import path from "node:path";

import type {
  IMemoryService,
  ProjectMemoryWorkspaceSummary,
} from "@zcode/services";

import { globalDir } from "../config/globalDir.js";
import { isMemoryEnabled, setMemoryEnabled } from "../utils/memoryState.js";

import {
  getWebUiProjectCatalog,
  webUiProjectId,
} from "./webuiProjectCatalog.js";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";
const MEMORY_FILE = "TNT.md";

function memoryFile(workspacePath: string): string {
  return path.join(workspacePath, ".tnt", MEMORY_FILE);
}

function summarizeWorkspace(
  workspacePath: string,
  label: string,
): ProjectMemoryWorkspaceSummary | null {
  const file = memoryFile(workspacePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  return {
    id: webUiProjectId(workspacePath),
    label,
    updatedAt: Math.floor(stat.mtimeMs),
    files: [
      {
        name: MEMORY_FILE,
        path: file,
        kind: "index",
        size: stat.size,
        updatedAt: Math.floor(stat.mtimeMs),
      },
    ],
  };
}

/**
 * Workspace memory for the shell: the same `TNT.md` files the system prompt
 * injects. The switch is the operator's own state, so turning it off stops the
 * injection while the file stays on disk for the viewer.
 */
export function createTntMemoryService(workspacePath: string): IMemoryService {
  return {
    async loadMemory({ workspacePath: target }) {
      try {
        const content = fs.readFileSync(memoryFile(target), "utf-8");
        return { memory: { content, enabled: isMemoryEnabled() } };
      } catch {
        return { memory: null };
      }
    },

    async saveMemory({ workspacePath: target, config }) {
      const file = memoryFile(target);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, config.content, { mode: 0o600 });
      if (typeof config.enabled === "boolean") {
        setMemoryEnabled(config.enabled);
      }
    },

    async clearMemory({ workspacePath: target }) {
      fs.rmSync(memoryFile(target), { force: true });
    },

    async getUserMemoryDirectory() {
      const directory = path.join(globalDir(), "memory");
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      return { path: directory };
    },

    async listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]> {
      const catalog = getWebUiProjectCatalog();
      const seen = new Set<string>();
      const summaries: ProjectMemoryWorkspaceSummary[] = [];
      const candidates = [
        { path: workspacePath, label: path.basename(workspacePath) },
      ];
      for (const record of catalog.all()) {
        if (!record.deleted) {
          candidates.push({ path: record.path, label: record.name });
        }
      }
      for (const candidate of candidates) {
        if (seen.has(candidate.path)) {
          continue;
        }
        seen.add(candidate.path);
        const summary = summarizeWorkspace(candidate.path, candidate.label);
        if (summary) {
          summaries.push(summary);
        }
      }
      return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
    },

    async readProjectMemoryFile({ workspaceId, fileName }) {
      const records = getWebUiProjectCatalog().all();
      const record = records.find((entry) => entry.id === workspaceId);
      const target =
        record?.path ??
        (workspaceId === webUiProjectId(workspacePath) ? workspacePath : null);
      if (!target) {
        throw new Error(
          `${UNAVAILABLE}: memory: unknown workspace ${workspaceId}`,
        );
      }
      if (path.basename(fileName) !== fileName || fileName !== MEMORY_FILE) {
        throw new Error(
          `${UNAVAILABLE}: memory: only ${MEMORY_FILE} is a project memory file`,
        );
      }
      const file = memoryFile(target);
      const content = fs.readFileSync(file, "utf-8");
      return {
        content,
        updatedAt: Math.floor(fs.statSync(file).mtimeMs),
      };
    },
  };
}
