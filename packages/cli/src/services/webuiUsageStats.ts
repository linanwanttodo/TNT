/* eslint-disable max-lines -- one module owns the local session aggregation and both usage projections */
import fs from "node:fs";

import type { IUsageStatsService } from "@zcode/services";
import type {
  AppUsageSnapshot,
  AppUsageSummary,
  UsageStatsDaySummary,
  UsageStatsSnapshot,
} from "@zcode/shared";

import { getTranscriptPath } from "../session/paths.js";
import { sessionStore, type SessionMeta } from "../session/store.js";

const UNAVAILABLE = "ZCODE_UNAVAILABLE";
const MAX_SESSIONS = 500;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

interface SessionUsageStat {
  id: string;
  day: string;
  startedAt: number;
  endedAt: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  messageCount: number;
  characters: number;
  toolCalls: number;
  model: string | null;
}

function dayFor(timestamp: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

function machineTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

interface UsageScalar {
  promptTokens?: number;
  completionTokens?: number;
  promptTokensDetails?: { cachedTokens?: number; cacheWriteTokens?: number };
  completionTokensDetails?: { reasoningTokens?: number };
}

function contentCharacters(content: unknown): number {
  if (typeof content === "string") {
    return content.length;
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  let total = 0;
  for (const part of content) {
    const text =
      part && typeof part === "object"
        ? (part as { text?: unknown }).text
        : undefined;
    if (typeof text === "string") {
      total += text.length;
    }
  }
  return total;
}

interface MessageStat {
  characters: number;
  assistant: boolean;
  toolCalls: number;
  model?: string;
}

function messageStat(item: unknown): MessageStat | null {
  const message =
    item && typeof item === "object"
      ? (item as { message?: unknown }).message
      : undefined;
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as {
    role?: unknown;
    content?: unknown;
    toolCalls?: unknown;
    model?: unknown;
  };
  return {
    characters: contentCharacters(record.content),
    assistant: record.role === "assistant",
    toolCalls: Array.isArray(record.toolCalls) ? record.toolCalls.length : 0,
    ...(typeof record.model === "string" ? { model: record.model } : {}),
  };
}

function scanTranscript(
  meta: SessionMeta,
  timeZone?: string,
): SessionUsageStat | null {
  const transcript = getTranscriptPath(meta.sessionId);
  let text: string;
  try {
    const stat = fs.statSync(transcript);
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      text = fs.readFileSync(transcript, "utf-8").slice(-MAX_TRANSCRIPT_BYTES);
    } else {
      text = fs.readFileSync(transcript, "utf-8");
    }
  } catch {
    return null;
  }
  let usage: UsageScalar = {};
  let model: string | null = null;
  let messageCount = 0;
  let characters = 0;
  let toolCalls = 0;
  let firstAt = Date.parse(meta.dateCreated);
  let lastAt = Date.parse(meta.updatedAt);
  if (!Number.isFinite(firstAt)) firstAt = Date.now();
  if (!Number.isFinite(lastAt)) lastAt = firstAt;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const timestamp =
      typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    if (Number.isFinite(timestamp)) {
      firstAt = Math.min(firstAt, timestamp);
      lastAt = Math.max(lastAt, timestamp);
    }
    if (record.type === "session-info") {
      if (record.usage && typeof record.usage === "object") {
        usage = record.usage as UsageScalar;
      }
      if (typeof record.chatModelTitle === "string") {
        model = record.chatModelTitle;
      }
      continue;
    }
    const stat = record.type === "message" ? messageStat(record.item) : null;
    if (!stat) {
      continue;
    }
    characters += stat.characters;
    if (stat.assistant) {
      messageCount += 1;
      toolCalls += stat.toolCalls;
    }
    if (stat.model) {
      model = stat.model;
    }
  }

  const inputTokens = Math.max(
    0,
    (usage.promptTokens ?? 0) - (usage.promptTokensDetails?.cachedTokens ?? 0),
  );
  return {
    id: meta.sessionId,
    day: dayFor(lastAt, timeZone),
    startedAt: firstAt,
    endedAt: lastAt,
    inputTokens,
    outputTokens: usage.completionTokens ?? 0,
    reasoningTokens: usage.completionTokensDetails?.reasoningTokens ?? 0,
    cacheReadTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
    cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0,
    messageCount,
    characters,
    toolCalls,
    model,
  };
}

function collect(
  range: "all" | "7d" | "30d",
  timeZone?: string,
): SessionUsageStat[] {
  const now = Date.now();
  const since =
    range === "7d"
      ? now - 7 * 86_400_000
      : range === "30d"
        ? now - 30 * 86_400_000
        : 0;
  let sessions: SessionMeta[];
  try {
    sessions = sessionStore
      .list()
      .filter((meta) => !meta.archived && (meta.delegationDepth ?? 0) === 0)
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
  return sessions
    .filter((meta) => {
      const at = Date.parse(meta.updatedAt);
      return !Number.isFinite(at) || at >= since;
    })
    .map((meta) => scanTranscript(meta, timeZone))
    .filter((stat): stat is SessionUsageStat => stat !== null);
}

function streakDays(days: Set<string>, endToday: boolean): number {
  if (days.size === 0) return 0;
  const sorted = [...days].sort();
  if (endToday) {
    const today = dayFor(Date.now());
    if (!days.has(today)) {
      return 0;
    }
  }
  let best = 0;
  let current = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    const at = Date.parse(`${day}T00:00:00Z`);
    current =
      previous !== null && at - previous === 86_400_000 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = at;
  }
  return best;
}

function aggregate(stats: SessionUsageStat[]) {
  const total = (pick: (stat: SessionUsageStat) => number) =>
    stats.reduce((sum, stat) => sum + pick(stat), 0);
  const days = new Set(stats.map((stat) => stat.day));
  const byModel = new Map<string, number>();
  for (const stat of stats) {
    const key = stat.model ?? "unknown";
    byModel.set(
      key,
      (byModel.get(key) ?? 0) + stat.inputTokens + stat.outputTokens,
    );
  }
  const favorite = [...byModel.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0];
  const byDay = new Map<string, number>();
  for (const stat of stats) {
    byDay.set(
      stat.day,
      (byDay.get(stat.day) ?? 0) + stat.inputTokens + stat.outputTokens,
    );
  }
  const peakDay = [...byDay.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0];
  return {
    inputTokens: total((stat) => stat.inputTokens),
    outputTokens: total((stat) => stat.outputTokens),
    reasoningTokens: total((stat) => stat.reasoningTokens),
    cacheReadTokens: total((stat) => stat.cacheReadTokens),
    cacheWriteTokens: total((stat) => stat.cacheWriteTokens),
    totalTokens: total(
      (stat) => stat.inputTokens + stat.outputTokens + stat.cacheReadTokens,
    ),
    sessions: stats.length,
    messages: total((stat) => stat.messageCount),
    characters: total((stat) => stat.characters),
    toolCalls: total((stat) => stat.toolCalls),
    activeDays: days.size,
    currentStreak: streakDays(days, true),
    longestStreak: streakDays(days, false),
    longestSessionMs: Math.max(
      0,
      ...stats.map((stat) => Math.max(0, stat.endedAt - stat.startedAt)),
    ),
    favoriteModel: favorite
      ? {
          modelId: favorite[0] === "unknown" ? null : favorite[0],
          totalTokens: favorite[1],
          share:
            total((stat) => stat.inputTokens + stat.outputTokens) > 0
              ? favorite[1] /
                total((stat) => stat.inputTokens + stat.outputTokens)
              : 0,
        }
      : null,
    peakDay: peakDay ? { date: peakDay[0], totalTokens: peakDay[1] } : null,
    byDay,
    byModel,
    firstDay: [...days].sort()[0] ?? null,
    lastDay: [...days].sort().at(-1) ?? null,
  };
}

function appUsageSnapshot(
  stats: SessionUsageStat[],
  range: "all" | "7d" | "30d",
  timeZone: string,
): AppUsageSnapshot {
  const data = aggregate(stats);
  const summary: AppUsageSummary = {
    totalTokens: data.totalTokens,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    reasoningTokens: data.reasoningTokens,
    cacheCreationTokens: data.cacheWriteTokens,
    cacheReadTokens: data.cacheReadTokens,
    cacheHitRate:
      data.inputTokens + data.cacheReadTokens > 0
        ? data.cacheReadTokens / (data.inputTokens + data.cacheReadTokens)
        : 0,
    totalSessions: data.sessions,
    totalTurns: data.messages,
    toolCallCount: data.toolCalls,
    toolErrorRate: 0,
    modelErrorRate: 0,
    avgTimeToFirstTokenMs: null,
    avgTurnDurationMs: null,
    activeDays: data.activeDays,
    currentStreakDays: data.currentStreak,
    longestSessionMs: data.longestSessionMs,
    longestStreakDays: data.longestStreak,
    peakDayTokens: data.peakDay?.totalTokens ?? 0,
    favoriteModel: data.favoriteModel,
  };
  let levelMax = 0;
  for (const tokens of data.byDay.values()) {
    levelMax = Math.max(levelMax, tokens);
  }
  const levelFor = (tokens: number): 0 | 1 | 2 | 3 | 4 => {
    if (tokens <= 0) return 0;
    if (levelMax <= 0) return 1;
    const ratio = tokens / levelMax;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };
  const days = [...data.byDay.keys()].sort();
  const startDate = days[0] ?? null;
  const endDate = days.at(-1) ?? null;
  return {
    range,
    generatedAt: Date.now(),
    timeZone,
    source: "agent-db",
    summary,
    heatmap: {
      startDate,
      endDate,
      maxTokens: levelMax,
      weeks:
        startDate && endDate
          ? buildWeeks(startDate, endDate, (date) => ({
              date,
              level: levelFor(data.byDay.get(date) ?? 0),
              totalTokens: data.byDay.get(date) ?? 0,
              turnCount: 0,
              toolCallCount: 0,
            }))
          : [],
    },
    dailyModelUsage: days.map((date) => ({
      date,
      models: [...data.byModel.entries()].map(([modelId, totalTokens]) => ({
        modelId: modelId === "unknown" ? null : modelId,
        totalTokens,
      })),
    })),
    models: [...data.byModel.entries()].map(([modelId, totalTokens]) => ({
      modelId: modelId === "unknown" ? null : modelId,
      totalTokens,
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
      share: data.totalTokens > 0 ? totalTokens / data.totalTokens : 0,
    })),
    tools: [],
  };
}

function buildWeeks<T>(
  startDate: string,
  endDate: string,
  cell: (date: string) => T,
): { weekIndex: number; days: Array<T | null> }[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const weeks: { weekIndex: number; days: Array<T | null> }[] = [];
  let cursor = start - new Date(start).getUTCDay() * 86_400_000;
  let weekIndex = 0;
  while (cursor <= end && weeks.length < 260) {
    const days: Array<T | null> = [];
    for (let index = 0; index < 7; index += 1) {
      const at = cursor + index * 86_400_000;
      const date = new Date(at).toISOString().slice(0, 10);
      days.push(at >= start && at <= end ? cell(date) : null);
    }
    weeks.push({ weekIndex, days });
    weekIndex += 1;
    cursor += 7 * 86_400_000;
  }
  return weeks;
}

function usageStatsSnapshot(
  stats: SessionUsageStat[],
  range: "7d" | "30d" | "all",
  timeZone: string,
): UsageStatsSnapshot {
  const data = aggregate(stats);
  const daily: UsageStatsDaySummary[] = [...data.byDay.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, tokens]) => ({
      date,
      label: date,
      totalCharacters: 0,
      totalEstimatedTokens: tokens,
      sessionCount: stats.filter((stat) => stat.day === date).length,
      messageCount: stats
        .filter((stat) => stat.day === date)
        .reduce((sum, stat) => sum + stat.messageCount, 0),
      activityScore: tokens,
    }));
  const maxDay = daily.reduce(
    (best, day) =>
      best === null || day.totalEstimatedTokens > best.totalEstimatedTokens
        ? day
        : best,
    null as UsageStatsDaySummary | null,
  );
  return {
    range,
    generatedAt: Date.now(),
    timeZone,
    estimatedTokenCharDivisor: 4,
    source: "local",
    summary: {
      totalSessions: data.sessions,
      totalMessages: data.messages,
      totalCharacters: data.characters,
      totalEstimatedTokens: data.totalTokens,
      activeDays: data.activeDays,
      mostActiveDay: maxDay,
      favoriteModel: data.favoriteModel
        ? {
            modelId: data.favoriteModel.modelId,
            totalCharacters: 0,
            totalEstimatedTokens: data.favoriteModel.totalTokens,
            share: data.favoriteModel.share,
          }
        : null,
      longestSessionMs: data.longestSessionMs,
      longestStreakDays: data.longestStreak,
      currentStreakDays: data.currentStreak,
      firstActivityDate: data.firstDay,
      lastActivityDate: data.lastDay,
      peakHour: null,
    },
    daily,
    heatmap: {
      startDate: data.firstDay,
      endDate: data.lastDay,
      maxActivityScore: maxDay?.totalEstimatedTokens ?? 0,
      weeks:
        data.firstDay && data.lastDay
          ? buildWeeks(data.firstDay, data.lastDay, (date) => ({
              date,
              level: 0,
              totalCharacters: 0,
              totalEstimatedTokens: data.byDay.get(date) ?? 0,
              sessionCount: stats.filter((stat) => stat.day === date).length,
              messageCount: 0,
              activityScore: data.byDay.get(date) ?? 0,
            })).map((week) => ({
              ...week,
              days: week.days.map((cell) =>
                cell
                  ? {
                      ...cell,
                      level:
                        (cell.activityScore ?? 0) >=
                        (maxDay?.totalEstimatedTokens ?? 0) * 0.75
                          ? (4 as const)
                          : (cell.activityScore ?? 0) > 0
                            ? (2 as const)
                            : (0 as const),
                    }
                  : null,
              ),
            }))
          : [],
      monthLabels: [],
    },
    models: [...data.byModel.entries()].map(([modelId, tokens]) => ({
      modelId: modelId === "unknown" ? null : modelId,
      totalCharacters: 0,
      totalEstimatedTokens: tokens,
      inputCharacters: 0,
      inputEstimatedTokens: tokens,
      outputCharacters: 0,
      outputEstimatedTokens: 0,
      sessionCount: stats.filter(
        (stat) => (stat.model ?? "unknown") === modelId,
      ).length,
      messageCount: 0,
      share: data.totalTokens > 0 ? tokens / data.totalTokens : 0,
    })),
  };
}

/**
 * Local usage: the sessions this machine wrote, aggregated on demand. There is
 * no ZCode account behind this host, so every coding-plan or entitlement call
 * reports "not configured" instead of contacting a cloud the shell cannot use.
 */
export function createTntUsageStatsService(): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request) {
      const timeZone = request.timeZone || machineTimeZone();
      const range =
        request.range === "7d" || request.range === "30d"
          ? request.range
          : "all";
      return appUsageSnapshot(collect(range, timeZone), range, timeZone);
    },

    async getSnapshot(request) {
      const timeZone = request.timeZone || machineTimeZone();
      const range =
        request.range === "7d" || request.range === "30d"
          ? request.range
          : "all";
      return usageStatsSnapshot(collect(range, timeZone), range, timeZone);
    },

    async getEntitlementSnapshot() {
      return {
        generatedAt: Date.now(),
        authenticated: false,
        unavailableReason: "not_configured" as const,
        provider: null,
        remaining: null,
        subscription: null,
        quota: null,
      };
    },

    async getCodingPlanUsageSnapshot() {
      throw new Error(
        `${UNAVAILABLE}: usage-stats: this host has no coding-plan account`,
      );
    },

    async getCodingPlanResetStatus() {
      throw new Error(
        `${UNAVAILABLE}: usage-stats: this host has no coding-plan account`,
      );
    },

    async requestCodingPlanResetOpportunity() {
      throw new Error(
        `${UNAVAILABLE}: usage-stats: this host has no coding-plan account`,
      );
    },

    async useCodingPlanReset() {
      throw new Error(
        `${UNAVAILABLE}: usage-stats: this host has no coding-plan account`,
      );
    },

    async markCodingPlanResetHistoryRead() {
      throw new Error(
        `${UNAVAILABLE}: usage-stats: this host has no coding-plan account`,
      );
    },
  };
}
