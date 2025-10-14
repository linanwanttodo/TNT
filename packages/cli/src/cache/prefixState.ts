import crypto from "crypto";

import {
  canonicalHeader,
  headerEquals,
  type RequestHeader,
} from "./requestHeader.js";

/**
 * Whether the prompt prefix the provider already cached still applies to the
 * request about to be sent.
 *
 * - `full`: the prefix is byte-identical to the previous request.
 * - `passthrough`: the prefix was only extended (a new system update or a new
 *   tool appended), so the earlier bytes are still a prefix of this request.
 * - `invalidated`: something inside the prefix moved, so the provider cannot
 *   read past that point.
 */
export type CachePrefixState = "full" | "passthrough" | "invalidated";

export interface CachePrefixVerdict {
  readonly state: CachePrefixState;
  readonly reasons: readonly string[];
}

/**
 * Reported when the session has no earlier request to compare against. Not a
 * comparison result, only a label for the first request of a conversation.
 */
export const COLD_PREFIX_STATE = "cold";

/**
 * Reported for a compaction request. It carries a summary prompt rather than
 * the conversation prefix, so the session's state does not describe it.
 */
export const COMPACTION_PREFIX_STATE = "compaction";

/**
 * Providers only cache a prompt once it is long enough, so a zero cache read
 * below this length says nothing about who caused the miss.
 */
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;

/** Which side a zero cache read can be blamed on. */
export type CacheMissOwner = "prefix" | "provider";

/**
 * Fields that sit at the head of the request. Moving any of them shifts the
 * bytes the provider cached, so a change here is never a passthrough.
 */
const FROZEN_FIELDS = [
  "model",
  "systemMessage",
  "temperature",
  "maxTokens",
] as const;

const APPENDED_UPDATES = "appended:systemMessageUpdates";
const APPENDED_TOOLS = "appended:tools";

/**
 * The header alone does not decide the prefix: rewriting the message history
 * invalidates the cached tokens the messages carried, and no header field
 * records that.
 */
export const HISTORY_REWRITTEN = "history_rewritten";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function extendsSequence(
  previous: readonly unknown[] | undefined,
  current: readonly unknown[] | undefined,
): boolean {
  const base = previous ?? [];
  const next = current ?? [];
  if (base.length > next.length) {
    return false;
  }
  return base.every((value, index) => sameValue(value, next[index]));
}

function compareHeaderPrefix(
  previous: RequestHeader,
  current: RequestHeader,
): CachePrefixVerdict {
  if (headerEquals(previous, current).equal) {
    return { state: "full", reasons: [] };
  }

  const before = canonicalHeader(previous);
  const after = canonicalHeader(current);
  const frozenChanges = FROZEN_FIELDS.filter(
    (field) => !sameValue(before[field], after[field]),
  );
  const updatesExtended = extendsSequence(
    before.systemMessageUpdates,
    after.systemMessageUpdates,
  );
  const toolsExtended = extendsSequence(before.tools, after.tools);

  if (frozenChanges.length === 0 && updatesExtended && toolsExtended) {
    return {
      state: "passthrough",
      reasons: [
        ...(sameValue(before.systemMessageUpdates, after.systemMessageUpdates)
          ? []
          : [APPENDED_UPDATES]),
        ...(sameValue(before.tools, after.tools) ? [] : [APPENDED_TOOLS]),
      ],
    };
  }

  return {
    state: "invalidated",
    reasons: [
      ...frozenChanges,
      ...(updatesExtended ? [] : ["systemMessageUpdates"]),
      ...(toolsExtended ? [] : ["tools"]),
    ],
  };
}

/**
 * Compares the prefix of the request about to be sent with the one the
 * previous request carried, and names what moved when it did.
 *
 * Returns undefined when there is nothing to compare against and nothing was
 * rewritten, which is the first request of a conversation rather than a fourth
 * state.
 */
export function classifyCachePrefix(
  previous: RequestHeader | undefined,
  current: RequestHeader,
  options: { historyRewritten?: boolean } = {},
): CachePrefixVerdict | undefined {
  const { historyRewritten = false } = options;

  if (!previous) {
    return historyRewritten
      ? { state: "invalidated", reasons: [HISTORY_REWRITTEN] }
      : undefined;
  }

  const headerVerdict = compareHeaderPrefix(previous, current);
  if (!historyRewritten) {
    return headerVerdict;
  }

  return {
    state: "invalidated",
    reasons: [...headerVerdict.reasons, HISTORY_REWRITTEN],
  };
}

/**
 * Canonical form of a prefix, used as the identity two requests are compared
 * by. The key order is fixed by `canonicalHeader`, and nested values keep
 * every field, so two different tool schemas never serialize the same.
 */
export function serializeCachePrefix(header: RequestHeader): string {
  return JSON.stringify(canonicalHeader(header));
}

function shortHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export interface CachePrefixKeys {
  readonly prefix: string;
  readonly system: string;
  readonly tools: string;
}

/**
 * Short hashes of the prefix and of its two independently edited halves, so a
 * drop in the hit ratio can be traced to the system block or the tool list
 * across more than two requests. Rules are part of the system message, so the
 * system hash covers them.
 */
export function cachePrefixKeys(header: RequestHeader): CachePrefixKeys {
  const canonical = canonicalHeader(header);
  return {
    prefix: shortHash(serializeCachePrefix(header)),
    system: shortHash(
      JSON.stringify([
        canonical.systemMessage ?? null,
        canonical.systemMessageUpdates ?? null,
      ]),
    ),
    tools: shortHash(JSON.stringify(canonical.tools ?? null)),
  };
}

const SCOPE_KEY = "__session__";
const prefixMemory = new Map<string, RequestHeader>();

/**
 * Remembers the prefix of the last request, keyed by the prompt cache key, so
 * the next request (the next turn, or a delegated run sharing the key) can be
 * compared against it.
 */
export function rememberCachePrefix(
  scope: string | undefined,
  header: RequestHeader,
): void {
  prefixMemory.set(scope ?? SCOPE_KEY, header);
}

export function recallCachePrefix(
  scope: string | undefined,
): RequestHeader | undefined {
  return prefixMemory.get(scope ?? SCOPE_KEY);
}

export function forgetCachePrefixes(): void {
  prefixMemory.clear();
}

/**
 * Attributes a request that read nothing from the cache. An identical prefix
 * with no cache read is the provider's, because the request carried the bytes
 * it had already billed for.
 */
export function attributeCacheMiss(options: {
  verdict?: CachePrefixVerdict;
  cacheReadTokens: number;
  inputTokens: number;
}): CacheMissOwner | undefined {
  const { verdict, cacheReadTokens, inputTokens } = options;
  if (
    !verdict ||
    cacheReadTokens > 0 ||
    inputTokens < MIN_CACHEABLE_PREFIX_TOKENS
  ) {
    return undefined;
  }
  return verdict.state === "invalidated" ? "prefix" : "provider";
}
