import fs from "fs";
import path from "path";

import { getLspManager } from "../lsp/manager.js";

import { Tool } from "./types.js";

const SEVERITY_NAMES = ["error", "warning", "info", "hint"];

/**
 * Lets the model check its own edit against a plugin's language server instead
 * of guessing whether the change is sound. The result is written for the model,
 * not for the terminal, so it stays plain text.
 */
export const diagnosticsTool: Tool = {
  name: "Diagnostics",
  displayName: "Diagnostics",
  description: `Run the project's language servers over one file and return their diagnostics.
Use it after changing code to see errors and warnings before reporting the work as done.
Returns nothing useful when the project has no language server configured.`,
  parameters: {
    type: "object",
    required: ["file_path"],
    properties: {
      file_path: {
        type: "string",
        description:
          "Path to the file to check, absolute or relative to the project",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  run: async ({ file_path }: { file_path: string }): Promise<string> => {
    if (typeof file_path !== "string" || !file_path.trim()) {
      return "Diagnostics needs a file_path argument.";
    }
    const absolute = path.resolve(file_path);
    if (!fs.existsSync(absolute)) {
      return `No such file: ${file_path}`;
    }

    const manager = getLspManager();
    const running = await manager.ensureStarted(process.cwd());
    if (running === 0) {
      return "No language server is configured. A plugin can declare one under lspServers in its manifest.";
    }

    const diagnostics = await manager.collectDiagnostics(absolute);
    if (diagnostics.length === 0) {
      return `No diagnostics for ${file_path}.`;
    }

    const lines = diagnostics.map((diagnostic) => {
      const start = (
        diagnostic.range as { start?: { line?: number; character?: number } }
      )?.start;
      const where =
        typeof start?.line === "number"
          ? `${start.line + 1}:${(start.character ?? 0) + 1}`
          : "?";
      const severity =
        SEVERITY_NAMES[(diagnostic.severity ?? 1) - 1] ?? "error";
      const source = diagnostic.source ? ` [${diagnostic.source}]` : "";
      return `${file_path}:${where} ${severity}${source}: ${diagnostic.message}`;
    });
    return `${diagnostics.length} diagnostic(s) for ${file_path}:\n${lines.join("\n")}`;
  },
};
