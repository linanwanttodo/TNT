import { checkToolPermission } from "../../permissions/permissionChecker.js";
import type { ToolPermissions } from "../../permissions/types.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../../services/index.js";
import type { ToolPermissionServiceState } from "../../services/ToolPermissionService.js";
import type { ModelServiceState } from "../../services/types.js";
import {
  convertToolToChatCompletionTool,
  getAllAvailableTools,
  Tool,
} from "../index.js";

import { selectRequestTools } from "./deferral.js";

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
    contextWindow = modelState.model?.defaultCompletionOptions?.contextLength;
  } catch {
    // Without a resolved model the decision falls back to the default window;
    // the environment override still decides either way.
  }

  return selectRequestTools(allowedTools, { contextWindow }).map(
    convertToolToChatCompletionTool,
  );
}
