import { ContinueError, ContinueErrorReason } from "core/util/errors.js";

/**
 * A model name and a provider that cannot answer it is the most common
 * misconfiguration there is, and it fails late: the request goes out, the
 * provider answers 400 with a message about a field the user never wrote, and the
 * session is over before anyone reads it. The two families name their models in a
 * way that makes the mistake visible at config time.
 */

const CLAUDE_MODEL = /^claude/i;
const OPENAI_FAMILY_MODEL =
  /^(gpt-|o[1-9](?:-|$)|chatgpt|davinci|text-embedding)/i;

/** Providers that answer Claude models and nothing else. */
const ANTHROPIC_PROVIDERS = new Set(["anthropic", "claude"]);

/**
 * Providers that answer OpenAI-shaped models and nothing else. Gateways are
 * deliberately absent - OpenRouter, Azure AI Foundry and a local runner can all
 * serve either family, and a reader that cannot tell must not act: a wrong error
 * here blocks a configuration that works.
 */
const OPENAI_FAMILY_PROVIDERS = new Set([
  "openai",
  "deepseek",
  "groq",
  "mistral",
  "xai",
  "moonshot",
  "fireworks",
  "sambanova",
]);

export interface ModelChoiceMismatch {
  provider: string;
  model: string;
  message: string;
}

/**
 * Names the mismatch, or nothing when the pair is plausible. A provider this
 * reader has never heard of is not a verdict: gateways serve both families and
 * their names are open-ended.
 */
export function lintModelChoice(
  provider: string | undefined,
  model: string | undefined,
): ModelChoiceMismatch | undefined {
  if (!provider || !model) return undefined;
  const normalizedProvider = provider.trim().toLowerCase();

  if (
    CLAUDE_MODEL.test(model) &&
    OPENAI_FAMILY_PROVIDERS.has(normalizedProvider)
  ) {
    return {
      provider,
      model,
      message:
        `Model "${model}" is a Claude model, but it is configured with provider: ${provider}. ` +
        `Claude models answer on the Anthropic Messages API: set provider: anthropic for this model, ` +
        `or point this entry at a gateway that translates between the two dialects. ` +
        `As configured, the request is sent as an OpenAI request and refused by the provider.`,
    };
  }

  if (
    OPENAI_FAMILY_MODEL.test(model) &&
    ANTHROPIC_PROVIDERS.has(normalizedProvider)
  ) {
    return {
      provider,
      model,
      message:
        `Model "${model}" is an OpenAI-shaped model, but it is configured with provider: ${provider}, ` +
        `which answers only Claude models on the Anthropic Messages API. Set the provider that serves ` +
        `this model (for example provider: openai), or choose one of ${provider}'s own models.`,
    };
  }

  return undefined;
}

type ModelEntry = { provider?: string; model?: string } | null | undefined;

export function lintConfiguredModels(
  models: ReadonlyArray<ModelEntry> | undefined,
): ModelChoiceMismatch[] {
  return (models ?? [])
    .map((entry) => lintModelChoice(entry?.provider, entry?.model))
    .filter(
      (mismatch): mismatch is ModelChoiceMismatch => mismatch !== undefined,
    );
}

/**
 * Throws when the configured models cannot be answered by their providers, with
 * every offending pair in one message: a config is fixed in one edit, not one
 * line per start.
 */
export function assertModelChoices(
  models: ReadonlyArray<ModelEntry> | undefined,
): void {
  const mismatches = lintConfiguredModels(models);
  if (mismatches.length === 0) return;

  throw new ContinueError(
    ContinueErrorReason.Unspecified,
    mismatches.map((mismatch) => mismatch.message).join("\n"),
  );
}
