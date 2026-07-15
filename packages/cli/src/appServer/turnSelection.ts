import type { ModelSelection } from "@zcode/shared";
import type { Session } from "core/index.js";

import {
  listChatModels,
  switchChatModel,
  type ChatModelOption,
} from "../services/modelCatalog.js";
import { setSessionChatModel } from "../session/index.js";
import {
  parseReasoningDepth,
  restoreReasoningOverride,
  setReasoningOverride,
  type ReasoningDepth,
} from "../session/reasoningOverride.js";

import { sessionRequestError } from "./session.js";

/** The per-turn selection an app-server send can carry. */
export interface TurnSelection {
  modelSelection?: ModelSelection;
  thoughtLevel?: string;
}

export interface TurnSelectionDeps {
  listModels(): ChatModelOption[];
  switchModel(index: number): Promise<void>;
  setSessionModel(session: Session, selection: ModelSelection): void;
  setReasoning(depth: ReasoningDepth | null): void;
}

const defaultDeps: TurnSelectionDeps = {
  listModels: () => listChatModels(),
  switchModel: async (index) => {
    await switchChatModel(index);
  },
  setSessionModel: (session, selection) =>
    setSessionChatModel(
      session,
      `${selection.providerId}/${selection.modelId}`,
    ),
  setReasoning: setReasoningOverride,
};

function requestedLevel(turn: TurnSelection): string | undefined {
  const level =
    turn.modelSelection?.options?.reasoningLevel ?? turn.thoughtLevel;
  const trimmed = level?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Applies a turn's model and reasoning selection before the run starts.
 *
 * The model switch goes through the same `switchChatModel` recipe the TUI
 * picker and ACP worker use, and the session records the same
 * `chatModelTitle` the app-server's `session/setModel` writes, so there is one
 * model state rather than a per-turn copy. TNT's reasoning override is
 * process-wide by design - the same store `/think` uses - so a depth set by
 * one turn is visible to later turns until another selection replaces it.
 */
export async function applyTurnSelection(
  session: Session,
  turn: TurnSelection,
  deps: TurnSelectionDeps = defaultDeps,
): Promise<void> {
  const level = requestedLevel(turn);
  const depth = level === undefined ? undefined : parseReasoningDepth(level);
  if (level !== undefined && depth === undefined) {
    throw sessionRequestError(`Unknown reasoning level: ${level}`);
  }

  let model: ModelSelection | undefined;
  let target: ChatModelOption | undefined;
  const selection = turn.modelSelection;
  if (selection) {
    target = deps
      .listModels()
      .find(
        (entry) =>
          entry.provider === selection.providerId &&
          entry.name === selection.modelId,
      );
    if (!target) {
      throw sessionRequestError(
        `Unknown model: ${selection.providerId}/${selection.modelId}`,
      );
    }
    model = selection;
  }

  // Validate everything before changing process or session state, so a bad
  // selection cannot leave the turn on a half-applied model.
  if (target && !target.current) {
    await deps.switchModel(target.index);
  }
  if (model) {
    deps.setSessionModel(session, model);
  }
  if (depth !== undefined) {
    // The persisted /think choice is restored lazily on the first streaming
    // request; restore first so it cannot overwrite this turn's pin.
    restoreReasoningOverride();
    deps.setReasoning(depth);
  }
}
