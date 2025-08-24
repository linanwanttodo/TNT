import { t } from "../../../i18n/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * Builds or reports on the codebase index.
 *
 * The retrieval service is imported lazily: a command that never touches the
 * index should not load the sqlite store and the chunker with it. The rebuild
 * is awaited, so the reported result is real - a large workspace makes the
 * command wait rather than pretend the work happened (a progress UI is not
 * part of this yet).
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

  if (subcommand === "status") {
    return {
      output: t(
        (await service.hasIndex())
          ? "index.statusBuilt"
          : "index.statusMissing",
      ),
    };
  }

  try {
    await service.update();
  } catch (error) {
    return {
      output: t("index.failed", {
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  if (!(await service.hasIndex())) {
    return { output: t("index.disabled") };
  }
  return { output: t("index.rebuilt") };
}
