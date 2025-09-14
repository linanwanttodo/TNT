import * as fs from "fs";
import * as path from "path";

import { hashString } from "core/util/cacheBreakDetection.js";

import { getCacheBreaksDir, getCurrentSession } from "../session/index.js";
import { logger } from "../utils/logger.js";

import type { CachePrefixVerdict } from "./prefixState.js";
import type { RequestHeader } from "./requestHeader.js";

/**
 * A prefix that moved is only worth reporting when the bill shows it: providers
 * round, warm caches expire on their own, and a one-point wobble on a short
 * request is noise. The numbers below come from that - a report has to be both a
 * real drop and big enough that the drop costs something.
 */
export const HIT_RATE_DROP_POINTS = 5;
export const MIN_REPORTED_INPUT_TOKENS = 2000;
const MAX_DIFF_CHARS = 20_000;
const MAX_STORED_PER_SESSION = 20;

/** Everything a prefix can be made of, for a report with no verdict to follow. */
const ALL_PREFIX_FIELDS = [
  "model",
  "temperature",
  "maxTokens",
  "mode",
  "systemMessage",
  "tools",
  "history_rewritten",
];

export interface CacheRound {
  inputTokens: number;
  cacheReadTokens: number;
}

export function cacheHitRate(round: CacheRound): number {
  if (round.inputTokens <= 0) return 0;
  return Math.min(1, round.cacheReadTokens / round.inputTokens);
}

export interface CacheBreakAssessment {
  report: boolean;
  previousRate: number;
  currentRate: number;
  dropPoints: number;
}

export function assessCacheBreak(
  previous: CacheRound | undefined,
  current: CacheRound,
): CacheBreakAssessment {
  const previousRate = previous ? cacheHitRate(previous) : 0;
  const currentRate = cacheHitRate(current);
  const dropPoints = (previousRate - currentRate) * 100;

  return {
    report:
      previous !== undefined &&
      current.inputTokens >= MIN_REPORTED_INPUT_TOKENS &&
      dropPoints > HIT_RATE_DROP_POINTS,
    previousRate,
    currentRate,
    dropPoints,
  };
}

const SCOPE_KEY = "__session__";
const lastRounds = new Map<string, CacheRound>();

export function recordCacheRound(
  scope: string | undefined,
  round: CacheRound,
): void {
  lastRounds.set(scope ?? SCOPE_KEY, round);
}

export function recallCacheRound(
  scope: string | undefined,
): CacheRound | undefined {
  return lastRounds.get(scope ?? SCOPE_KEY);
}

export function forgetCacheRounds(): void {
  lastRounds.clear();
}

function bounded(value: unknown): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return text.length > MAX_DIFF_CHARS
    ? `${text.slice(0, MAX_DIFF_CHARS)}\n... ${text.length - MAX_DIFF_CHARS} more characters`
    : text;
}

/**
 * The part of a system message that moved, as the lines that left and the lines
 * that arrived. Equal ends are skipped so a block added in the middle does not
 * print the whole prompt twice.
 */
function diffText(
  before: string,
  after: string,
): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return {
    removed: a.slice(start, endA).slice(0, 40),
    added: b.slice(start, endB).slice(0, 40),
  };
}

function toolIdentity(tool: unknown): { name: string; hash: number } {
  const fn = (tool as any)?.function ?? {};
  const name = typeof fn.name === "string" ? fn.name : "(unnamed)";
  return {
    name,
    hash: hashString(
      `${fn.description ?? ""}|${JSON.stringify(fn.parameters ?? {})}`,
    ),
  };
}

function diffTools(previous: readonly unknown[], current: readonly unknown[]) {
  const before = previous.map(toolIdentity);
  const after = current.map(toolIdentity);
  const changed: string[] = [];
  const moved: string[] = [];
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i++) {
    if (before[i].name !== after[i].name)
      moved.push(`slot ${i}: ${before[i].name} -> ${after[i].name}`);
    else if (before[i].hash !== after[i].hash) changed.push(before[i].name);
  }
  return {
    changed,
    moved,
    added: after.slice(shared).map((tool) => tool.name),
    removed: before.slice(shared).map((tool) => tool.name),
  };
}

/**
 * Names, per field, what left the prefix between two rounds. A verdict says
 * `tools` moved; this says which one and to what.
 */
export function describePrefixDiff(
  previous: RequestHeader,
  current: RequestHeader,
  reasons: readonly string[],
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};

  for (const field of ["model", "temperature", "maxTokens", "mode"] as const) {
    if (
      !reasons.includes(field) ||
      JSON.stringify(previous[field]) === JSON.stringify(current[field])
    ) {
      continue;
    }
    diff[field] = {
      before: previous[field] ?? null,
      after: current[field] ?? null,
    };
  }

  if (
    reasons.some((reason) => reason.startsWith("systemMessage")) &&
    (previous.systemMessage ?? "") !== (current.systemMessage ?? "")
  ) {
    diff.systemMessage = diffText(
      previous.systemMessage ?? "",
      current.systemMessage ?? "",
    );
  }

  const updatesBefore = previous.systemMessageUpdates ?? [];
  const updatesAfter = current.systemMessageUpdates ?? [];
  if (
    reasons.some((reason) => reason.startsWith("systemMessage")) &&
    JSON.stringify(updatesBefore) !== JSON.stringify(updatesAfter)
  ) {
    diff.systemMessageUpdates = {
      before: updatesBefore.map(bounded),
      after: updatesAfter.map(bounded),
    };
  }

  if (
    reasons.includes("tools") &&
    JSON.stringify(previous.tools ?? []) !== JSON.stringify(current.tools ?? [])
  ) {
    diff.tools = diffTools(previous.tools ?? [], current.tools ?? []);
  }

  if (reasons.includes("history_rewritten")) {
    diff.history =
      "rewritten between rounds, so the cached messages no longer line up";
  }

  return diff;
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "break";
}

function pruneOldest(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .map((file) => ({
      file,
      mtimeMs: fs.statSync(path.join(dir, file)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { file } of files.slice(MAX_STORED_PER_SESSION)) {
    try {
      fs.rmSync(path.join(dir, file), { force: true });
    } catch {}
  }
}

/**
 * Writes the diff beside the session store and hands back the path, so the line
 * in the log points at something readable. A failed write is not a reason to
 * lose the assessment, so it returns undefined and the caller still logs the
 * numbers.
 */
export function writeCacheBreakReport(options: {
  verdict?: CachePrefixVerdict;
  previous: RequestHeader;
  current: RequestHeader;
  assessment: CacheBreakAssessment;
}): string | undefined {
  const { verdict, previous, current, assessment } = options;
  try {
    const sessionId = getCurrentSession().sessionId;
    const dir = getCacheBreaksDir(sessionId);
    const reasons = verdict?.reasons ?? ALL_PREFIX_FIELDS;
    const body = {
      at: new Date().toISOString(),
      session: sessionId,
      reasons,
      prefix: verdict ? verdict.state : "cold",
      hitRate: {
        previous: Number(assessment.previousRate.toFixed(4)),
        current: Number(assessment.currentRate.toFixed(4)),
        dropPoints: Number(assessment.dropPoints.toFixed(2)),
      },
      diff: describePrefixDiff(previous, current, reasons),
    };
    const file = path.join(
      dir,
      `${safeFileName(body.at.replace(/[:.]/g, "-"))}-${Math.floor(Math.random() * 1e6)}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf-8");
    pruneOldest(dir);
    return file;
  } catch (error) {
    logger.warn("Could not write the cache break report", {
      error: String(error),
    });
    return undefined;
  }
}
