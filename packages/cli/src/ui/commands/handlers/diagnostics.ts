import fs from "fs";
import path from "path";

import { t } from "../../../i18n/index.js";
import { getLspManager } from "../../../lsp/manager.js";
import type { SlashCommandResult } from "../types.js";

const SEVERITY_KEYS = [
  "diagnostics.severity.error",
  "diagnostics.severity.warning",
  "diagnostics.severity.info",
  "diagnostics.severity.hint",
] as const;

function severityLabel(severity: number | undefined): string {
  const index = (severity ?? 1) - 1;
  const key = SEVERITY_KEYS[index] ?? SEVERITY_KEYS[0];
  return t(key);
}

interface DiagnosticRange {
  start?: { line?: number; character?: number };
}

/**
 * Reports what a plugin's language server says about one file. Servers start on
 * demand, so the command names the case where no plugin declared one instead of
 * looking like a failure.
 */
export async function handleDiagnostics(
  args: string[] = [],
): Promise<SlashCommandResult> {
  const target = args.join(" ").trim();
  if (!target) {
    return { output: t("diagnostics.usage") };
  }
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) {
    return { output: t("diagnostics.missing", { path: target }) };
  }

  const manager = getLspManager();
  const running = await manager.ensureStarted(process.cwd());
  if (running === 0) {
    return { output: t("diagnostics.noServers") };
  }

  const diagnostics = await manager.collectDiagnostics(absolute);
  if (diagnostics.length === 0) {
    return { output: t("diagnostics.clean", { path: target }) };
  }

  const lines = [
    t("diagnostics.header", { count: diagnostics.length, path: target }),
  ];
  for (const diagnostic of diagnostics) {
    const range = diagnostic.range as DiagnosticRange | undefined;
    const start = range?.start;
    const where =
      typeof start?.line === "number"
        ? `:${start.line + 1}:${(start.character ?? 0) + 1}`
        : "";
    lines.push(
      `  ${severityLabel(diagnostic.severity)}${where} ${diagnostic.message}`,
    );
  }
  return { output: lines.join("\n") };
}
