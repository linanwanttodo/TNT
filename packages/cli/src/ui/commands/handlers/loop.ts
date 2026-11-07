import chalk from "chalk";

import { t } from "../../../i18n/index.js";
import {
  createAutomation,
  deleteAutomation,
  isValidCronExpression,
  listAutomations,
  setAutomationEnabled,
} from "../../../services/automationStore.js";
import { symbols } from "../../symbols.js";
import type { SlashCommandResult } from "../types.js";

/**
 * `/loop` - schedule a recurring agent run from the terminal. The prompt is
 * stored in the automation registry and the scheduler fires it into the
 * message queue at every occurrence, so the run lands in the live session
 * like a hand-typed message.
 *
 *   /loop                                  list the schedules
 *   /loop off                              disable every schedule
 *   /loop off <id>                         disable one schedule
 *   /loop every 20 minutes <prompt>        every-twenty-minutes cron
 *   /loop every 6 hours <prompt>           every-six-hours cron
 *   /loop 0 9 * * * <prompt>               a raw five-field cron expression
 */
export function handleLoop(args: string[] = []): SlashCommandResult {
  if (args.length === 0) return listAutomationsOutput();

  const [first, ...rest] = args;
  if (first === "off") {
    const target = rest[0];
    if (!target || target === "all") {
      const enabled = listAutomations().filter((entry) => entry.enabled);
      for (const entry of enabled) setAutomationEnabled(entry.id, false);
      return {
        output: t("automations.disabledAll", { count: enabled.length }),
      };
    }
    try {
      setAutomationEnabled(target, false);
      return { output: t("automations.disabledOne", { id: target }) };
    } catch {
      return { output: t("automations.notFound", { id: target }) };
    }
  }

  const spec = args[0]!;
  const prompt = args.slice(1).join(" ").trim();
  if (prompt === "") {
    return { output: t("automations.missingPrompt") };
  }

  // The schedule the command maps to, one of the store's three modes.
  let schedule: Parameters<typeof createAutomation>[0] | null = null;

  // "in 30 minutes <prompt>" is a one-shot, anchored by this clock at
  // creation - never re-expressed as cron.
  const inMatch = spec.match(/^in\s+(\d+)\s+(minutes?|mins?|hours?|hrs?)$/i);
  if (inMatch) {
    const step = Number(inMatch[1]);
    if (step < 1) return { output: t("automations.invalidEvery") };
    const delayMinutes = /^h/i.test(inMatch[2]!) ? step * 60 : step;
    schedule = { title: "", prompt, delayMinutes, recurring: false };
  } else {
    const everyMatch = spec.match(
      /^every\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)$/i,
    );
    if (everyMatch) {
      const step = Number(everyMatch[1]);
      if (step < 1) return { output: t("automations.invalidEvery") };
      const unitWord = everyMatch[2]!.toLowerCase();
      if (/^h/.test(unitWord) && step > 24) {
        // Cron's hour field tops out at 23: beyond it the interval rule is
        // the only honest spelling, anchored to each fire.
        schedule = {
          title: "",
          prompt,
          interval: { unit: "hour", value: step },
          recurring: true,
        };
      } else if (/^d/.test(unitWord)) {
        schedule = {
          title: "",
          prompt,
          interval: { unit: "day", value: step },
          recurring: true,
        };
      } else if (/^w/.test(unitWord)) {
        schedule = {
          title: "",
          prompt,
          interval: { unit: "week", value: step },
          recurring: true,
        };
      } else if (/^h/.test(unitWord)) {
        schedule = {
          title: "",
          prompt,
          cronExpr: `0 */${step} * * *`,
          recurring: true,
        };
      } else {
        schedule = {
          title: "",
          prompt,
          cronExpr: `*/${step} * * * *`,
          recurring: true,
        };
      }
    } else if (isValidCronExpression(spec)) {
      schedule = { title: "", prompt, cronExpr: spec, recurring: true };
    } else if (/^\d+$/.test(spec)) {
      // `/loop 20 <prompt>` reads as every N minutes, the spelling people type.
      schedule = {
        title: "",
        prompt,
        cronExpr: `*/${spec} * * * *`,
        recurring: true,
      };
    }
  }
  if (schedule === null) {
    return { output: t("automations.invalidSchedule", { spec }) };
  }

  try {
    const automation = createAutomation({
      ...schedule,
      title: prompt.length > 48 ? `${prompt.slice(0, 45)}...` : prompt,
    });
    const next = automation.nextRunAt
      ? new Date(automation.nextRunAt).toLocaleString()
      : t("automations.nextUnknown");
    return {
      output: [
        chalk.green(symbols().check + " " + t("automations.created")),
        chalk.dim(
          `  ${chalk.cyan(automation.id)} ${describeSchedule(automation)} · ${chalk.dim(next)}`,
        ),
      ].join("\n"),
    };
  } catch (error) {
    return {
      output: error instanceof Error ? error.message : String(error as unknown),
    };
  }
}

/** Human label for any of the three schedule modes. */
function describeSchedule(automation: {
  schedule: unknown;
  cronExpr?: string;
}): string {
  const schedule = automation.schedule as {
    mode: string;
    cronExpr?: string;
    unit?: string;
    value?: number;
    runOnceAt?: number;
  };
  switch (schedule.mode) {
    case "cron":
      return schedule.cronExpr ?? "";
    case "interval":
      return `every ${schedule.value} ${schedule.unit}${schedule.value === 1 ? "" : "s"}`;
    case "once":
      return `once at ${new Date(schedule.runOnceAt ?? 0).toLocaleString()}`;
    default:
      return "";
  }
}

function listAutomationsOutput(): SlashCommandResult {
  const automations = listAutomations();
  if (automations.length === 0) {
    return { output: chalk.dim(t("automations.listEmpty")) };
  }
  const lines = automations.map((automation) => {
    const state = automation.enabled
      ? chalk.green(symbols().check)
      : chalk.dim(symbols().ring);
    // A failing schedule shows its retry backoff instead of pretending the
    // next fire is a normal occurrence.
    const next = automation.enabled
      ? automation.failCount && automation.nextRunAt
        ? chalk.yellow(
            t("automations.retrying", {
              attempt: automation.failCount,
              at: new Date(automation.nextRunAt).toLocaleTimeString(),
            }),
          )
        : automation.nextRunAt
          ? new Date(automation.nextRunAt).toLocaleString()
          : chalk.dim(t("automations.paused"))
      : chalk.dim(t("automations.paused"));
    return `  ${state} ${chalk.cyan(automation.id)} ${chalk.bold(describeSchedule(automation))} · ${next}\n    ${chalk.dim(automation.prompt)}`;
  });
  return { output: [t("automations.listTitle"), ...lines].join("\n") };
}

// Re-exported so tests and future callers keep one import site.
export { deleteAutomation };
