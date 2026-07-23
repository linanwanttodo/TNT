import { validateSingleEdit } from "core/edit/searchAndReplace/findAndReplaceUtils.js";
import { describeSearchFailure } from "core/edit/searchAndReplace/findSearchMatch.js";
import { validateMultiEdit } from "core/edit/searchAndReplace/multiEditValidation.js";
import {
  executeFindAndReplace,
  executeMultiFindAndReplace,
} from "core/edit/searchAndReplace/performReplace.js";
import { TntError, TntErrorReason } from "core/util/errors.js";

import { t } from "../i18n/index.js";

export interface RebaseEditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface SingleEditRecipe {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

export interface RebasePlan {
  currentContent: string;
  baseContent: string;
  plannedContent: string;
  recipe?: SingleEditRecipe;
  edits?: RebaseEditOperation[];
}

function unavailable(): TntError {
  return new TntError(
    TntErrorReason.EditToolFileNotRead,
    t("tools.editRebaseUnavailable"),
  );
}

function failed(
  error: unknown,
  currentContent: string,
  anchor: string,
): TntError {
  const reason =
    error instanceof TntError ? error.reason : TntErrorReason.FileWriteError;
  const detail = error instanceof Error ? error.message : String(error);
  return new TntError(
    reason,
    t("tools.editRebaseFailed", {
      reason: detail,
      context: describeSearchFailure(currentContent, anchor),
    }),
  );
}

export function rebaseSingleEdit(plan: RebasePlan): string {
  if (plan.currentContent === plan.baseContent) return plan.plannedContent;
  if (!plan.recipe) throw unavailable();
  try {
    const { oldString, newString, replaceAll } = validateSingleEdit(
      plan.recipe.oldString,
      plan.recipe.newString,
      plan.recipe.replaceAll,
    );
    return executeFindAndReplace(
      plan.currentContent,
      oldString,
      newString,
      replaceAll ?? false,
      0,
    );
  } catch (error) {
    throw failed(error, plan.currentContent, plan.recipe.oldString);
  }
}

export function rebaseMultiEdit(plan: RebasePlan): string {
  if (plan.currentContent === plan.baseContent) return plan.plannedContent;
  if (!plan.edits || plan.edits.length === 0) throw unavailable();
  try {
    const { edits } = validateMultiEdit({ edits: plan.edits });
    return executeMultiFindAndReplace(plan.currentContent, edits);
  } catch (error) {
    throw failed(error, plan.currentContent, plan.edits[0]?.old_string ?? "");
  }
}
