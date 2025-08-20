import { ToolPermissionPolicy } from "./types.js";

/**
 * Default permission policies for all built-in tools.
 * These policies are applied in order - first match wins.
 */
export function getDefaultToolPolicies(
  isHeadless = false,
): ToolPermissionPolicy[] {
  const policies: ToolPermissionPolicy[] = [
    // Write tools
    { tool: "Edit", permission: "ask" },
    { tool: "MultiEdit", permission: "ask" },
    { tool: "Write", permission: "ask" },
    { tool: "CheckBackgroundJob", permission: "allow" },
    { tool: "AskQuestion", permission: "allow" },
    { tool: "Checklist", permission: "allow" },
    { tool: "Diff", permission: "allow" },
    { tool: "Skills", permission: "allow" },
    { tool: "Exit", permission: "allow" }, // Exit tool is generally safe (headless mode only)
    { tool: "Fetch", permission: "allow" }, // Technically not read only but edge casey to post w query params
    { tool: "List", permission: "allow" },
    { tool: "Read", permission: "allow" },
    { tool: "Search", permission: "allow" },
    { tool: "Completion", permission: "allow" },
    { tool: "Diagnostics", permission: "allow" },
    { tool: "Subagent", permission: "allow" },
    { tool: "FindSymbol", permission: "allow" },
    { tool: "Hover", permission: "allow" },
    { tool: "Status", permission: "allow" },
    { tool: "Todo", permission: "allow" },
    { tool: "ReportFailure", permission: "allow" },
    { tool: "UploadArtifact", permission: "allow" },
  ];

  // MCP and Bash are ask in TUI mode, auto in headless
  if (isHeadless) {
    policies.push({ tool: "Bash", permission: "allow" });
    policies.push({ tool: "*", permission: "allow" });
  } else {
    policies.push({ tool: "Bash", permission: "ask" });
    policies.push({ tool: "*", permission: "ask" });
  }

  return policies;
}

// Plan mode: writes are allowed for documentation only, reads stay open, and
// shell commands must be provably non-writing. The path decides whether a
// write call is safe, so the write tools stay listed and the check runs at
// execution time.
export const PLAN_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "Edit", permission: "allow", docsOnly: true },
  { tool: "MultiEdit", permission: "allow", docsOnly: true },
  { tool: "Write", permission: "allow", docsOnly: true },

  // Plan mode promises the project is not modified, so shell commands are
  // allowed only while they cannot write. A command the classifier does not
  // recognize is refused rather than sent.
  { tool: "Bash", permission: "allow", readOnlyOnly: true },
  { tool: "CheckBackgroundJob", permission: "allow" },
  { tool: "AskQuestion", permission: "allow" },
  { tool: "Checklist", permission: "allow" },
  { tool: "Diff", permission: "allow" },
  { tool: "Exit", permission: "allow" },
  { tool: "Fetch", permission: "allow" },
  { tool: "Completion", permission: "allow" },
  { tool: "Diagnostics", permission: "allow" },
  { tool: "FindSymbol", permission: "allow" },
  { tool: "Hover", permission: "allow" },
  { tool: "List", permission: "allow" },
  { tool: "Read", permission: "allow" },
  { tool: "ReportFailure", permission: "allow" },
  { tool: "Search", permission: "allow" },
  { tool: "Skills", permission: "allow" },
  { tool: "Subagent", permission: "allow" },
  { tool: "Status", permission: "allow" },
  { tool: "Todo", permission: "allow" },
  { tool: "UploadArtifact", permission: "allow" },

  // Allow MCP tools
  { tool: "*", permission: "allow" },
];

// Auto mode: Complete override - allow everything without asking
export const AUTO_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "*", permission: "allow" },
];
