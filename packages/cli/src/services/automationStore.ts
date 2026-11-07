/**
 * Scheduled agent runs, TNT's automation store. ZCode drives the same feature
 * from a SQLite table (automationRepo: cron_expr / prompt / recurring /
 * max_runs) with a scheduler computing next_run_at; this implementation keeps
 * the identical model in one JSON file under the global directory and its own
 * small five-field cron parser, so a scheduled prompt is a real turn the
 * running surface executes - not a timer that only ticks in the browser.
 *
 * The firing path is exactly POST /message's: the prompt is enqueued on the
 * message queue and the turn runner drains it, so a scheduled run lands in
 * the same transcript, the same SSE stream and the same permission flow as a
 * hand-typed message.
 */
import fs from "fs";
import path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { globalDir } from "../config/globalDir.js";
import { t } from "../i18n/index.js";

/**
 * One schedule rule, carrying exactly one of the three modes. The shape
 * follows the best of both references: cron from ZCode's automationRepo, the
 * interval-unit pairs and the relative one-shot from Claude Code's harness
 * cron (where "in 8 minutes" is anchored by the host's clock at creation and
 * is never re-expressed as cron - a one-shot that just lapsed would otherwise
 * silently roll a year forward), plus ZCode's end_at cap.
 */
export type AutomationIntervalUnit = "minute" | "hour" | "day" | "week";

export type AutomationSchedule =
  | { mode: "cron"; cronExpr: string }
  | {
      mode: "interval";
      unit: AutomationIntervalUnit;
      /** 1..1000; the host anchors the phase at creation. */
      value: number;
    }
  | { mode: "once"; runOnceAt: number };

export interface Automation {
  id: string;
  title: string;
  prompt: string;
  schedule: AutomationSchedule;
  /** Kept for display when the rule is a plain cron expression. */
  cronExpr?: string;
  /** False runs once at the next occurrence, then disables itself. */
  recurring: boolean;
  /** Optional total-run cap; the automation disables itself when reached. */
  maxRuns?: number;
  /** Optional wall-clock deadline; past it the automation stops firing. */
  endAt?: number;
  runCount: number;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number | null;
  lastRunAt?: number;
  /** Consecutive failed turns since the last success, for retry backoff. */
  failCount?: number;
}

/** ZCode's dispatch retry backoff: 30s doubling, capped at 15 minutes. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_CAP_MS = 15 * 60_000;

export function computeRetryAt(now: number, attempts: number): number {
  const backoff = Math.min(
    RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
    RETRY_CAP_MS,
  );
  return now + backoff;
}

/**
 * A scheduled turn failed: back off exponentially instead of waiting for the
 * next cron occurrence, so a broken provider is retried at 30s, 1m, 2m...
 * up to the cap, and a healthy schedule resumes exactly on time after a
 * success resets the counter.
 */
export function markAutomationFailed(
  id: string,
  now: number,
): Automation | null {
  const file = readFile();
  const automation = file.automations.find((entry) => entry.id === id);
  if (!automation) return null;
  automation.failCount = (automation.failCount ?? 0) + 1;
  automation.nextRunAt = computeRetryAt(now, automation.failCount);
  writeFile(file);
  return automation;
}

/** A scheduled turn succeeded: clear the failure streak. */
export function markAutomationSucceeded(id: string): void {
  const file = readFile();
  const automation = file.automations.find((entry) => entry.id === id);
  if (
    !automation ||
    automation.failCount === undefined ||
    automation.failCount === 0
  ) {
    return;
  }
  automation.failCount = 0;
  writeFile(file);
}

const INTERVAL_MS: Record<AutomationIntervalUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

interface AutomationsFile {
  automations: Automation[];
}

const AUTOMATIONS_FILE = path.join(globalDir(), "automations.json");

function readFile(): AutomationsFile {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(AUTOMATIONS_FILE, "utf-8"),
    ) as AutomationsFile | null;
    if (parsed && Array.isArray(parsed.automations)) {
      // Entries written before schedules became a tagged union carry a bare
      // cronExpr; normalize them so the scheduler reads one shape.
      parsed.automations = parsed.automations.map((automation) =>
        automation.schedule
          ? automation
          : {
              ...automation,
              schedule: {
                mode: "cron",
                cronExpr: automation.cronExpr ?? "* * * * *",
              },
            },
      );
      return parsed;
    }
  } catch {
    // Missing or unreadable file: start from an empty registry.
  }
  return { automations: [] };
}

function writeFile(file: AutomationsFile): void {
  fs.mkdirSync(path.dirname(AUTOMATIONS_FILE), { recursive: true });
  writeFileAtomically(AUTOMATIONS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

/* ------------------------------------------------------------------ */
/* Five-field cron parsing: minute hour day-of-month month day-of-week */
/* Supports * , - / in every field. Local time throughout.             */
/* ------------------------------------------------------------------ */

type FieldSpec = { values: Set<number>; wildcard: boolean };

function parseField(field: string, min: number, max: number): FieldSpec | null {
  if (field === "*") return { values: new Set(), wildcard: true };
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(\*|\d+)(?:-(\d+))?\/(\d+)$/);
    if (stepMatch) {
      const start = stepMatch[1] === "*" ? min : Number(stepMatch[1]);
      const end = stepMatch[2] ? Number(stepMatch[2]) : max;
      const step = Number(stepMatch[3]);
      if (
        start < min ||
        end > max ||
        start > end ||
        step < 1 ||
        step > max - min + 1
      ) {
        return null;
      }
      for (let value = start; value <= end; value += step) values.add(value);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start < min || end > max || start > end) return null;
      for (let value = start; value <= end; value++) values.add(value);
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (value < min || value > max) return null;
    values.add(value);
  }
  return { values, wildcard: false };
}

const CRON_FIELDS: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

export function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every(
    (field, index) => parseField(field, ...CRON_FIELDS[index]!) !== null,
  );
}

/**
 * The next local timestamp after `after` that the expression fires, or null
 * when no occurrence exists within five years (a Feb-29-only schedule, say).
 */
export function nextRunFromCron(expr: string, after: number): number | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed = fields.map((field, index) =>
    parseField(field, ...CRON_FIELDS[index]!),
  );
  if (parsed.some((spec) => spec === null)) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed as FieldSpec[];

  const start = new Date(after + 60_000);
  start.setSeconds(0, 0);

  // Day-by-day scan from the start date, capped at five years so a
  // Feb-29-only schedule terminates. Each matching day enumerates its
  // hour×minute grid and returns the first stamp past `after`.
  const cursor = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const limit = new Date(
    start.getFullYear() + 5,
    start.getMonth(),
    start.getDate(),
  );
  const minuteValues = minute.wildcard ? allMinutes() : orderedValues(minute);
  const hourValues = hour.wildcard ? allHours() : orderedValues(hour);

  while (cursor < limit) {
    if (month.wildcard || month.values.has(cursor.getMonth() + 1)) {
      // Standard cron: when both day fields are restricted the day matches
      // either one; when one is a wildcard only the other constrains.
      const domMatch =
        dayOfMonth.wildcard || dayOfMonth.values.has(cursor.getDate());
      const dowMatch =
        dayOfWeek.wildcard || dayOfWeek.values.has(cursor.getDay());
      const dayMatches =
        dayOfMonth.wildcard && dayOfWeek.wildcard
          ? true
          : dayOfMonth.wildcard
            ? dowMatch
            : dayOfWeek.wildcard
              ? domMatch
              : domMatch || dowMatch;
      if (dayMatches) {
        const stamp = firstStampOnDay(cursor, hourValues, minuteValues, after);
        if (stamp !== null) return stamp;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

/**
 * The first hour×minute stamp on `day` that falls past `after`, or null when
 * the whole grid is behind it. Split out of the day scan so the search stays
 * three loops deep instead of five.
 */
function firstStampOnDay(
  day: Date,
  hourValues: number[],
  minuteValues: number[],
  after: number,
): number | null {
  for (const hourValue of hourValues) {
    for (const minuteValue of minuteValues) {
      const candidate = new Date(day);
      candidate.setHours(hourValue, minuteValue, 0, 0);
      if (candidate.getTime() > after) return candidate.getTime();
    }
  }
  return null;
}

function orderedValues(spec: FieldSpec): number[] {
  return [...spec.values].sort((a, b) => a - b);
}

function allHours(): number[] {
  return Array.from({ length: 24 }, (_, value) => value);
}

function allMinutes(): number[] {
  return Array.from({ length: 60 }, (_, value) => value);
}

/* ------------------------------------------------------------------ */
/* CRUD + firing                                                       */
/* ------------------------------------------------------------------ */

export function listAutomations(): Automation[] {
  return readFile().automations;
}

export class AutomationError extends Error {}

/** The mutually exclusive schedule fields a create call may carry. */
interface ScheduleInput {
  cronExpr?: string;
  interval?: { unit: AutomationIntervalUnit; value: number };
  delayMinutes?: number;
  runOnceAt?: number;
}

/**
 * Resolve the one-of-three schedule fields into a mode. Early returns keep the
 * rules independent: a call that sets no mode reaches the single "no schedule"
 * error at the end, instead of every link of an if-chain testing for absence.
 */
function resolveSchedule(
  input: ScheduleInput,
  now: number,
): AutomationSchedule {
  if (input.cronExpr !== undefined) {
    if (!isValidCronExpression(input.cronExpr)) {
      throw new AutomationError(
        t("automations.invalidCron", { expr: input.cronExpr }),
      );
    }
    return { mode: "cron", cronExpr: input.cronExpr.trim() };
  }

  if (input.interval !== undefined) {
    const { unit, value } = input.interval;
    if (
      !(unit in INTERVAL_MS) ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 1000
    ) {
      throw new AutomationError(t("automations.invalidInterval"));
    }
    return { mode: "interval", unit, value };
  }

  if (input.delayMinutes !== undefined) {
    if (typeof input.delayMinutes !== "number" || input.delayMinutes <= 0) {
      throw new AutomationError(t("automations.invalidDelay"));
    }
    return { mode: "once", runOnceAt: now + input.delayMinutes * 60_000 };
  }

  const runOnceAt = input.runOnceAt;
  if (runOnceAt === undefined) {
    throw new AutomationError(t("automations.noSchedule"));
  }
  if (typeof runOnceAt !== "number" || runOnceAt <= now) {
    throw new AutomationError(t("automations.invalidOnce"));
  }
  return { mode: "once", runOnceAt };
}

export function createAutomation(input: {
  title: string;
  prompt: string;
  /** Exactly one schedule mode must be provided. */
  cronExpr?: string;
  interval?: { unit: AutomationIntervalUnit; value: number };
  /** One-shot delay, anchored by the host's clock at creation. */
  delayMinutes?: number;
  /** Or an absolute one-shot timestamp (client-preferred form). */
  runOnceAt?: number;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
}): Automation {
  if (!input.title.trim()) {
    throw new AutomationError(t("automations.titleRequired"));
  }
  if (!input.prompt.trim()) {
    throw new AutomationError(t("automations.promptRequired"));
  }

  const now = Date.now();
  const schedule = resolveSchedule(input, now);

  const automation: Automation = {
    id: `auto-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim(),
    prompt: input.prompt.trim(),
    schedule,
    ...(schedule.mode === "cron" ? { cronExpr: schedule.cronExpr } : {}),
    recurring: input.recurring ?? schedule.mode !== "once",
    ...(input.maxRuns !== undefined && input.maxRuns > 0
      ? { maxRuns: input.maxRuns }
      : {}),
    ...(input.endAt !== undefined && input.endAt > now
      ? { endAt: input.endAt }
      : {}),
    runCount: 0,
    enabled: true,
    createdAt: now,
    nextRunAt: nextRunFor(schedule, now),
  };
  file_write(automation, (file) => {
    file.automations.push(automation);
  });
  return automation;
}

/** Roll the schedule forward, per mode, after (or before) a fire. */
function nextRunFor(
  schedule: AutomationSchedule,
  after: number,
): number | null {
  switch (schedule.mode) {
    case "cron":
      return nextRunFromCron(schedule.cronExpr, after);
    case "interval":
      // Interval rules are anchored to the previous fire: every 31 hours
      // means 31 hours after the last run, not a wall-clock grid.
      return after + INTERVAL_MS[schedule.unit] * schedule.value;
    case "once":
      return schedule.runOnceAt > after ? schedule.runOnceAt : null;
  }
}

function file_write(
  automation: Automation,
  mutate: (file: AutomationsFile) => void,
): void {
  const file = readFile();
  mutate(file);
  writeFile(file);
}

export function deleteAutomation(id: string): boolean {
  const file = readFile();
  const before = file.automations.length;
  file.automations = file.automations.filter(
    (automation) => automation.id !== id,
  );
  if (file.automations.length === before) return false;
  writeFile(file);
  return true;
}

export function setAutomationEnabled(id: string, enabled: boolean): Automation {
  const file = readFile();
  const automation = file.automations.find((entry) => entry.id === id);
  if (!automation) {
    throw new AutomationError(t("automations.notFound", { id }));
  }
  automation.enabled = enabled;
  if (enabled && automation.nextRunAt === null) {
    automation.nextRunAt = nextRunFor(automation.schedule, Date.now());
  }
  writeFile(file);
  return automation;
}

/**
 * Fire every due automation once: bump its counters, roll nextRunAt forward,
 * self-disable at the caps and past an endAt deadline, and return the prompts
 * to enqueue. The caller feeds them to the message queue; the store never
 * runs turns itself.
 */
export function runDueAutomations(
  now: number = Date.now(),
): Array<Pick<Automation, "id" | "title" | "prompt">> {
  const file = readFile();
  const fired: Array<Pick<Automation, "id" | "title" | "prompt">> = [];
  for (const automation of file.automations) {
    if (!automation.enabled) continue;
    // ZCode's end_at: past the deadline the automation stops for good.
    if (automation.endAt !== undefined && now > automation.endAt) {
      automation.enabled = false;
      automation.nextRunAt = null;
      continue;
    }
    if (automation.nextRunAt === null || automation.nextRunAt > now) continue;
    automation.runCount += 1;
    automation.lastRunAt = now;
    const capReached =
      automation.maxRuns !== undefined &&
      automation.runCount >= automation.maxRuns;
    const next =
      automation.recurring && !capReached
        ? nextRunFor(automation.schedule, now)
        : null;
    automation.nextRunAt = next;
    if (!automation.recurring || capReached || next === null) {
      automation.enabled = false;
    }
    fired.push({
      id: automation.id,
      title: automation.title,
      prompt: automation.prompt,
    });
  }
  if (fired.length > 0) writeFile(file);
  return fired;
}
