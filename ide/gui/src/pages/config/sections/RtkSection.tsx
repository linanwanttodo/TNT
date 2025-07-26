import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useContext, useCallback, useEffect, useState } from "react";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useI18n } from "../../../i18n";
import { ConfigHeader } from "../components/ConfigHeader";

interface RtkDay {
  date: string;
  commands: number;
  input: number;
  saved: number;
  pct: number;
}

interface RtkGainView {
  installed: boolean;
  version?: string;
  latest?: string;
  summary?: { commands: number; input: number; saved: number; pct: number };
  days?: RtkDay[];
  installCommand?: string;
  upgradeCommand?: string;
  upgradeNote?: string;
  error?: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}

export function RtkSection() {
  const { t } = useI18n();
  const ideMessenger = useContext(IdeMessengerContext);
  const [view, setView] = useState<RtkGainView | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"install" | "upgrade" | undefined>(
    undefined,
  );

  const refresh = useCallback(() => {
    setLoading(true);
    void ideMessenger
      .request("rtk/getGain", undefined)
      .then((result) => {
        if (result.status === "success") {
          setView(result.content);
        }
      })
      .finally(() => setLoading(false));
  }, [ideMessenger]);

  const runAction = useCallback(
    (kind: "install" | "upgrade") => {
      setBusy(kind);
      void ideMessenger
        .request(kind === "install" ? "rtk/install" : "rtk/upgrade", undefined)
        .then((result) => {
          if (result.status === "success") {
            setView(result.content);
          }
        })
        .finally(() => setBusy(undefined));
    },
    [ideMessenger],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const summary = view?.summary;
  const days = view?.days ?? [];

  return (
    <div>
      <div className="flex flex-col">
        <ConfigHeader title={t("rtk.title")} />
        <div className="space-y-6">
          <div>
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-description-muted text-xs">
                  {t("rtk.description")}
                </div>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  className="text-description-muted flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs"
                >
                  <ArrowPathIcon
                    className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                  {t("rtk.refresh")}
                </button>
              </div>

              {!view ? (
                <div className="text-description-muted mt-2 text-xs">
                  {t("stats.noData")}
                </div>
              ) : !view.installed ? (
                <div className="mt-2">
                  <div className="text-description-muted text-xs">
                    {t("rtk.notInstalled")}
                  </div>
                  {view.installCommand && (
                    <>
                      <code className="border-border mt-2 block overflow-x-auto rounded border p-2 text-xs">
                        {view.installCommand}
                      </code>
                      <button
                        type="button"
                        onClick={() => runAction("install")}
                        disabled={busy !== undefined}
                        className="border-border mt-2 cursor-pointer rounded border bg-transparent px-3 py-1 text-xs"
                      >
                        {busy === "install"
                          ? t("rtk.installing")
                          : t("rtk.install")}
                      </button>
                    </>
                  )}
                  {view.error && (
                    <div className="text-warning mt-2 text-xs">
                      {view.error}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="text-description-muted mt-1 text-xs">
                    {view.version
                      ? `${t("rtk.versionLabel")} ${view.version}`
                      : ""}
                    {view.latest && view.upgradeCommand && (
                      <button
                        type="button"
                        onClick={() => runAction("upgrade")}
                        disabled={busy !== undefined}
                        className="border-border ml-2 cursor-pointer rounded border bg-transparent px-2 py-0.5 text-xs"
                      >
                        {busy === "upgrade"
                          ? t("rtk.upgrading")
                          : `${t("rtk.upgrade")} (${view.latest})`}
                      </button>
                    )}
                  </div>
                  {view.upgradeNote && (
                    <div className="text-description-muted mt-1 text-xs">
                      {view.upgradeNote}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-4 gap-3">
                    <div>
                      <div className="text-description-muted text-xs">
                        {t("rtk.commands")}
                      </div>
                      <div className="text-foreground mt-1 text-lg font-semibold">
                        {summary ? summary.commands.toLocaleString() : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-description-muted text-xs">
                        {t("rtk.inputTokens")}
                      </div>
                      <div className="text-foreground mt-1 text-lg font-semibold">
                        {summary ? formatTokens(summary.input) : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-description-muted text-xs">
                        {t("rtk.savedTokens")}
                      </div>
                      <div className="text-foreground mt-1 text-lg font-semibold">
                        {summary ? formatTokens(summary.saved) : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-description-muted text-xs">
                        {t("rtk.savingsRate")}
                      </div>
                      <div className="text-foreground mt-1 text-lg font-semibold">
                        {summary ? `${summary.pct.toFixed(1)}%` : "-"}
                      </div>
                    </div>
                  </div>
                  {view.error && (
                    <div className="text-warning mt-2 text-xs">
                      {view.error}
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>

          {days.length > 0 && (
            <div>
              <ConfigHeader title={t("rtk.recentDays")} variant="sm" />
              <Card>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-description-muted text-left text-xs">
                      <th className="py-1 pr-2 font-medium">{t("rtk.date")}</th>
                      <th className="py-1 pr-2 text-right font-medium">
                        {t("rtk.commands")}
                      </th>
                      <th className="py-1 pr-2 text-right font-medium">
                        {t("rtk.inputTokens")}
                      </th>
                      <th className="py-1 text-right font-medium">
                        {t("rtk.savedTokens")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...days]
                      .slice(-14)
                      .reverse()
                      .map((d) => (
                        <tr key={d.date} className="text-xs">
                          <td className="py-1 pr-2">{d.date}</td>
                          <td className="py-1 pr-2 text-right">
                            {d.commands.toLocaleString()}
                          </td>
                          <td className="py-1 pr-2 text-right">
                            {formatTokens(d.input)}
                          </td>
                          <td className="py-1 text-right">
                            {formatTokens(d.saved)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
