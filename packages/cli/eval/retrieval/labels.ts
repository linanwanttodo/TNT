/**
 * The labeled half of the retrieval benchmark.
 *
 * Ground truth is a `(file, marker)` pair rather than a line number: the marker
 * is a phrase that appears once in the file it names, and the harness resolves
 * it to that line when it runs. A fixture that gets edited therefore moves its
 * own label instead of quietly leaving a stale line number behind, and the
 * `resolves to one line` case fails if a marker stops being unique or vanishes.
 *
 * Tracks are chosen so the tools are not measuring the same thing:
 * - `symbol` an identifier that exists in the code
 * - `phrase` wording that only lives in a comment or a document
 * - `near-miss` a query whose tokens also appear in a distractor file, so the
 *   order of the answer decides the score
 * - `cross-file` the definition and a caller, both of which belong in the answer
 * - `file-pattern` which files match a path glob
 */

export type Track =
  "symbol" | "phrase" | "near-miss" | "cross-file" | "file-pattern";

export type ToolName = "CodebaseSearch" | "Search" | "Glob";

/** How many files a tool may return before the answer stops counting. */
export const RECALL_AT = 8;

export interface Expectation {
  /** Path relative to the corpus root, with forward slashes. */
  file: string;
  /** Phrase unique to the labelled lines within `file`. */
  marker: string;
}

export interface EvalQuery {
  id: string;
  track: Track;
  tool: ToolName;
  /** The text a model would pass to the tool. */
  query: string;
  /**
   * With `anyOf`, one of the expectations landing in the answer is enough -
   * used where two files genuinely answer the same question.
   */
  anyOf?: boolean;
  expect: Expectation[];
}

const cache = "src/cache/ttlCache.ts";
const cacheSpec = "src/cache/ttlCache.test.ts";
const flight = "src/cache/singleFlight.ts";
const refund = "src/billing/refund.ts";
const gateway = "src/billing/gatewayClient.ts";
const retry = "src/billing/retryPolicy.ts";
const orders = "src/orders/orderService.ts";
const paging = "src/orders/pagination.ts";
const settings = "src/config/settings.ts";
const clock = "src/util/clock.ts";
const architecture = "docs/architecture.md";
const runbook = "docs/runbook.md";

export const QUERIES: EvalQuery[] = [
  // --- CodebaseSearch, symbols -------------------------------------------------
  {
    id: "cb-refund-limit",
    track: "symbol",
    tool: "CodebaseSearch",
    query: "PARTIAL_REFUND_LIMIT",
    expect: [{ file: refund, marker: "export const PARTIAL_REFUND_LIMIT" }],
  },
  {
    id: "cb-backoff",
    track: "symbol",
    tool: "CodebaseSearch",
    query: "withBackoff",
    expect: [{ file: retry, marker: "export async function withBackoff" }],
  },
  {
    id: "cb-cursor",
    track: "symbol",
    tool: "CodebaseSearch",
    query: "cursorFor",
    expect: [{ file: paging, marker: "export function cursorFor" }],
  },
  {
    id: "cb-ttl-default",
    track: "symbol",
    tool: "CodebaseSearch",
    query: "DEFAULT_TTL_MS",
    expect: [{ file: cache, marker: "export const DEFAULT_TTL_MS" }],
  },
  {
    id: "cb-settings",
    track: "symbol",
    tool: "CodebaseSearch",
    query: "loadSettings",
    expect: [{ file: settings, marker: "export function loadSettings" }],
  },

  // --- CodebaseSearch, wording that only exists in prose ----------------------
  {
    id: "cb-cache-forgets",
    track: "phrase",
    tool: "CodebaseSearch",
    query: "map that forgets its own entries",
    expect: [{ file: cache, marker: "A map that forgets its own entries" }],
  },
  {
    id: "cb-second-approver",
    track: "phrase",
    tool: "CodebaseSearch",
    query: "refund needs a second approver",
    anyOf: true,
    expect: [
      {
        file: refund,
        marker: "A refund above the limit needs a second approver",
      },
      { file: architecture, marker: "needs a second approver" },
    ],
  },
  {
    id: "cb-one-load-per-key",
    track: "phrase",
    tool: "CodebaseSearch",
    query: "one in-flight load per key",
    anyOf: true,
    expect: [
      { file: flight, marker: "One in-flight load per key" },
      { file: architecture, marker: "keeps one in-flight" },
    ],
  },
  {
    id: "cb-advance-clock",
    track: "phrase",
    tool: "CodebaseSearch",
    query: "a clock the tests can advance",
    expect: [{ file: clock, marker: "A clock the tests can advance" }],
  },
  {
    id: "cb-idempotency",
    track: "phrase",
    tool: "CodebaseSearch",
    query: "charged once per idempotency key",
    expect: [
      { file: gateway, marker: "The card is charged once per idempotency key" },
    ],
  },

  // --- CodebaseSearch, with a distractor in the same run ----------------------
  {
    id: "cb-ttl-expiry",
    track: "near-miss",
    tool: "CodebaseSearch",
    query: "drops a value written before the window",
    expect: [
      { file: cacheSpec, marker: "drops a value written before the window" },
    ],
  },
  {
    id: "cb-ttl-window",
    track: "near-miss",
    tool: "CodebaseSearch",
    query: "ttl expiry older than window",
    expect: [{ file: cache, marker: "one older than the ttl drops it" }],
  },
  {
    id: "cb-refund-limit-why",
    track: "near-miss",
    tool: "CodebaseSearch",
    query: "refund limit control not a tuning knob",
    expect: [{ file: runbook, marker: "a control, not a tuning knob" }],
  },
  {
    id: "cb-retry-wait",
    track: "near-miss",
    tool: "CodebaseSearch",
    query: "wait doubles per attempt",
    expect: [{ file: retry, marker: "Retries a call whose transient failure" }],
  },
  {
    id: "cb-decline-not-transient",
    track: "near-miss",
    tool: "CodebaseSearch",
    query: "decline that is not transient",
    expect: [
      {
        file: runbook,
        marker: "not transient, the retry ceiling will not help",
      },
    ],
  },

  // --- CodebaseSearch, definition and caller both belong ---------------------
  {
    id: "cb-refund-callers",
    track: "cross-file",
    tool: "CodebaseSearch",
    query: "issueRefund",
    expect: [
      { file: refund, marker: "export async function issueRefund" },
      { file: orders, marker: "await issueRefund" },
    ],
  },
  {
    id: "cb-flight-wiring",
    track: "cross-file",
    tool: "CodebaseSearch",
    query: "SingleFlight",
    expect: [
      { file: flight, marker: "export class SingleFlight" },
      { file: settings, marker: "new SingleFlight(cache)" },
    ],
  },
  {
    id: "cb-cache-consumers",
    track: "cross-file",
    tool: "CodebaseSearch",
    query: "TtlCache",
    expect: [
      { file: cache, marker: "export class TtlCache" },
      { file: flight, marker: "private readonly cache: TtlCache<T>" },
    ],
  },
  {
    id: "cb-page-cursor",
    track: "cross-file",
    tool: "CodebaseSearch",
    query: "DEFAULT_PAGE_SIZE",
    expect: [
      { file: paging, marker: "export const DEFAULT_PAGE_SIZE" },
      { file: orders, marker: "size = DEFAULT_PAGE_SIZE" },
    ],
  },

  // --- Search: the tool that is asked for exact patterns ----------------------
  {
    id: "se-refund-limit",
    track: "symbol",
    tool: "Search",
    query: "PARTIAL_REFUND_LIMIT",
    expect: [
      { file: refund, marker: "export const PARTIAL_REFUND_LIMIT" },
      { file: architecture, marker: "`PARTIAL_REFUND_LIMIT`" },
    ],
  },
  {
    id: "se-env-var",
    track: "symbol",
    tool: "Search",
    query: "RELAY_TTL_MS",
    expect: [
      { file: settings, marker: "env.RELAY_TTL_MS" },
      { file: runbook, marker: "Increase `RELAY_TTL_MS` and restart" },
    ],
  },
  {
    id: "se-approver",
    track: "phrase",
    tool: "Search",
    query: "approver",
    anyOf: true,
    expect: [
      { file: refund, marker: "approver?: string" },
      { file: runbook, marker: "Re-issue the refund with an approver" },
    ],
  },
  {
    id: "se-doubling",
    track: "symbol",
    tool: "Search",
    query: "2 \\*\\* attempt",
    expect: [{ file: retry, marker: "BASE_DELAY_MS * 2 ** attempt" }],
  },
  {
    id: "se-export-class",
    track: "cross-file",
    tool: "Search",
    query: "^export class",
    expect: [
      { file: cache, marker: "export class TtlCache" },
      { file: gateway, marker: "export class GatewayClient" },
      { file: flight, marker: "export class SingleFlight" },
    ],
  },
  {
    id: "se-page-size",
    track: "near-miss",
    tool: "Search",
    query: "DEFAULT_PAGE_SIZE",
    expect: [
      { file: paging, marker: "export const DEFAULT_PAGE_SIZE" },
      { file: orders, marker: "size = DEFAULT_PAGE_SIZE" },
    ],
  },
  {
    id: "se-attempts",
    track: "near-miss",
    tool: "Search",
    query: "MAX_ATTEMPTS",
    // The document names the same constant; the ceiling is set in the code.
    expect: [{ file: retry, marker: "export const MAX_ATTEMPTS = 4;" }],
  },
  {
    id: "se-forgets-phrase",
    track: "phrase",
    tool: "Search",
    query: "forgets its own entries",
    anyOf: true,
    expect: [
      { file: cache, marker: "A map that forgets its own entries" },
      { file: architecture, marker: "The cache forgets its own entries" },
    ],
  },
  {
    id: "se-ttl-usage",
    track: "cross-file",
    tool: "Search",
    query: "TtlCache",
    expect: [
      { file: cache, marker: "export class TtlCache" },
      { file: flight, marker: "cache: TtlCache<T>" },
      { file: settings, marker: "new TtlCache<string>" },
    ],
  },

  // --- Glob: which files exist, not what they say -----------------------------
  {
    id: "gb-cache-files",
    track: "file-pattern",
    tool: "Glob",
    query: "**/ttlCache*",
    expect: [
      { file: cache, marker: "export class TtlCache" },
      { file: cacheSpec, marker: 'describe("TtlCache"' },
    ],
  },
  {
    id: "gb-billing-dir",
    track: "file-pattern",
    tool: "Glob",
    query: "src/billing/*.ts",
    expect: [
      { file: refund, marker: "export const PARTIAL_REFUND_LIMIT" },
      { file: gateway, marker: "export class GatewayClient" },
      { file: retry, marker: "export const MAX_ATTEMPTS" },
    ],
  },
  {
    id: "gb-docs",
    track: "file-pattern",
    tool: "Glob",
    query: "**/*.md",
    expect: [
      { file: architecture, marker: "# Relay architecture" },
      { file: runbook, marker: "# Relay runbook" },
    ],
  },
  {
    id: "gb-one-file",
    track: "file-pattern",
    tool: "Glob",
    query: "src/orders/pagination.ts",
    expect: [{ file: paging, marker: "export function cursorFor" }],
  },
];

/**
 * Per `tool/track` floor, measured from a real run (`npx tsx
 * eval/retrieval/runEval.ts`) and set under the measurement so a platform
 * difference does not read as a slide. A bucket with no entry fails the guard,
 * which is what keeps a dropped track from passing.
 *
 * `Search` answers with whatever the pattern matches, so its recall is decided:
 * a file that holds the pattern has to appear. Its *order* comes from the
 * directory walk, which is not portable, so its mrr floor is loose.
 * `CodebaseSearch` ranks, so both halves are floored with room.
 */
export const FLOORS: Record<string, { recallAt: number; mrr: number }> = {
  "CodebaseSearch/symbol": { recallAt: 0.8, mrr: 0.5 },
  "CodebaseSearch/phrase": { recallAt: 0.6, mrr: 0.5 },
  "CodebaseSearch/near-miss": { recallAt: 0.6, mrr: 0.5 },
  "CodebaseSearch/cross-file": { recallAt: 0.75, mrr: 0.6 },
  "Search/symbol": { recallAt: 1, mrr: 0.5 },
  "Search/phrase": { recallAt: 1, mrr: 0.3 },
  "Search/near-miss": { recallAt: 1, mrr: 0.5 },
  "Search/cross-file": { recallAt: 1, mrr: 0.3 },
  "Glob/file-pattern": { recallAt: 1, mrr: 0.75 },
};
