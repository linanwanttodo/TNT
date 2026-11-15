import { logger } from "../utils/logger.js";

import { setPromptSuggestion } from "./promptSuggestion.js";

/**
 * The prompt that predicts what the user will type next. The answer is shown
 * faint in the empty composer, so it must read like the user's own words:
 * short, and nothing when there is nothing natural to suggest.
 */
const SUGGESTION_PROMPT = `Predict what the user would type next in this conversation. Answer with ONLY that text: 2-12 words, matching the user's language and phrasing style. Output nothing (empty) when nothing natural comes to mind - never a question, never a polite phrase, never a summary of the conversation.

Conversation so far:
$TRANSCRIPT`;

/** The suggestion generation stays quiet: a failure costs nothing visible. */
export async function generatePromptSuggestion(
  recentTurns: string,
): Promise<void> {
  try {
    const { services } = await import("../services/index.js");
    const modelState = services.model?.getState?.() as
      { llmApi?: unknown; model?: { model: string } | null } | undefined;
    const llmApi = modelState?.llmApi as any;
    const model = modelState?.model?.model;

    if (!llmApi || !model) return;

    const { withExponentialBackoff, chatCompletionStreamWithBackoff } =
      await import("../utils/exponentialBackoff.js");

    const stream = withExponentialBackoff(
      async (retrySignal: AbortSignal) =>
        chatCompletionStreamWithBackoff(
          llmApi,
          {
            model,
            messages: [
              {
                role: "user",
                content: SUGGESTION_PROMPT.replace("$TRANSCRIPT", recentTurns),
              },
            ],
            stream: true,
          } as any,
          retrySignal,
        ),
      // The suggestion is best-effort: a user interrupt ends it, nothing else.
      new AbortController().signal,
    );

    let text = "";
    for await (const chunk of await stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    }

    setPromptSuggestion(filterSuggestion(text));
  } catch (error) {
    // A failed suggestion is invisible by design; only the log knows.
    logger.debug("Prompt suggestion generation failed", { error });
  }
}

/**
 * Drops answers that should never appear in a person's input: meta-text about
 * suggesting, multi-sentence essays, anything too long to type.
 */
export function filterSuggestion(raw: string): string {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (!text || text.length >= 100) return "";
  if (/\n/.test(text)) return "";
  if (/^(no suggestion|nothing|none|\(silence\))$/i.test(text)) return "";
  return text;
}
