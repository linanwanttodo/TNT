import fs from "node:fs";
import path from "node:path";

import { globalDir } from "../config/globalDir.js";

/**
 * Which markdown skills the operator turned off in settings. The loader still
 * discovers a disabled skill so the settings list can show it and turn it back
 * on; the slash-command list and the Skills tool skip it, so the toggle is a
 * behavioral change, not just a repaint.
 */
interface SkillsStateFile {
  disabled: string[];
}

const STATE_FILE = "skills-state.json";
const MAX_ENTRIES = 1000;

function statePath(): string {
  return path.join(globalDir(), STATE_FILE);
}

function readState(): SkillsStateFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as {
      disabled?: unknown;
    };
    return {
      disabled: Array.isArray(parsed?.disabled)
        ? parsed.disabled.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
    };
  } catch {
    return { disabled: [] };
  }
}

function writeState(state: SkillsStateFile): void {
  const file = statePath();
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      temp,
      `${JSON.stringify({ disabled: state.disabled.slice(-MAX_ENTRIES) }, null, 2)}\n`,
      { mode: 0o600 },
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

export function isSkillEnabled(absoluteSkillFile: string): boolean {
  return !readState().disabled.includes(path.resolve(absoluteSkillFile));
}

export function setSkillEnabled(
  absoluteSkillFile: string,
  enabled: boolean,
): void {
  const key = path.resolve(absoluteSkillFile);
  const state = readState();
  const next = new Set(state.disabled);
  if (enabled) {
    next.delete(key);
  } else {
    next.add(key);
  }
  writeState({ disabled: [...next] });
}
