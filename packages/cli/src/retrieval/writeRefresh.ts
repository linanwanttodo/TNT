import { logger } from "../utils/logger.js";

/**
 * Called by the tools that write files: re-indexes that file when the
 * workspace already has an index, so the next search sees the edit.
 *
 * The retrieval service is imported lazily on purpose. It carries the index
 * machinery - config loading, the sqlite store, the chunker - and none of
 * that belongs in the module graph of a tool that merely writes a file. A
 * failed refresh is logged, never surfaced: indexing is a side effect of the
 * edit, and must not disturb it.
 */
export function scheduleFileRefresh(filePath: string): void {
  void (async () => {
    try {
      const service = (await import("./service.js")).getRetrievalService();
      if (!(await service.hasIndex())) {
        return;
      }
      await service.refreshFile(filePath);
    } catch (error) {
      logger.debug(
        "Failed to refresh the codebase index for a file",
        error as Error,
      );
    }
  })();
}
