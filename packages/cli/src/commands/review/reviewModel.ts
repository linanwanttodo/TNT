import { ModelService } from "../../services/ModelService.js";
import type { ModelServiceState } from "../../services/types.js";
import { logger } from "../../utils/logger.js";

/**
 * A model state that has already been shown to carry a model and an api. The
 * review runs on it, and the check belongs to the caller that can report the
 * failure rather than to whoever picks the model.
 */
export type ReadyModelState = ModelServiceState & {
  model: NonNullable<ModelServiceState["model"]>;
  llmApi: NonNullable<ModelServiceState["llmApi"]>;
};

function isReady(state: ModelServiceState | null): state is ReadyModelState {
  return Boolean(state?.model && state?.llmApi);
}

/**
 * Which model a review runs on.
 *
 * A review is the same diff read by several agents, so it is the one place where
 * a cheaper model is worth real money: the session model may be the expensive
 * reasoning model the user is chatting with, while the review only needs to read
 * a patch. Asking for a name the configuration does not have must not end the
 * review - it runs on the session model and the log names what missed, because
 * a run that quietly changed price is otherwise invisible.
 */
export async function resolveReviewModelState(
  session: ReadyModelState,
  requested: string | undefined,
): Promise<ReadyModelState> {
  if (!requested) return session;

  const named = ModelService.findModelByName(session, requested);
  if (isReady(named)) return named;

  logger.warn(
    `Review model "${requested}" not found; using the session model`,
    {
      requested,
    },
  );
  return session;
}
