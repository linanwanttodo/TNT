import type { MessageParam } from "@anthropic-ai/sdk/resources";

/**
 * Prompt cache breakpoint maintenance.
 *
 * Breakpoints are only useful while the provider still holds the prefix they
 * marked. A breakpoint that has fallen out of the window costs nothing to send
 * but is misleading, and one placed on a reasoning block is wasted work: the
 * provider discards the block when the signature does not verify, taking the
 * cached span with it.
 *
 * Everything here only removes breakpoints. The number sent is decided by the
 * caching strategy, which is left alone until real usage data justifies
 * changing it.
 */

export const DEFAULT_MAX_CACHE_BREAKPOINTS = 4;

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCacheControl(value: unknown): boolean {
  return isObject(value) && "cache_control" in value;
}

/**
 * Removes the `cache_control` key while leaving every other key in place.
 *
 * The provider options object can carry more than the breakpoint, such as a
 * thinking configuration, so replacing the object wholesale would drop those
 * settings along with it.
 */
function stripCacheControl<T>(value: T): T {
  if (!isObject(value) || !("cache_control" in value)) {
    return value;
  }
  const { cache_control: _dropped, ...rest } = value as Record<string, any>;
  return rest as T;
}

/**
 * Keeps the most recent `max` breakpoints and removes the rest.
 *
 * Breakpoints are scanned from the end so the ones nearest the current turn,
 * which the provider is most likely to still hold, are the ones kept.
 */
export function pruneCacheBreakpoints<T>(
  items: readonly T[],
  max: number = DEFAULT_MAX_CACHE_BREAKPOINTS,
): T[] {
  let remaining = Math.max(0, max);
  const result: T[] = new Array(items.length);

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    result[i] = item;
    if (!hasCacheControl(item)) {
      continue;
    }
    if (remaining > 0) {
      remaining -= 1;
      continue;
    }
    result[i] = stripCacheControl(item);
  }

  return result;
}

/**
 * Drops breakpoints from reasoning blocks and removes reasoning blocks whose
 * signature cannot be verified.
 *
 * A reasoning block is only accepted by the provider when its signature
 * matches what the provider itself issued. A block that lost its signature
 * across a serialization boundary would otherwise be rejected wholesale,
 * discarding the surrounding cached span with it, so an unverifiable block is
 * removed here rather than sent and rejected. A message left with no content
 * after that is dropped too, since an empty message is itself invalid.
 */
export function sanitizeReasoningBlocks(
  messages: MessageParam[],
): MessageParam[] {
  const result: MessageParam[] = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      result.push(message);
      continue;
    }

    // The block types are deliberately widened: a block missing its signature
    // is exactly the case this function exists to catch, so it cannot be
    // represented in the SDK's types.
    const content = (message.content as any[])
      .filter((block) => {
        if (!isObject(block)) {
          return true;
        }
        if (block.type !== "thinking" && block.type !== "redacted_thinking") {
          return true;
        }
        // A redacted block carries its payload in `data` rather than a
        // signature, so there is nothing to verify and nothing to strip.
        if (block.type === "redacted_thinking") {
          return true;
        }
        return typeof block.signature === "string" && block.signature !== "";
      })
      .map((block) =>
        isObject(block) &&
        (block.type === "thinking" || block.type === "redacted_thinking")
          ? stripCacheControl(block)
          : block,
      );

    result.push({ ...message, content } as MessageParam);
  }

  return result.filter(
    (message) =>
      !(Array.isArray(message.content) && message.content.length === 0),
  );
}

export function countCacheBreakpoints(messages: MessageParam[]): number {
  return messages.reduce((total, message) => {
    if (!Array.isArray(message.content)) {
      return total;
    }
    return (
      total + message.content.filter((block) => hasCacheControl(block)).length
    );
  }, 0);
}
