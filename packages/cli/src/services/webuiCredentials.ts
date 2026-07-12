import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ICredentialService } from "@zcode/services";

import { globalDir } from "../config/globalDir.js";
import { logger } from "../utils/logger.js";

export const WEBUI_CREDENTIALS_FILE = "webui-credentials.json";

/**
 * The shell's credential channel. ZCode keeps provider keys in its own
 * credential store; TNT's model keys live in `config.yaml`, so only the
 * shell-side keys (OAuth tokens for the cloud paths TNT does not use, and
 * plugin secrets) land here, in one 0600 JSON file under the global dir. A
 * missing key returns null; nothing is cached across processes.
 */
export function createWebUiCredentialService(
  filePath: string = path.join(globalDir(), WEBUI_CREDENTIALS_FILE),
): ICredentialService {
  const readAll = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          entries[key] = value;
        }
      }
      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn("webui credentials: unreadable store", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {};
    }
  };

  const writeAll = (entries: Record<string, string>): void => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, filePath);
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // A platform without chmod keeps the rename's inherited mode.
    }
  };

  return {
    async load(key: string): Promise<string | null> {
      if (!key) {
        return null;
      }
      return readAll()[key] ?? null;
    },
    async save(key: string, value: string): Promise<void> {
      if (!key.trim()) {
        throw new Error("credential key must not be empty");
      }
      writeAll({ ...readAll(), [key]: value });
    },
    async delete(key: string): Promise<void> {
      const entries = readAll();
      if (!(key in entries)) {
        return;
      }
      delete entries[key];
      writeAll(entries);
    },
  };
}
