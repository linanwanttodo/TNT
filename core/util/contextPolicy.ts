export interface ContextPolicy {
  compactRatio: number;
  retainRatio: number;
  outputHeadroomTokens: number;
  /**
   * An optional absolute cap on the compaction threshold. Omitted, the ratio
   * alone decides, so a model's real window is used instead of an assumed one.
   *
   * A fixed cap used to be the default, and it was wrong: a 1M-token model
   * compacted at 100k, a tenth of its window, and a session whose fixed prefix
   * (system message + tool schemas) plus the retained tail already exceeded the
   * cap compacted again on every single round without ever getting under it -
   * an unbounded loop that spent a summarization call each time. Operators who
   * want the old bound set `TNT_COMPACT_CEILING`.
   */
  compactCeilingTokens?: number;
  /**
   * The retained tail after a compaction is capped absolutely even when the
   * window is huge: what a session needs freshly is its last exchange or two,
   * and a ratio-only bound would keep a 160k tail on a 1M window.
   */
  retainCeilingTokens?: number;
}

export const CONTEXT_POLICY_REGISTRY = Object.freeze({
  default: Object.freeze({
    // Cursor's trigger: compact once the input reaches 90% of the window. The
    // remaining 10% is the reserve - it covers the reply, the tail the check
    // cannot see yet, and the measurement's own lag. A fixed absolute cap is
    // gone: it compacted a 1M-token model at 10% of its window and left a
    // session whose fixed prefix already exceeded the cap looping forever.
    compactRatio: 0.9,
    retainRatio: 0.16,
    outputHeadroomTokens: 64,
    retainCeilingTokens: 32_000,
  }),
});

export type ContextPolicyName = keyof typeof CONTEXT_POLICY_REGISTRY;

export interface ContextBudget {
  compactAtTokens: number;
  retainTokens: number;
}

export function calculateContextBudget(
  contextWindow: number,
  reservedOutputTokens: number,
  policy: ContextPolicy = CONTEXT_POLICY_REGISTRY.default,
): ContextBudget {
  const ceiling = policy.compactCeilingTokens;
  const retainCeiling = policy.retainCeilingTokens;
  if (
    !Number.isFinite(contextWindow) ||
    !Number.isFinite(reservedOutputTokens) ||
    contextWindow <= 0 ||
    reservedOutputTokens < 0 ||
    policy.compactRatio <= 0 ||
    policy.compactRatio >= 1 ||
    policy.retainRatio <= 0 ||
    policy.retainRatio >= 1 ||
    policy.outputHeadroomTokens < 0 ||
    (ceiling !== undefined && (!Number.isFinite(ceiling) || ceiling <= 0)) ||
    (retainCeiling !== undefined &&
      (!Number.isFinite(retainCeiling) || retainCeiling <= 0))
  ) {
    throw new Error("Invalid context budget configuration");
  }

  const inputCapacity = contextWindow - reservedOutputTokens;
  const ratioBound = Math.floor(contextWindow * policy.compactRatio);
  const compactAtTokens = Math.min(
    ceiling === undefined ? ratioBound : Math.min(ratioBound, ceiling),
    inputCapacity - policy.outputHeadroomTokens,
  );
  const retainRatioBound = Math.floor(inputCapacity * policy.retainRatio);
  const retainTokens =
    retainCeiling === undefined
      ? retainRatioBound
      : Math.min(retainRatioBound, retainCeiling);

  if (compactAtTokens <= 0 || retainTokens >= compactAtTokens) {
    throw new Error("Context window has no safe input space");
  }

  return { compactAtTokens, retainTokens };
}

export function calculateMaxOutputTokens(
  contextWindow: number,
  inputTokens: number,
  configuredMaxTokens: number,
  outputHeadroomTokens: number = CONTEXT_POLICY_REGISTRY.default
    .outputHeadroomTokens,
): number {
  if (
    !Number.isFinite(contextWindow) ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(configuredMaxTokens) ||
    contextWindow < 0 ||
    inputTokens < 0 ||
    configuredMaxTokens < 0 ||
    outputHeadroomTokens < 0
  ) {
    throw new Error("Invalid output token budget configuration");
  }

  return Math.max(
    0,
    Math.min(
      configuredMaxTokens,
      Math.floor(contextWindow - inputTokens - outputHeadroomTokens),
    ),
  );
}
