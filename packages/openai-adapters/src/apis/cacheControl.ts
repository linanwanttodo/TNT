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

/**
 * What an endpoint accepts for cache breakpoints.
 *
 * Endpoints differ in whether they honor a breakpoint on tool definitions,
 * how many breakpoints they honor, and whether they recognize the key at all.
 * Leaving this unset keeps the Anthropic default: two breakpoints, one on the
 * stable head and one on the newest message. A value is for an endpoint whose
 * behavior is known and needs the request narrowed further.
 */
export interface CacheControlFormat {
  /** Endpoint honors a breakpoint on tool definitions. Defaults to true. */
  readonly acceptsCacheControlOnTools?: boolean;
  /** Endpoint honors a breakpoint on message blocks. Defaults to true. */
  readonly acceptsCacheControlOnMessages?: boolean;
  /** Most breakpoints the endpoint reads back. Unset means no narrowing. */
  readonly maxBreakpoints?: number;
}

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

/**
 * Anthropic reads up to four breakpoints per request - past four, the last four
 * are the ones that take effect - and bills a cache write of about 1.25x the input
 * rate for each one it acts on, against a read of about 0.1x. Two is the number
 * that earns its keep: the newest message, whose span reaches back over everything
 * before it, and one on the stable head, which is the part that survives between
 * turns. The rest would each pay a write for a span that a kept breakpoint already
 * covers. (The 1,024-token minimum and the five-minute lifetime are Anthropic's;
 * nothing here can tell whether a prefix is long enough or still warm.)
 */
export const ANTHROPIC_MAX_CACHE_BREAKPOINTS = 2;

/**
 * Keeps the breakpoint on the newest message and the one on the stable head, and
 * strips whatever else the strategy marked. The head is the last tool when tools
 * carry one - a breakpoint there covers the system block and every tool before it -
 * and the last system block when they do not.
 */
export function capBreakpointsForAnthropic<T extends Record<string, any>>(
  body: T,
  max: number = ANTHROPIC_MAX_CACHE_BREAKPOINTS,
): T {
  const sections: Array<readonly any[] | undefined> = [
    Array.isArray(body.system) ? body.system : undefined,
    Array.isArray(body.tools) ? body.tools : undefined,
    Array.isArray(body.messages) ? body.messages : undefined,
  ];
  const positions: Array<{ section: number; index: number }> = [];
  sections.forEach((items, section) => {
    (items ?? []).forEach((item, index) => {
      if (hasBreakpointAnywhere(item)) positions.push({ section, index });
    });
  });

  if (positions.length <= max) {
    return body;
  }

  const keep = new Set<string>();
  if (max > 0) {
    const newest = positions[positions.length - 1];
    keep.add(`${newest.section}:${newest.index}`);
    if (max > 1) {
      const head =
        [...positions].reverse().find((spot) => spot.section === 1) ??
        [...positions].reverse().find((spot) => spot.section === 0);
      if (head) keep.add(`${head.section}:${head.index}`);
    }
  }

  const narrowOne = (items: readonly any[] | undefined, section: number) =>
    items?.map((item, index) =>
      hasBreakpointAnywhere(item) && !keep.has(`${section}:${index}`)
        ? stripCacheControlDeep(item)
        : item,
    );

  return {
    ...body,
    ...(Array.isArray(body.system)
      ? { system: narrowOne(body.system, 0) }
      : {}),
    ...(Array.isArray(body.tools) ? { tools: narrowOne(body.tools, 1) } : {}),
    ...(Array.isArray(body.messages)
      ? { messages: narrowOne(body.messages, 2) }
      : {}),
  } as T;
}

/**
 * Removes a breakpoint from an item and, when the item carries content
 * blocks, from those blocks too. A message holds its breakpoint on a block
 * inside `content`, not on the message itself.
 */
function stripCacheControlDeep<T>(value: T): T {
  if (!isObject(value)) {
    return value;
  }
  const out = stripCacheControl(value as Record<string, any>);
  if (Array.isArray(out.content)) {
    return {
      ...out,
      content: (out.content as unknown[]).map((block) =>
        isObject(block) ? stripCacheControl(block) : block,
      ),
    } as T;
  }
  return out as T;
}

function hasBreakpointAnywhere(item: unknown): boolean {
  if (hasCacheControl(item)) {
    return true;
  }
  return (
    isObject(item) &&
    Array.isArray(item.content) &&
    item.content.some((block) => hasCacheControl(block))
  );
}

function stripBreakpointsDeep<T>(
  items: readonly T[] | undefined,
): T[] | undefined {
  if (!items) {
    return undefined;
  }
  return items.map((item) => stripCacheControlDeep(item));
}

/**
 * Narrows a request to what its endpoint accepts, or returns it untouched when
 * no capabilities were declared.
 *
 * The budget is counted across system, tools and messages together, because
 * the provider reads them as one sequence: the breakpoint limit is a limit on
 * the request, not on each section.
 */
export function applyCacheControlFormat<T extends Record<string, any>>(
  body: T,
  format?: CacheControlFormat,
): T {
  if (!format) {
    return body;
  }

  let result: T = body;

  if (format.acceptsCacheControlOnMessages === false) {
    result = {
      ...result,
      messages: stripBreakpointsDeep(result.messages),
    };
  }

  if (format.acceptsCacheControlOnTools === false) {
    result = { ...result, tools: stripBreakpointsDeep(result.tools) };
  }

  if (typeof format.maxBreakpoints === "number") {
    let remaining = Math.max(0, format.maxBreakpoints);
    /**
     * Keeps the breakpoints nearest the end of the sequence, because those
     * mark the longest reusable span. One breakpoint on the last message
     * reuses everything up to it; one on the system block only reuses the
     * system block.
     */
    const consume = (items: readonly any[] | undefined) => {
      if (!items) {
        return undefined;
      }
      const kept = new Set<number>();
      for (let i = items.length - 1; i >= 0 && remaining > 0; i--) {
        if (hasBreakpointAnywhere(items[i])) {
          kept.add(i);
          remaining -= 1;
        }
      }
      return items.map((item, i) =>
        hasBreakpointAnywhere(item) && !kept.has(i)
          ? stripCacheControlDeep(item)
          : item,
      );
    };

    result = { ...result };
    // The request's sequence is system, then tools, then messages. Spending the
    // budget backwards through that sequence keeps the breakpoints with the
    // longest reusable prefix ahead of them.
    if (Array.isArray(result.messages)) {
      (result as any).messages = consume(result.messages);
    }
    if (Array.isArray(result.tools)) {
      (result as any).tools = consume(result.tools);
    }
    if (Array.isArray(result.system)) {
      (result as any).system = consume(result.system);
    }
  }

  return result;
}
