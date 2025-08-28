import { t } from "../../../i18n/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * Builds or reports on the codebase index.
 *
 * The retrieval service is imported lazily: a command that never touches the
 * index should not load the sqlite store and the chunker with it. A build
 * runs in the background - waiting on the command made a large workspace look
 * frozen - and `/index status` reports the indexer's own progress, then the
 * result.
 */
export async function handleIndex(
  args: string[] = [],
): Promise<SlashCommandResult> {
  const subcommand = (args[0] ?? "").toLowerCase();
  if (subcommand && subcommand !== "status") {
    return { output: t("index.usage") };
  }

  const { getRetrievalService } = await import("../../../retrieval/service.js");
  const service = getRetrievalService();

  if (subcommand !== "status") {
    service.startIndexing();
    return { output: t("index.started") };
  }

  const progress = service.indexingProgress();
  if (service.isIndexing()) {
    return {
      output: t("index.progress", {
        percent: Math.round(progress.progress * 100),
        desc: progress.desc,
      }),
    };
  }
  if (progress.status === "failed") {
    return { output: t("index.failed", { message: progress.desc }) };
  }
  if (!(await service.hasIndex())) {
    // A build that ran and left nothing behind means the config has no
    // codebase provider; one that never ran means the user should start it.
    return {
      output: t(
        progress.status === "done" ? "index.disabled" : "index.statusMissing",
      ),
    };
  }
  // An index exists; whether the config also selects an embeddings model
  // decides if it is full-text only or answers semantic searches too.
  return {
    output: t(
      (await service.hasEmbeddingsModel())
        ? "index.statusBuilt"
        : "index.statusFullTextOnly",
    ),
  };
}
