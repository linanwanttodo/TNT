import path from "path";

import { workspaceRoot as currentWorkspaceRoot } from "../utils/workspaceScope.js";

/**
 * Formats a single tool argument for display
 * @param value The argument value
 * @returns A formatted string representation of the value
 */
export function formatToolArgument(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  // Convert absolute paths to relative paths
  if (typeof value === "string" && path.isAbsolute(value)) {
    const workspaceRoot = currentWorkspaceRoot();
    const relativePath = path.relative(workspaceRoot, value);
    // Normalize path separators to forward slashes for cross-platform consistency
    return (relativePath || value).replace(/\\/g, "/");
  }

  // Return other values as strings
  return String(value);
}
