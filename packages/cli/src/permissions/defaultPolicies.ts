import { ToolPermissionPolicy } from "./types.js";

/**
 * Default permission policies for all built-in tools.
 * These policies are applied in order - first match wins.
 */
export function getDefaultToolPolicies(): ToolPermissionPolicy[] {
  // A headless run cannot answer an "ask", and the request builder drops ask
  // tools in that mode, so this table is the default-deny baseline for both
  // runs. A headless caller opts a tool back in with --allow (or --allow "*").
  const writePermission = "ask";
  const policies: ToolPermissionPolicy[] = [
    // Write tools
    { tool: "Edit", permission: writePermission, workspaceOnly: true },
    { tool: "MultiEdit", permission: writePermission, workspaceOnly: true },
    { tool: "Write", permission: writePermission, workspaceOnly: true },
    { tool: "ApplyPatch", permission: writePermission, workspaceOnly: true },
    { tool: "CheckBackgroundJob", permission: "allow" },
    { tool: "AskQuestion", permission: "allow" },
    { tool: "EnterPlanMode", permission: "allow" },
    { tool: "ExitPlanMode", permission: "ask" },
    { tool: "Checklist", permission: "allow" },
    { tool: "Diff", permission: "allow" },
    { tool: "Skills", permission: "allow" },
    { tool: "Exit", permission: "allow" }, // Exit tool is generally safe (headless mode only)
    { tool: "Fetch", permission: "allow" }, // Technically not read only but edge casey to post w query params
    { tool: "List", permission: "allow" },
    { tool: "Read", permission: "allow" },
    { tool: "Search", permission: "allow" },
    { tool: "Glob", permission: "allow" },
    { tool: "CodebaseSearch", permission: "allow" },
    { tool: "Completion", permission: "allow" },
    { tool: "Diagnostics", permission: "allow" },
    { tool: "Subagent", permission: "allow" },
    { tool: "ListSubagents", permission: "allow" },
    { tool: "FindSymbol", permission: "allow" },
    { tool: "Hover", permission: "allow" },
    { tool: "Status", permission: "allow" },
    { tool: "Todo", permission: "allow" },
    { tool: "ToolSearch", permission: "allow" },
    { tool: "ReportFailure", permission: "allow" },
    { tool: "UploadArtifact", permission: "allow" },
  ];

  policies.push({ tool: "Bash", permission: "ask", readOnlyAllow: true });
  policies.push({ tool: "*", permission: "ask" });

  return policies;
}

// dontAsk: the default table with every ask turned into an exclude, so a tool
// that would prompt is simply unavailable. Used by headless and serve runs.
export const DONT_ASK_MODE_POLICIES: ToolPermissionPolicy[] =
  getDefaultToolPolicies().map((policy) =>
    policy.permission === "ask" ? { ...policy, permission: "exclude" } : policy,
  );

// Plan mode: the four write tools are disabled outright, reads stay open, and
// shell commands must be provably non-writing. MCP and plugin tools fall
// through to an ask: the TUI asks, and a headless run drops the tool and
// refuses a call that reaches approval.
export const PLAN_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "Edit", permission: "exclude" },
  { tool: "MultiEdit", permission: "exclude" },
  { tool: "Write", permission: "exclude" },
  { tool: "ApplyPatch", permission: "exclude" },

  // Plan mode promises the project is not modified, so shell commands are
  // allowed only while they cannot write. A command the classifier does not
  // recognize is refused rather than sent.
  { tool: "Bash", permission: "allow", readOnlyOnly: true },
  { tool: "CheckBackgroundJob", permission: "allow" },
  { tool: "AskQuestion", permission: "allow" },
  // Entering plan mode only narrows what may happen, so it needs no prompt;
  // leaving it is what allows changes again, and that one is asked for.
  { tool: "EnterPlanMode", permission: "allow" },
  { tool: "ExitPlanMode", permission: "ask" },
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
  { tool: "Glob", permission: "allow" },
  { tool: "CodebaseSearch", permission: "allow" },
  { tool: "Skills", permission: "allow" },
  { tool: "Subagent", permission: "allow" },
  { tool: "ListSubagents", permission: "allow" },
  { tool: "Status", permission: "allow" },
  { tool: "Todo", permission: "allow" },
  { tool: "ToolSearch", permission: "allow" },
  { tool: "UploadArtifact", permission: "allow" },

  // MCP and plugin tools ask; headless refuses them.
  { tool: "*", permission: "ask" },
];

// acceptEdits: the default table with the four write tools allowed inside the
// workspace. Bash keeps the default read-only-allowed / otherwise-ask rule.
export const ACCEPT_EDITS_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "Edit", permission: "allow", workspaceOnly: true },
  { tool: "MultiEdit", permission: "allow", workspaceOnly: true },
  { tool: "Write", permission: "allow", workspaceOnly: true },
  { tool: "ApplyPatch", permission: "allow", workspaceOnly: true },
  { tool: "CheckBackgroundJob", permission: "allow" },
  { tool: "AskQuestion", permission: "allow" },
  { tool: "EnterPlanMode", permission: "allow" },
  { tool: "ExitPlanMode", permission: "ask" },
  { tool: "Checklist", permission: "allow" },
  { tool: "Diff", permission: "allow" },
  { tool: "Skills", permission: "allow" },
  { tool: "Exit", permission: "allow" },
  { tool: "Fetch", permission: "allow" },
  { tool: "List", permission: "allow" },
  { tool: "Read", permission: "allow" },
  { tool: "Search", permission: "allow" },
  { tool: "Glob", permission: "allow" },
  { tool: "CodebaseSearch", permission: "allow" },
  { tool: "Completion", permission: "allow" },
  { tool: "Diagnostics", permission: "allow" },
  { tool: "Subagent", permission: "allow" },
  { tool: "ListSubagents", permission: "allow" },
  { tool: "FindSymbol", permission: "allow" },
  { tool: "Hover", permission: "allow" },
  { tool: "Status", permission: "allow" },
  { tool: "Todo", permission: "allow" },
  { tool: "ToolSearch", permission: "allow" },
  { tool: "ReportFailure", permission: "allow" },
  { tool: "UploadArtifact", permission: "allow" },
  { tool: "Bash", permission: "ask", readOnlyAllow: true },
  { tool: "*", permission: "ask" },
];

// Bypass permissions: complete override. Entry is gated at flag validation, so
// this table is only reachable through an explicit --dangerously-skip-permissions
// (or the legacy --auto alias).
export const BYPASS_PERMISSIONS_POLICIES: ToolPermissionPolicy[] = [
  { tool: "*", permission: "allow", allowUnsafeCalls: true },
];
