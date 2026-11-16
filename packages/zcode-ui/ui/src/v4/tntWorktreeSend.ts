import { randomUUID } from "node:crypto";

import type { CommandAck } from "@zcode/shared/zcode-protocol-v4";
import {
  commandPayloadSchemas,
  V4_METHODS,
} from "@zcode/shared/zcode-protocol-v4";
import type { IZCodeAgentService } from "@zcode/services";
import { logger } from "@/logger.js";

import { readTntDraftWorktreeState } from "@/tnt-worktree/draftWorktreeStore.js";

/**
 * The worktree-mode first send (docs/git/worktree.md §3.3, TNT mapping).
 *
 * The prewarmed draft lives in the project workspace, so a worktree send
 * cannot reuse it: the session has to be born inside the worktree, which in
 * TNT means a createSession command whose workspace is the worktree path - the
 * engine registry materialises that workspace on demand and the agent's cwd
 * is the worktree. The first message rides the same command as `firstInput`,
 * so admission and the turn start stay one atomic step.
 */
export function isTntWorktreeDraftEnabled(workspaceKey: string): boolean {
  return readTntDraftWorktreeState(workspaceKey).enabled;
}

export async function sendDraftIntoManagedWorktree(input: {
  agentService: Pick<
    IZCodeAgentService,
    "createManagedWorktree" | "sendConversationCommandV4"
  >;
  workspacePath: string;
  workspaceIdentity?: string;
  text: string;
  modelSelection?: unknown;
  onSessionOpened: (worktreePath: string, sessionId: string) => void;
}): Promise<void> {
  const { agentService, workspacePath, workspaceIdentity, text } = input;
  const draft = readTntDraftWorktreeState(workspacePath);

  const worktree = await agentService.createManagedWorktree({
    workspacePath,
    workspaceIdentity,
    ...(draft.ref ? { ref: draft.ref } : {}),
  });

  const payload = commandPayloadSchemas.createSession.parse({
    workspaceId: worktree.worktreePath,
    firstInput: {
      text,
      ...(input.modelSelection
        ? { modelSelection: input.modelSelection }
        : {}),
    },
  });
  const ack = (await agentService.sendConversationCommandV4({
    workspacePath: worktree.worktreePath,
    envelope: {
      commandId: randomUUID(),
      clientId: "tnt-worktree-draft",
      sessionId: null,
      type: "createSession",
      issuedAt: Date.now(),
      payload,
    },
  })) as CommandAck;
  if (ack.status !== "accepted" || ack.result?.type !== "createSession") {
    throw new Error(
      ack.message ?? ack.reasonCode ?? "worktree session was rejected",
    );
  }
  const sessionId = ack.result.sessionId;
  logger.info("[tnt-worktree] draft sent into managed worktree", {
    worktreePath: worktree.worktreePath,
    sessionId,
    ref: draft.ref ?? "HEAD",
  });
  input.onSessionOpened(worktree.worktreePath, sessionId);
}
