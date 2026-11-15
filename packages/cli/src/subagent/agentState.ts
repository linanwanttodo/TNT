import fs from "node:fs";
import path from "node:path";

import { globalDir } from "../config/globalDir.js";

/**
 * The operator's per-agent preferences: whether a subagent may be dispatched,
 * and which configured model it runs on. Both the engine (dispatch, listing)
 * and the web settings page read this file, so a toggle in the UI changes what
 * a turn actually does instead of only repainting the list.
 *
 * Keys name the agent's origin so the same display name in two scopes cannot
 * collide: `builtin:<name>`, `plugin:<id>`, `markdown:<scope>:<name>`.
 */
export interface SubagentPreference {
  enabled?: boolean;
  /** A configured model entry's name; unknown names fall back at dispatch. */
  model?: string;
  thoughtLevel?: string;
}

interface SubagentStateFile {
  agents: Record<string, SubagentPreference>;
}

const STATE_FILE = "subagents-state.json";
const MAX_ENTRIES = 500;

function statePath(): string {
  return path.join(globalDir(), STATE_FILE);
}

function readState(): SubagentStateFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as {
      agents?: unknown;
    };
    const agents: Record<string, SubagentPreference> = {};
    if (parsed?.agents && typeof parsed.agents === "object") {
      for (const [key, value] of Object.entries(
        parsed.agents as Record<string, unknown>,
      )) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const entry = value as Record<string, unknown>;
        agents[key] = {
          ...(typeof entry.enabled === "boolean"
            ? { enabled: entry.enabled }
            : {}),
          ...(typeof entry.model === "string" && entry.model
            ? { model: entry.model }
            : {}),
          ...(typeof entry.thoughtLevel === "string" && entry.thoughtLevel
            ? { thoughtLevel: entry.thoughtLevel }
            : {}),
        };
      }
    }
    return { agents };
  } catch {
    return { agents: {} };
  }
}

function writeState(state: SubagentStateFile): void {
  const entries = Object.entries(state.agents).slice(-MAX_ENTRIES);
  const file = statePath();
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      temp,
      `${JSON.stringify({ agents: Object.fromEntries(entries) }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    fs.renameSync(temp, file);
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // ignore
    }
  }
}

export function getSubagentPreference(key: string): SubagentPreference {
  return readState().agents[key] ?? {};
}

export function isSubagentEnabled(key: string): boolean {
  return readState().agents[key]?.enabled !== false;
}

export function setSubagentEnabled(key: string, enabled: boolean): void {
  const state = readState();
  state.agents[key] = { ...state.agents[key], enabled };
  writeState(state);
}

export function removeSubagentPreference(key: string): void {
  const state = readState();
  if (!(key in state.agents)) {
    return;
  }
  delete state.agents[key];
  writeState(state);
}

export function setSubagentModelOverride(
  key: string,
  override: { model?: string; thoughtLevel?: string } | undefined,
): void {
  const state = readState();
  const existing = state.agents[key] ?? {};
  const next: SubagentPreference = { ...existing };
  delete next.model;
  delete next.thoughtLevel;
  if (override?.model) {
    next.model = override.model;
  }
  if (override?.thoughtLevel) {
    next.thoughtLevel = override.thoughtLevel;
  }
  if (Object.keys(next).length === 0) {
    delete state.agents[key];
  } else {
    state.agents[key] = next;
  }
  writeState(state);
}

export function subagentStateKey(
  source: "builtin" | "plugin" | "markdown",
  name: string,
  scope?: string,
): string {
  if (source === "builtin") {
    return `builtin:${name.toLowerCase()}`;
  }
  if (source === "plugin") {
    return `plugin:${name}`;
  }
  return `markdown:${scope ?? "user"}:${name.toLowerCase()}`;
}
