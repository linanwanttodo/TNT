/**
 * Shape comparison for the parts of a request that decide whether the cached
 * prefix still applies.
 *
 * Hashing would answer "did it change" but not "what changed", which is the
 * question that matters when a cache miss is unexplained. Comparing the
 * canonical form directly lets a caller diff two requests and name the field
 * that moved without keeping a second copy of the original payloads.
 */

export interface RequestHeader {
  readonly model: string;
  readonly systemMessage?: string;
  readonly systemMessageUpdates?: readonly string[];
  readonly tools?: readonly unknown[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly mode?: string;
}

/**
 * Same as the header but with an empty tool list normalized to the field being
 * absent. Providers that omit `tools` and callers that pass `tools: []`
 * produce byte-identical requests, so treating them as different would blame
 * the tools for a miss that came from somewhere else.
 */
export type CanonicalRequestHeader = RequestHeader;

export function canonicalHeader(header: RequestHeader): CanonicalRequestHeader {
  const tools =
    header.tools && header.tools.length > 0 ? header.tools : undefined;
  return {
    model: header.model,
    ...(header.systemMessage !== undefined
      ? { systemMessage: header.systemMessage }
      : {}),
    ...(header.systemMessageUpdates && header.systemMessageUpdates.length > 0
      ? { systemMessageUpdates: header.systemMessageUpdates }
      : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(header.temperature !== undefined
      ? { temperature: header.temperature }
      : {}),
    ...(header.maxTokens !== undefined ? { maxTokens: header.maxTokens } : {}),
    ...(header.mode !== undefined ? { mode: header.mode } : {}),
  };
}

/**
 * Field-by-field equality with tools compared as an ordered sequence.
 *
 * The field names are returned alongside the answer so a caller can log which
 * one differed rather than only that something did.
 */
export function headerEquals(
  a: RequestHeader,
  b: RequestHeader,
): { equal: boolean; differingFields: string[] } {
  const ca = canonicalHeader(a);
  const cb = canonicalHeader(b);
  const fields: Array<keyof CanonicalRequestHeader> = [
    "model",
    "systemMessage",
    "systemMessageUpdates",
    "tools",
    "temperature",
    "maxTokens",
    "mode",
  ];

  const differingFields = fields.filter(
    (field) => JSON.stringify(ca[field]) !== JSON.stringify(cb[field]),
  );

  return { equal: differingFields.length === 0, differingFields };
}

/**
 * Describes which parts of a request the previous one changed, from
 * definitions alone.
 *
 * This is the inverse of the usual hash path: instead of hashing both and
 * hoping they differ, it names the field that would have to change for a
 * mismatch to occur. Useful when reconstructing a past miss from a log.
 */
export function foldRequestHeader(header: RequestHeader): {
  key: string;
  fields: string[];
} {
  const canonical = canonicalHeader(header);
  const fields = Object.keys(canonical).sort();
  return {
    key: JSON.stringify(canonical, Object.keys(canonical).sort()),
    fields,
  };
}
