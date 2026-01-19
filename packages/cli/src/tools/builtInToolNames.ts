/**
 * Static list of built-in tool names.
 * Kept separate from allBuiltIns.ts to avoid circular dependency:
 * ToolPermissionService -> allBuiltIns -> runTerminalCommand -> services/index -> ToolPermissionService
 *
 * When adding a new built-in tool, update both this list and ALL_BUILT_IN_TOOLS in allBuiltIns.ts.
 */
export const BUILT_IN_TOOL_NAMES = [
  "ApplyPatch",
  "AskQuestion",
  "Browser",
  "Completion",
  "Computer",
  "Delete",
  "Diagnostics",
  "Edit",
  "Exit",
  "Fetch",
  "FindSymbol",
  "Hover",
  "List",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "ReportFailure",
  "Bash",
  "Search",
  "CodebaseSearch",
  "Status",
  "Todo",
  "ToolSearch",
  "Subagent",
  "ListSubagents",
  "Skills",
  "UploadArtifact",
  "Diff",
  "Checklist",
  "Write",
  "WebSearch",
  // The four the request assembles from `src/tools/index.tsx`; they were outside
  // this sweep until 2026-10-20, which left them ungoverned by default-deny.
  "CheckBackgroundJob",
  "EnterPlanMode",
  "ExitPlanMode",
  "Glob",
] as const;
