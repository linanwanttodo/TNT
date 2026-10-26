import { t } from "../i18n/index.js";
import { SERVICE_NAMES, serviceContainer } from "../services/index.js";
import type { MCPServiceState, ModelServiceState } from "../services/types.js";

import { ALL_BUILT_IN_TOOLS } from "./allBuiltIns.js";
import { applyPatchTool } from "./applyPatch.js";
import { askQuestionTool } from "./askQuestion.js";
import { browserTool } from "./browser.js";
import { callHierarchyTool } from "./callHierarchy.js";
import { checkBackgroundJobTool } from "./checkBackgroundJob.js";
import { codebaseSearchTool } from "./codebaseSearch.js";
import { completionTool } from "./completion.js";
import { computerTool } from "./computer.js";
import { deleteFileTool } from "./deleteFile.js";
import { diagnosticsTool } from "./diagnostics.js";
import { documentSymbolTool } from "./documentSymbol.js";
import { editTool } from "./edit.js";
import { exitTool } from "./exit.js";
import { fetchTool } from "./fetch.js";
import { findSymbolTool } from "./findSymbol.js";
import { globFilesTool } from "./globFiles.js";
import { hoverTool } from "./hover.js";
import { importGraphTool } from "./importGraph.js";
import { listFilesTool } from "./listFiles.js";
import { mcpToolsFromConnections } from "./mcp.js";
import { multiEditTool } from "./multiEdit.js";
import { notebookEditTool } from "./notebookEdit.js";
import { enterPlanModeTool, exitPlanModeTool } from "./planMode.js";
import { readFileTool } from "./readFile.js";
import { referencesTool } from "./references.js";
import { reportFailureTool } from "./reportFailure.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { checkIfRipgrepIsInstalled, searchCodeTool } from "./searchCode.js";
import { toolSearchTool } from "./selection/search.js";
import { skillsTool } from "./skills.js";
import { sortToolsByName } from "./stableOrder.js";
import { statusTool } from "./status.js";
import { listSubagentsTool, subagentTool } from "./subagent.js";
import { todoTool } from "./todo.js";
import {
  isBetaSubagentToolEnabled,
  isBetaUploadArtifactToolEnabled,
} from "./toolsConfig.js";
import type { Tool } from "./types.js";
import { uploadArtifactTool } from "./uploadArtifact.js";
import { viewDiffTool } from "./viewDiff.js";
import { webSearchTool } from "./webSearch.js";
import { writeChecklistTool } from "./writeChecklist.js";
import { writeFileTool } from "./writeFile.js";

/**
 * The tools this package ships, and how the optional ones are gated.
 *
 * This module owns composition only: which implementations exist, what each
 * capability check adds, and the stable order the request is billed in. What a
 * request actually advertises is `selection/`, and how a tool is executed is
 * `index.tsx`. Keeping the three apart is what lets a session add a tool
 * without touching the request policy or the executor.
 */

/**
 * Extract the agent ID from the --id command line flag
 */
function getAgentIdFromArgs(): string | undefined {
  const args = process.argv;
  const idIndex = args.indexOf("--id");
  if (idIndex !== -1 && idIndex + 1 < args.length) {
    return args[idIndex + 1];
  }
  return undefined;
}

// Base tools that are always available
const BASE_BUILTIN_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  deleteFileTool,
  notebookEditTool,
  listFilesTool,
  runTerminalCommandTool,
  fetchTool,
  writeChecklistTool,
  checkBackgroundJobTool,
  askQuestionTool,
  browserTool,
  computerTool,
  enterPlanModeTool,
  exitPlanModeTool,
  webSearchTool,
];

const BUILTIN_SEARCH_TOOLS: Tool[] = [searchCodeTool, globFilesTool];

/**
 * Tools that need nothing outside the workspace to answer. The language-server
 * tools are in this list even though most projects have no server: each one
 * returns the message that says a plugin must declare one, which tells the
 * model more than an invisible tool does, and the permission policies already
 * assume they exist. A tool that has a policy but is never offered is a dead
 * rule, and a project that wants it gone can deny it through the policies.
 */
const WORKSPACE_TOOLS: Tool[] = [
  todoTool,
  viewDiffTool,
  codebaseSearchTool,
  diagnosticsTool,
  documentSymbolTool,
  findSymbolTool,
  hoverTool,
  completionTool,
  referencesTool,
  callHierarchyTool,
  importGraphTool,
];

// Get all builtin tools including dynamic ones, with capability-based filtering
export async function getAllAvailableTools(
  isHeadless: boolean,
  /**
   * Whether this run may delegate again. A run that has reached its depth
   * limit does not receive the delegation tool at all: an absent tool costs
   * no schema tokens and gives the model nothing to attempt, which is a
   * stronger guard than refusing a call it can already see.
   */
  canDelegate: boolean = true,
): Promise<Tool[]> {
  const tools = [...BASE_BUILTIN_TOOLS, ...WORKSPACE_TOOLS];

  const isRipgrepInstalled = await checkIfRipgrepIsInstalled();
  if (isRipgrepInstalled) {
    tools.push(...BUILTIN_SEARCH_TOOLS);
  }

  // Add agent-specific tools if agent ID is present
  // (these require --id to function and will confuse the agent if unavailable)
  const agentId = getAgentIdFromArgs();
  if (agentId) {
    tools.push(reportFailureTool, statusTool);

    // UploadArtifact tool is gated behind beta flag
    if (isBetaUploadArtifactToolEnabled()) {
      tools.push(uploadArtifactTool);
    }
  }

  const modelState = await serviceContainer.get<ModelServiceState>(
    SERVICE_NAMES.MODEL,
  );
  if (!modelState.model) {
    throw new Error(t("tools.modelServiceUninitialized"));
  }

  // Both edit tools are offered. Which one a model handles well cannot be
  // told from its name, and a project that wants only one can exclude the
  // other through the permission policies.
  tools.push(editTool, multiEditTool, applyPatchTool);

  if (isHeadless) {
    tools.push(exitTool);
  }

  if (isBetaSubagentToolEnabled() && canDelegate) {
    tools.push(await subagentTool());
    tools.push(await listSubagentsTool());
  }

  tools.push(await skillsTool());

  const mcpState = await serviceContainer.get<MCPServiceState>(
    SERVICE_NAMES.MCP,
  );
  tools.push(...mcpToolsFromConnections(mcpState.connections));

  // Offered so a hidden MCP tool stays discoverable; the request builder drops
  // it again when no MCP schemas are being deferred.
  tools.push(toolSearchTool);

  // Registration order depends on which optional tools are present and on the
  // order a provider happens to return MCP tools in. Tool definitions are part
  // of the cached prompt prefix, so the order has to be a pure function of the
  // names rather than of how the list was assembled.
  return sortToolsByName(tools);
}

/**
 * A tool's own `displayName` is the label the UI is meant to show, and the
 * registry copy does not cover every tool this module offers: the plan-mode,
 * glob and background-job tools are declared here with their arrays. Search the
 * composed surface first, then the registry copy, then fall back to the name -
 * in that order, so a declared label is never silently discarded.
 */
export function getToolDisplayName(toolName: string): string {
  const tool = (
    [
      ...BASE_BUILTIN_TOOLS,
      ...BUILTIN_SEARCH_TOOLS,
      ...WORKSPACE_TOOLS,
    ] as Tool[]
  )
    .concat(ALL_BUILT_IN_TOOLS)
    .find((t) => t.name === toolName);
  return tool?.displayName || toolName;
}
