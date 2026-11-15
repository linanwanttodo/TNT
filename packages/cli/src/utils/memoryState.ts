import fs from "node:fs";
import path from "node:path";

import { globalDir } from "../config/globalDir.js";

/**
 * The operator's "use workspace memory" choice. The memory file stays on disk
 * when the switch is off; the system prompt simply stops injecting it, and the
 * settings page shows the switch state it will actually honor.
 */
const STATE_FILE = "memory-state.json";

function statePath(): string {
  return path.join(globalDir(), STATE_FILE);
}

export function isMemoryEnabled(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf-8")) as {
      enabled?: unknown;
    };
    return parsed?.enabled !== false;
  } catch {
    return true;
  }
}

export function setMemoryEnabled(enabled: boolean): void {
  const file = statePath();
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify({ enabled }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // ignore
    }
  }
}
