export interface ContextPolicy {
  compactRatio: number;
  retainRatio: number;
  outputHeadroomTokens: number;
}

export const CONTEXT_POLICY_REGISTRY = Object.freeze({
  default: Object.freeze({
    compactRatio: 0.8,
    retainRatio: 0.16,
    outputHeadroomTokens: 64,
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
  if (
    !Number.isFinite(contextWindow) ||
    !Number.isFinite(reservedOutputTokens) ||
    contextWindow <= 0 ||
    reservedOutputTokens < 0 ||
    policy.compactRatio <= 0 ||
    policy.compactRatio >= 1 ||
    policy.retainRatio <= 0 ||
    policy.retainRatio >= 1 ||
    policy.outputHeadroomTokens < 0
  ) {
    throw new Error("Invalid context budget configuration");
  }

  const inputCapacity = contextWindow - reservedOutputTokens;
  const compactAtTokens = Math.min(
    Math.floor(contextWindow * policy.compactRatio),
    inputCapacity - policy.outputHeadroomTokens,
  );
  const retainTokens = Math.floor(inputCapacity * policy.retainRatio);

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
