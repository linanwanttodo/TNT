import { ContextTokenBreakdown } from "core";
import { useMemo } from "react";
import { useI18n } from "../../i18n/index.tsx";
import { useAppDispatch, useAppSelector } from "../../redux/hooks.ts";
import { saveCurrentSession } from "../../redux/thunks/session.ts";
import { useCompactConversation } from "../../util/compactConversation.ts";
import { Popover, PopoverButton, PopoverPanel } from "../ui/index.ts";

interface Segment {
  key: string;
  label: string;
  tokens: number;
  color: string;
}

export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return `${Math.max(0, Math.round(tokens))}`;
}

function ContextUsage() {
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const contextPercentage = useAppSelector(
    (state) => state.session.contextPercentage,
  );
  const breakdown = useAppSelector((state) => state.session.contextBreakdown);
  const isPruned = useAppSelector((state) => state.session.isPruned);
  const historyLength = useAppSelector((state) => state.session.history.length);

  const compactConversation = useCompactConversation();

  const allSegments = useMemo<Segment[]>(() => {
    if (!breakdown) {
      return [];
    }
    return [
      {
        key: "systemPrompt",
        label: t("context.systemPrompt"),
        tokens: breakdown.systemPrompt,
        color: "var(--continue-ctx-system)",
      },
      {
        key: "tools",
        label: t("context.tools"),
        tokens: breakdown.tools,
        color: "var(--continue-ctx-tools)",
      },
      {
        key: "conversation",
        label: t("context.conversation"),
        tokens: breakdown.conversation,
        color: "var(--continue-ctx-conversation)",
      },
      {
        key: "mcp",
        label: t("context.mcp"),
        tokens: breakdown.mcp,
        color: "var(--continue-ctx-mcp)",
      },
      {
        key: "skills",
        label: t("context.skills"),
        tokens: breakdown.skills,
        color: "var(--continue-ctx-skills)",
      },
    ];
  }, [breakdown, t]);

  const segments = useMemo(
    () => allSegments.filter((segment) => segment.tokens > 0),
    [allSegments],
  );

  if (typeof contextPercentage !== "number") {
    return null;
  }

  const pct = Math.round(
    Math.min(Math.max(contextPercentage ?? 0, 0), 1) * 100,
  );
  const isWarning = isPruned || (contextPercentage ?? 0) >= 0.6;

  const usedTokens = breakdown?.used ?? 0;
  const totalTokens = breakdown?.available ?? 0;
  const scale = totalTokens > 0 ? totalTokens : 1;

  const meterColor = isPruned
    ? "var(--vscode-error-foreground)"
    : isWarning
      ? "var(--vscode-editorWarning-foreground)"
      : "var(--continue-ctx-system)";

  return (
    <Popover>
      <PopoverButton
        aria-label={t("context.title")}
        className={`composer-context ${isWarning ? "composer-context-warning" : ""}`}
      >
        <span className="composer-context-meter" aria-hidden="true">
          <span
            className="composer-context-meter-fill"
            style={{ width: `${pct}%`, backgroundColor: meterColor }}
          />
        </span>
        <span>{pct}%</span>
      </PopoverButton>
      <PopoverPanel anchor="top end" className="composer-context-panel">
        <div className="text-foreground text-xs font-medium">
          {t("context.title")}
        </div>

        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-foreground text-lg font-semibold tabular-nums">
            {pct}%
          </span>
          <span className="text-description-muted text-xs tabular-nums">
            {t("context.used")} {formatContextTokens(usedTokens)}/
            {formatContextTokens(totalTokens)}
          </span>
        </div>

        <div className="mt-2 flex h-1.5 w-full gap-px overflow-hidden rounded-sm">
          {segments.length === 0 ? (
            <div className="flex-1" style={{ background: meterColor }} />
          ) : (
            segments.map((segment) => (
              <div
                key={segment.key}
                style={{
                  width: `${(segment.tokens / scale) * 100}%`,
                  backgroundColor: segment.color,
                }}
              />
            ))
          )}
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          {segments.length === 0 ? (
            <div className="text-description-muted text-xs">
              {t("context.empty")}
            </div>
          ) : (
            segments.map((segment) => (
              <div key={segment.key} className="composer-context-row">
                <span
                  className="composer-context-dot"
                  style={{ backgroundColor: segment.color }}
                  aria-hidden="true"
                />
                <span className="composer-context-label">{segment.label}</span>
                <span className="composer-context-tokens">
                  {formatContextTokens(segment.tokens)}
                </span>
                <span className="composer-context-percentage">
                  {((segment.tokens / scale) * 100).toFixed(1)}%
                </span>
              </div>
            ))
          )}
        </div>

        {isPruned && (
          <div className="text-error mt-2 text-xs">{t("context.pruned")}</div>
        )}

        {historyLength > 0 && (
          <div className="border-border mt-3 flex flex-col gap-1 border-t border-solid pt-2 text-xs">
            <button
              type="button"
              className="text-description cursor-pointer border-none bg-transparent p-0 text-left"
              onClick={() => compactConversation(historyLength - 1)}
            >
              {t("context.compact")}
            </button>
            <button
              type="button"
              className="text-description cursor-pointer border-none bg-transparent p-0 text-left"
              onClick={() => {
                void dispatch(
                  saveCurrentSession({
                    openNewSession: true,
                    generateTitle: false,
                  }),
                );
              }}
            >
              {t("context.newSession")}
            </button>
          </div>
        )}
      </PopoverPanel>
    </Popover>
  );
}

export default ContextUsage;
