import { IZCodeSessionService } from "@zcode/services";
import type {
  IZCodeAgentService,
  ZCodeSessionCreateParams,
  ZCodeSessionListParams,
  ZCodeSessionMessagesParams,
  ZCodeSessionReadParams,
  ZCodeSessionResumeParams,
  ZCodeSessionSetModelParams,
  ZCodeTaskTarget,
} from "@zcode/services";

import { stubServiceWith } from "./stubs.js";

/**
 * The app-facing session facade over the engine-backed agent service. It only
 * translates the session vocabulary; every session method maps to the agent
 * method the app-server actually implements. Methods the app-server does not
 * implement (workspace presentation, thought level, mode, session events) are
 * left to the stub fallback and reject `ZCODE_UNAVAILABLE`.
 */
export function createZcodeSessionService(
  agentService: IZCodeAgentService,
): IZCodeSessionService {
  const overrides: Partial<IZCodeSessionService> = {
    initializeWorkspace: (params) => agentService.initialize(params),
    getWorkspaceRuntimeIdentity: (params) =>
      agentService.getWorkspaceRuntimeIdentity(params),
    readWorkspacePresentation: (params) =>
      agentService.readWorkspacePresentation(params),
    createSession: (params: ZCodeSessionCreateParams) =>
      agentService.createSession({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.parentSessionId
          ? { parentSessionId: params.parentSessionId }
          : {}),
        ...(params.mode ? { mode: params.mode } : {}),
        ...(params.model ? { model: params.model } : {}),
        ...(params.persistence ? { persistence: params.persistence } : {}),
        ...(params.thoughtLevel ? { thoughtLevel: params.thoughtLevel } : {}),
        ...(params.mcpServers ? { mcpServers: params.mcpServers } : {}),
        ...(params.importedHistory
          ? { importedHistory: params.importedHistory }
          : {}),
      }),
    resumeSession: (params: ZCodeSessionResumeParams) =>
      agentService.resumeSession({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        ...(params.remoteSessionId
          ? { remoteSessionId: params.remoteSessionId }
          : {}),
        sessionId: params.sessionId,
        ...(params.model ? { model: params.model } : {}),
        ...(params.thoughtLevel ? { thoughtLevel: params.thoughtLevel } : {}),
        ...(params.mcpServers ? { mcpServers: params.mcpServers } : {}),
      }),
    listSessions: (params: ZCodeSessionListParams) =>
      agentService.listSessions({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        ...(params.remoteSessionId
          ? { remoteSessionId: params.remoteSessionId }
          : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      }),
    readSession: (params: ZCodeSessionReadParams) =>
      agentService.readSession({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        sessionId: params.sessionId,
        ...(params.deliveryKind ? { deliveryKind: params.deliveryKind } : {}),
        ...(params.messageLimit ? { messageLimit: params.messageLimit } : {}),
        ...(params.afterSeq === undefined ? {} : { afterSeq: params.afterSeq }),
      }),
    readSessionMessages: (params: ZCodeSessionMessagesParams) =>
      agentService.readSessionMessages({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        sessionId: params.sessionId,
        ...(params.afterMessageId
          ? { afterMessageId: params.afterMessageId }
          : {}),
        ...(params.limit ? { limit: params.limit } : {}),
      }),
    closeSession: async (params: ZCodeTaskTarget) => {
      await agentService.closeSession({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        sessionId: params.sessionId,
      });
    },
    setModel: (params: ZCodeSessionSetModelParams) =>
      agentService.setModel({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity
          ? { workspaceIdentity: params.workspaceIdentity }
          : {}),
        sessionId: params.sessionId,
        model: params.model,
        ...(params.expectedRevision === undefined
          ? {}
          : { expectedRevision: params.expectedRevision }),
        ...(params.persistAsWorkspaceLastUsed === undefined
          ? {}
          : {
              persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed,
            }),
      }),
  };
  return stubServiceWith<IZCodeSessionService>(
    IZCodeSessionService.channelName,
    overrides,
  );
}
