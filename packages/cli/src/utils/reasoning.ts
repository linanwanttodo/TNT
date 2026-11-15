import type { Reasoning } from "core/index.js";

/**
 * A finished reasoning block in the shape the chat history stores.
 *
 * The CLI never writes an in-progress thought into history: live reasoning is
 * a UI overlay, and the item is written when the round ends. `endAt` is still
 * recorded, because a reader such as the webview's thinking peek treats a block
 * without it as one that is still streaming.
 */
export function completedReasoning(
  text: string,
  now: number = Date.now(),
): Reasoning {
  return { active: false, text, startAt: now, endAt: now };
}
