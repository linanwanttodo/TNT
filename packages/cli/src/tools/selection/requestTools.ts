import { checkToolPermission } from "../../permissions/permissionChecker.js";
import type { ToolPermissions } from "../../permissions/types.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../../services/index.js";
import type { ToolPermissionServiceState } from "../../services/ToolPermissionService.js";
import type { ModelServiceState } from "../../services/types.js";
import { getModelContextLimit } from "../../utils/tokenizer.js";
import {
  convertToolToChatCompletionTool,
  getAllAvailableTools,
  Tool,
} from "../index.js";

import {
  buildDeferredCatalog,
  deferredForRequest,
  selectRequestTools,
  TOOL_SEARCH_NAME,
} from "./deferral.js";

/**
 * The tools one request should advertise: availability first, then the policy
 * table, then the deferral decision. Kept beside the deferral policy rather
 * than in the stream engine, because "what the model is offered" is a tool-layer
 * question and the engine should only have to ask for the answer.
 */
export async function getRequestTools(
  isHeadless: boolean,
  /**
   * Permissions to evaluate against. Left unset, the process-wide policy is
   * used, which is what a top-level turn wants.
   */
  permissions?: ToolPermissions,
  /**
   * Whether this run may delegate again. A run at its depth limit does not see
   * the delegation tool at all.
   */
  canDelegate: boolean = true,
) {
  const availableTools = await getAllAvailableTools(isHeadless, canDelegate);

  const permissionsState =
    permissions ??
    (
      await serviceContainer.get<ToolPermissionServiceState>(
        SERVICE_NAMES.TOOL_PERMISSIONS,
      )
    ).permissions;

  const allowedTools: Tool[] = [];
  // In auto mode the classifier answers the asks, so a headless run must still
  // see those tools; without this the model has nothing to call.
  const autoModeActive = services.toolPermissions.getCurrentMode() === "auto";
  for (const tool of availableTools) {
    const result = checkToolPermission(
      { name: tool.name, arguments: {} },
      permissionsState,
    );

    if (
      result.permission === "allow" ||
      (result.permission === "ask" && (!isHeadless || autoModeActive))
    ) {
      allowedTools.push(tool);
    }
  }

  let contextWindow: number | undefined;
  try {
    const modelState = await serviceContainer.get<ModelServiceState>(
      SERVICE_NAMES.MODEL,
    );
    // The model-level configLength must win here too: reading only
    // defaultCompletionOptions silently ignores a configured 1M window and
    // defers tools against the 200k default.
    if (modelState.model) {
      contextWindow = getModelContextLimit(modelState.model);
    }
  } catch {
    // Without a resolved model the decision falls back to the default window;
    // the environment override still decides either way.
  }

  const deferralOptions = { contextWindow };
  const selected = selectRequestTools(allowedTools, deferralOptions);
  const deferred = deferredForRequest(allowedTools, deferralOptions);
  const catalog = deferred.length > 0 ? buildDeferredCatalog(deferred) : "";

  return selected
    .map((tool) =>
      tool.name === TOOL_SEARCH_NAME && catalog
        ? {
            ...tool,
            description: `${tool.description}\n\nDeferred tools (schemas withheld; search for them or pass select:<name>):\n${catalog}`,
          }
        : tool,
    )
    .map(convertToolToChatCompletionTool);
}
