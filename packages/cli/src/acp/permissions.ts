import * as acp from "@agentclientprotocol/sdk";

import { toolPermissionManager } from "../permissions/permissionManager.js";
import { rememberSessionApproval } from "../permissions/sessionApprovals.js";

import { toolKind, toolTitle } from "./updates.js";

export const PERMISSION_OPTIONS: acp.PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  {
    optionId: "allow_always",
    name: "Allow for this session",
    kind: "allow_always",
  },
  { optionId: "reject_once", name: "Reject", kind: "reject_once" },
];

export interface ToolPermissionRequest {
  client: acp.AgentContext;
  sessionId: string;
  toolName: string;
  toolArgs: unknown;
  requestId: string;
  toolCallId?: string;
  signal: AbortSignal;
}

/**
 * The engine's permission wait is a promise owned by toolPermissionManager.
 * ACP answers it asynchronously, so this bridge must never await the turn
 * here: it sends the request, then resolves the manager when the client
 * answers, the same way the TUI does.
 */
export function requestToolPermission(request: ToolPermissionRequest): void {
  void (async () => {
    try {
      const response = await request.client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId: request.sessionId,
          toolCall: {
            toolCallId: request.toolCallId ?? request.requestId,
            title: toolTitle(request.toolName, request.toolArgs),
            name: request.toolName,
            kind: toolKind(request.toolName),
            status: "pending",
            rawInput: request.toolArgs,
          },
          options: PERMISSION_OPTIONS,
        },
        { cancellationSignal: request.signal },
      );

      const optionId =
        response.outcome.outcome === "selected"
          ? response.outcome.optionId
          : undefined;

      if (optionId === "allow_always") {
        rememberSessionApproval(request.toolName, request.toolArgs);
        toolPermissionManager.approveRequest(request.requestId, true);
        return;
      }
      if (optionId === "allow_once") {
        toolPermissionManager.approveRequest(request.requestId);
        return;
      }
      toolPermissionManager.rejectRequest(request.requestId);
    } catch {
      // A cancelled request is a refusal, never a quiet approval.
      toolPermissionManager.rejectRequest(request.requestId);
    }
  })();
}
