import type {
  SessionDebugNetworkEntry,
  SessionDebugRound,
} from "@zcode/shared";

/**
 * The live record behind the browser's developer panel.
 *
 * Both rings are per conversation and bounded: the panel polls once a second
 * and only renders a tail, so a session that runs for hours must not grow this
 * process's memory with rounds nobody will read. Nothing here is written to
 * disk - a resumed session starts its panel empty, which is the honest state
 * for a record of this process's own requests.
 */

const MAX_ROUNDS_PER_CONVERSATION = 200;
const MAX_NETWORK_PER_CONVERSATION = 100;
const MAX_CONVERSATIONS = 16;

/**
 * The request's input split by content class, in estimated tokens. Declared
 * here rather than imported from the stream engine so this module stays below
 * it: the producer is the engine, the reader is the app server.
 */
export interface DebugSections {
  system: number;
  tools: number;
  messages: number;
  hookNotes: number;
}

export interface DebugRound extends SessionDebugRound {
  sections?: DebugSections;
}

interface ConversationRounds {
  rounds: DebugRound[];
  nextIndex: number;
}

const roundsByConversation = new Map<string, ConversationRounds>();
const networkByConversation = new Map<string, SessionDebugNetworkEntry[]>();
let networkSequence = 0;

/**
 * Bounds the number of conversations held. Map iteration order is insertion
 * order, so the oldest conversation is the first key; dropping it loses only
 * the history of a conversation this process stopped working on.
 */
function evictOldest(map: Map<string, unknown>): void {
  while (map.size >= MAX_CONVERSATIONS) {
    const oldest = map.keys().next();
    if (oldest.done === true) return;
    map.delete(oldest.value);
  }
}

function pushBounded<T>(list: T[], entry: T, limit: number): void {
  list.push(entry);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
}

/**
 * `key` is the conversation's prompt cache key (`tnt-<session>`), which a
 * delegated run also reports, so the panel of the conversation that spawned an
 * agent shows that agent's rounds next to its own.
 */
export function recordDebugRound(
  key: string | undefined,
  round: Omit<
    DebugRound,
    "eventKey" | "requestId" | "requestIndex" | "recordedAt"
  >,
): void {
  if (!key) return;
  let conversation = roundsByConversation.get(key);
  if (!conversation) {
    evictOldest(roundsByConversation);
    conversation = { rounds: [], nextIndex: 0 };
    roundsByConversation.set(key, conversation);
  }
  conversation.nextIndex += 1;
  const requestIndex = conversation.nextIndex;
  pushBounded(
    conversation.rounds,
    {
      ...round,
      eventKey: `${key}#${requestIndex}`,
      requestId: `${key}#${requestIndex}`,
      requestIndex,
      recordedAt: Date.now(),
    },
    MAX_ROUNDS_PER_CONVERSATION,
  );
}

/** Oldest first, so the panel can render the order the requests happened in. */
export function readDebugRounds(
  key: string,
  limit: number = MAX_ROUNDS_PER_CONVERSATION,
): DebugRound[] {
  const rounds = roundsByConversation.get(key)?.rounds ?? [];
  return rounds.slice(Math.max(0, rounds.length - limit));
}

export type NetworkStatusType = SessionDebugNetworkEntry["statusType"];

export interface NetworkDebugFact {
  statusType: NetworkStatusType;
  modelId?: string;
  providerKind?: string;
  querySource?: string;
  attempt?: number;
  maxAttempts?: number;
  retryable?: boolean;
  statusCode?: number;
  durationMs?: number;
  delayMs?: number;
  idleMs?: number;
  reason?: string;
  message?: string;
}

/**
 * The adapter layer this CLI calls does not hand back the raw HTTP exchange,
 * so the header maps stay empty rather than being invented: what is recorded
 * is what actually happened to the request - attempts, retries, stalls, how
 * long it took, and why it failed.
 */
export function recordNetworkDebug(
  key: string | undefined,
  fact: NetworkDebugFact,
): void {
  if (!key) return;
  let entries = networkByConversation.get(key);
  if (!entries) {
    evictOldest(networkByConversation);
    entries = [];
    networkByConversation.set(key, entries);
  }
  networkSequence += 1;
  const recordedAt = Date.now();
  pushBounded(
    entries,
    {
      eventKey: `${key}:net:${networkSequence}`,
      traceId: `${key}:net:${networkSequence}`,
      recordedAt,
      statusType: fact.statusType,
      ...(fact.modelId === undefined ? {} : { modelId: fact.modelId }),
      ...(fact.providerKind === undefined
        ? {}
        : { providerKind: fact.providerKind }),
      ...(fact.querySource === undefined
        ? {}
        : { querySource: fact.querySource }),
      ...(fact.attempt === undefined ? {} : { attempt: fact.attempt }),
      ...(fact.maxAttempts === undefined
        ? {}
        : { maxAttempts: fact.maxAttempts }),
      ...(fact.retryable === undefined ? {} : { retryable: fact.retryable }),
      ...(fact.statusCode === undefined ? {} : { statusCode: fact.statusCode }),
      ...(fact.durationMs === undefined ? {} : { durationMs: fact.durationMs }),
      ...(fact.delayMs === undefined ? {} : { delayMs: fact.delayMs }),
      ...(fact.idleMs === undefined ? {} : { idleMs: fact.idleMs }),
      ...(fact.reason === undefined ? {} : { reason: fact.reason }),
      ...(fact.message === undefined ? {} : { message: fact.message }),
      timestamp: new Date(recordedAt).toISOString(),
      requestHeaders: {},
      responseHeaders: {},
      requestHeaderCount: 0,
      responseHeaderCount: 0,
    },
    MAX_NETWORK_PER_CONVERSATION,
  );
}

/** Newest first, which is the order the panel lists them in. */
export function readNetworkDebug(
  key: string,
  limit: number = MAX_NETWORK_PER_CONVERSATION,
): SessionDebugNetworkEntry[] {
  const entries = networkByConversation.get(key) ?? [];
  const tail = entries.slice(Math.max(0, entries.length - limit));
  return [...tail].reverse();
}

/** Tests only: the rings are process-wide, so each case starts from empty. */
export function resetDebugRings(): void {
  roundsByConversation.clear();
  networkByConversation.clear();
  networkSequence = 0;
}
