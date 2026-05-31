import { useCallback, useEffect, useState } from "react";

import {
  createAutomationApi,
  deleteAutomationApi,
  fetchAutomations,
  runAutomationApi,
  setAutomationEnabledApi,
  type Automation,
} from "../../../api/client.js";
import css from "../WorkspaceRail.module.css";

/**
 * Schedule presets, one per store mode: cron expressions, an interval (31
 * hours has no cron spelling), and a relative one-shot.
 */
const SCHEDULE_PRESETS: Array<{
  label: string;
  build: () => {
    cronExpr?: string;
    interval?: { unit: "minute" | "hour" | "day" | "week"; value: number };
    delayMinutes?: number;
  };
}> = [
  { label: "*/20 * * * *", build: () => ({ cronExpr: "*/20 * * * *" }) },
  { label: "0 * * * *", build: () => ({ cronExpr: "0 * * * *" }) },
  { label: "0 9 * * *", build: () => ({ cronExpr: "0 9 * * *" }) },
  { label: "0 9 * * 1", build: () => ({ cronExpr: "0 9 * * 1" }) },
  {
    label: "every 31 hours",
    build: () => ({ interval: { unit: "hour", value: 31 } }),
  },
  { label: "in 30 minutes", build: () => ({ delayMinutes: 30 }) },
];

/**
 * The scheduled-runs panel: every automation in the registry with its next
 * fire time, a live pause/resume, a run-now button, and a create form whose
 * cron presets mirror the /loop command's. A fired prompt lands in the live
 * session through the same queue a hand-typed message uses.
 */
export function AutomationsPane() {
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [presetIndex, setPresetIndex] = useState(0);
  const [cronExpr, setCronExpr] = useState("*/20 * * * *");
  const [recurring, setRecurring] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await fetchAutomations();
      setAutomations(result.automations);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (
      key: string,
      action: () => Promise<{ automations: Automation[] }>,
    ) => {
      setBusy(key);
      setNotice(null);
      try {
        const result = await action();
        setAutomations(result.automations);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const submit = useCallback(async () => {
    setBusy("create");
    setNotice(null);
    try {
      const preset = SCHEDULE_PRESETS[presetIndex]!;
      // Cron presets leave the expression editable in the input; the
      // interval and one-shot presets carry their schedule whole.
      const schedule = preset.label.includes("*")
        ? { cronExpr: cronExpr.trim() }
        : preset.build();
      const result = await createAutomationApi({
        title: title.trim() || prompt.trim().slice(0, 40),
        prompt: prompt.trim(),
        ...schedule,
        recurring: schedule.delayMinutes !== undefined ? false : recurring,
      });
      setAutomations(result.automations);
      setCreating(false);
      setTitle("");
      setPrompt("");
      setNotice("Scheduled.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [cronExpr, prompt, recurring, title]);

  if (automations === null && error === null) {
    return <div className={css.muted}>Loading schedules...</div>;
  }

  return (
    <div>
      {error !== null ? (
        <div className={css.muted} role="alert">
          {error}
        </div>
      ) : null}
      {notice !== null ? (
        <div className={css.muted} role="status">
          {notice}
        </div>
      ) : null}

      {creating ? (
        <div className={css.automationForm}>
          <input
            className={css.automationInput}
            value={title}
            placeholder="Title (optional)"
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className={css.automationTextarea}
            value={prompt}
            placeholder="The prompt the agent runs at every occurrence"
            rows={3}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className={css.automationPresets}>
            {SCHEDULE_PRESETS.map((preset, index) => (
              <button
                key={preset.label}
                type="button"
                className={css.automationPreset}
                data-active={presetIndex === index}
                onClick={() => {
                  setPresetIndex(index);
                  // Cron presets seed the editable expression; the other
                  // modes carry their whole schedule in the preset.
                  if (preset.label.includes("*")) setCronExpr(preset.label);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {SCHEDULE_PRESETS[presetIndex]!.label.includes("*") ? (
            <input
              className={css.automationInput}
              value={cronExpr}
              placeholder="custom cron"
              onChange={(event) => setCronExpr(event.target.value)}
            />
          ) : null}
          {!SCHEDULE_PRESETS[presetIndex]!.label.startsWith("in ") ? (
            <label className={css.automationRecurring}>
              <input
                type="checkbox"
                checked={recurring}
                onChange={(event) => setRecurring(event.target.checked)}
              />
              Recurring (uncheck for one run)
            </label>
          ) : null}
          <div className={css.automationFormActions}>
            <button
              type="button"
              className={css.secondaryAction}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={css.primaryAction}
              disabled={busy === "create" || prompt.trim() === ""}
              onClick={() => void submit()}
            >
              {busy === "create" ? "Scheduling..." : "Schedule"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={css.sidePaneLauncher}
          onClick={() => setCreating(true)}
        >
          <span>＋ New schedule</span>
        </button>
      )}

      {automations !== null && automations.length === 0 ? (
        <div className={css.muted}>
          Nothing scheduled yet. CLI: /loop every 20 minutes &lt;prompt&gt;.
        </div>
      ) : null}
      {automations !== null
        ? automations.map((automation) => (
            <div
              key={automation.id}
              className={css.automationRow}
              data-enabled={automation.enabled}
            >
              <div className={css.automationBody}>
                <div className={css.automationTitleRow}>
                  <span className={css.automationTitle}>
                    {automation.title}
                  </span>
                  <span className={css.automationCron}>
                    {automation.cronExpr}
                  </span>
                  {!automation.recurring ? (
                    <span className={css.automationOnce}>once</span>
                  ) : null}
                </div>
                <div className={css.automationMetaRow}>
                  <span
                    className={css.automationMeta}
                    data-retrying={(automation.failCount ?? 0) > 0}
                  >
                    {automation.enabled && automation.failCount
                      ? `Retrying (attempt ${automation.failCount})${
                          automation.nextRunAt
                            ? ` at ${new Date(automation.nextRunAt).toLocaleTimeString()}`
                            : ""
                        }`
                      : automation.enabled && automation.nextRunAt
                        ? `Next: ${new Date(automation.nextRunAt).toLocaleString()}`
                        : "Paused"}
                    {` · ran ${automation.runCount}${
                      automation.maxRuns ? `/${automation.maxRuns}` : ""
                    }`}
                  </span>
                </div>
              </div>
              <div className={css.automationActions}>
                <button
                  type="button"
                  className={css.secondaryAction}
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`run:${automation.id}`, () =>
                      runAutomationApi(automation.id),
                    )
                  }
                >
                  Run
                </button>
                <button
                  type="button"
                  className={css.secondaryAction}
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`enable:${automation.id}`, () =>
                      setAutomationEnabledApi(
                        automation.id,
                        !automation.enabled,
                      ),
                    )
                  }
                >
                  {automation.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className={css.secondaryAction}
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`delete:${automation.id}`, () =>
                      deleteAutomationApi(automation.id),
                    )
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        : null}
    </div>
  );
}
