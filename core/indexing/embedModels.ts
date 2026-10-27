import type { ILLM } from "../index.js";

/**
 * Lives here rather than in `docs/DocsService.ts` because `CodebaseIndexer`
 * needs only this comparison. Reaching it through the docs service dragged that
 * file's whole graph - the crawlers, the Chromium crawler, and puppeteer behind
 * it - into the static closure of every CLI run that touches retrieval.
 *
 * Two embedding models describe the same index only if their chunks are the
 * same length and came from the same provider, which is what decides whether
 * already-stored vectors can be reused instead of recomputed.
 */
export function embedModelsAreEqual(
  llm1: ILLM | null | undefined,
  llm2: ILLM | null | undefined,
): boolean {
  return (
    llm1?.underlyingProviderName === llm2?.underlyingProviderName &&
    llm1?.title === llm2?.title &&
    llm1?.maxEmbeddingChunkSize === llm2?.maxEmbeddingChunkSize
  );
}
