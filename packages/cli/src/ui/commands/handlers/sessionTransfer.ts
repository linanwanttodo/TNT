import fs from "fs";

import { t } from "../../../i18n/index.js";

import type { Session } from "core/index.js";
import historyManager from "core/util/history.js";
import chalk from "chalk";
import { v4 as uuidv4 } from "uuid";

import type { SlashCommandResult } from "../types.js";

const EXPORTED_SESSION_VERSION = 1;

interface ExportedSession {
  version: number;
  exportedAt: string;
  session: Session;
}

function isValidExportedSession(data: unknown): data is ExportedSession {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    obj.version === EXPORTED_SESSION_VERSION &&
    typeof obj.exportedAt === "string" &&
    typeof obj.session === "object" &&
    obj.session !== null &&
    typeof (obj.session as Record<string, unknown>).sessionId === "string" &&
    typeof (obj.session as Record<string, unknown>).title === "string" &&
    Array.isArray((obj.session as Record<string, unknown>).history)
  );
}

export function handleExport(_args: string[]): SlashCommandResult {
  return {
    exit: false,
    openExportSelector: true,
  };
}

export function handleImport(args: string[]): SlashCommandResult {
  const filePath = args.join(" ").trim();
  if (!filePath) {
    return {
      exit: false,
      output: chalk.yellow(
        "Please provide a file path. Usage: /import <file-path>",
      ),
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      exit: false,
      output: chalk.red(t("session.fileNotFound", { path: filePath })),
    };
  }

  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const exportedData: unknown = JSON.parse(fileContent);

    if (!isValidExportedSession(exportedData)) {
      return {
        exit: false,
        output: chalk.red(t("session.invalidFile")),
      };
    }

    let session = exportedData.session;

    const existing = historyManager.load(session.sessionId);
    const sessionExists = existing.history.length > 0;

    if (sessionExists) {
      const originalId = session.sessionId;
      session = {
        ...session,
        sessionId: uuidv4(),
      };
      historyManager.save(session);
      return {
        exit: false,
        output: chalk.green(
          `Session imported with new ID: ${session.sessionId}\n` +
            chalk.gray(`(original ID: ${originalId} already existed)`),
        ),
      };
    }

    historyManager.save(session);
    return {
      exit: false,
      output: chalk.green(
        `Session imported: ${session.sessionId} (${session.title})`,
      ),
    };
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(`Failed to import session: ${error.message}`),
    };
  }
}
