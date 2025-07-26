import { useContext, useEffect, useMemo, useState } from "react";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useI18n } from "../../../i18n";
import { ConfigHeader } from "../components/ConfigHeader";

interface DayTokens {
  day: string;
  promptTokens: number;
  generatedTokens: number;
}

interface ModelTokens {
  model: string;
  promptTokens: number;
  generatedTokens: number;
}

const HEATMAP_WEEKS = 53;

// Flat neutral fills at rising foreground opacity. No gradients, no hover
// effects: values are revealed through the native title tooltip.
const LEVEL_ALPHA = [0.08, 0.24, 0.44, 0.66, 0.9];

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface HeatCell {
  date: string;
  tokens: number;
  level: number;
  future: boolean;
}

function buildHeatmap(days: DayTokens[]): {
  weeks: HeatCell[][];
  maxTokens: number;
} {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const mondayOffset = (base.getDay() + 6) % 7;
  const since = new Date(base);
  since.setDate(base.getDate() - mondayOffset - 7 * (HEATMAP_WEEKS - 1));

  const maxTokens = days.reduce(
    (m, d) => Math.max(m, d.promptTokens + d.generatedTokens),
    0,
  );

  const weeks: HeatCell[][] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const column: HeatCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const cellDate = new Date(since);
      cellDate.setDate(since.getDate() + w * 7 + dow);
      const key = dateKey(cellDate);
      const stat = byDay.get(key);
      const tokens = stat ? stat.promptTokens + stat.generatedTokens : 0;
      let level = 0;
      if (tokens > 0 && maxTokens > 0) {
        level = 1 + Math.min(3, Math.floor((tokens / maxTokens) * 4));
      }
      column.push({ date: key, tokens, level, future: cellDate > today });
    }
    weeks.push(column);
  }
  return { weeks, maxTokens };
}

function Heatmap({ days }: { days: DayTokens[] }) {
  const { t } = useI18n();
  const { weeks } = useMemo(() => buildHeatmap(days), [days]);

  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date} · ${cell.tokens.toLocaleString()} tokens`}
                className="h-[11px] w-[11px] rounded-[2px]"
                style={{
                  backgroundColor: cell.future
                    ? "transparent"
                    : `color-mix(in srgb, var(--vscode-editor-foreground) ${LEVEL_ALPHA[cell.level] * 100}%, transparent)`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="text-description-muted mt-1 flex items-center gap-1 text-xs">
        <span>{t("stats.less")}</span>
        {LEVEL_ALPHA.map((alpha) => (
          <div
            key={alpha}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{
              backgroundColor: `color-mix(in srgb, var(--vscode-editor-foreground) ${alpha * 100}%, transparent)`,
            }}
          />
        ))}
        <span>{t("stats.more")}</span>
      </div>
    </div>
  );
}

export function UsageStatsSection() {
  const { t } = useI18n();
  const ideMessenger = useContext(IdeMessengerContext);
  const [days, setDays] = useState<DayTokens[]>([]);
  const [models, setModels] = useState<ModelTokens[]>([]);

  useEffect(() => {
    void ideMessenger
      .request("stats/getTokensPerDay", undefined)
      .then((result) => {
        if (result.status === "success") {
          setDays(result.content);
        }
      });
    void ideMessenger
      .request("stats/getTokensPerModel", undefined)
      .then((result) => {
        if (result.status === "success") {
          setModels(result.content);
        }
      });
  }, [ideMessenger]);

  const totalPrompt = days.reduce((sum, d) => sum + d.promptTokens, 0);
  const totalGenerated = days.reduce((sum, d) => sum + d.generatedTokens, 0);

  return (
    <div>
      <div className="flex flex-col">
        <ConfigHeader title={t("stats.title")} />
        <div className="space-y-6">
          <div>
            <Card>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-description-muted text-xs">
                    {t("stats.promptTokens")}
                  </div>
                  <div className="text-foreground mt-1 text-xl font-semibold">
                    {totalPrompt.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-description-muted text-xs">
                    {t("stats.generatedTokens")}
                  </div>
                  <div className="text-foreground mt-1 text-xl font-semibold">
                    {totalGenerated.toLocaleString()}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div>
            <ConfigHeader title={t("stats.heatmap")} variant="sm" />
            <Card>
              {days.length > 0 ? (
                <Heatmap days={days} />
              ) : (
                <div className="text-description-muted text-xs">
                  {t("stats.noData")}
                </div>
              )}
            </Card>
          </div>

          <div>
            <ConfigHeader title={t("stats.perModel")} variant="sm" />
            <Card>
              {models.length > 0 ? (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-description-muted text-left text-xs">
                      <th className="py-1 pr-2 font-medium">
                        {t("sidebar.models")}
                      </th>
                      <th className="py-1 pr-2 text-right font-medium">
                        {t("stats.promptTokens")}
                      </th>
                      <th className="py-1 text-right font-medium">
                        {t("stats.generatedTokens")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.model} className="text-xs">
                        <td className="py-1 pr-2">{model.model}</td>
                        <td className="py-1 pr-2 text-right">
                          {model.promptTokens.toLocaleString()}
                        </td>
                        <td className="py-1 text-right">
                          {model.generatedTokens.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-description-muted text-xs">
                  {t("stats.noData")}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
