import type { ContextBreakdown } from "../../api/client.js";
import { useUiPreferences } from "../../stores/ui-preferences.js";
import css from "./ContextView.module.css";

function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

export function ContextView({ context }: { context: ContextBreakdown | null }) {
  const language = useUiPreferences((state) => state.language);
  if (!context) {
    return (
      <div className={css.frame}>
        <div className={css.muted}>
          {language === "zh" ? "上下文不可用" : "Context unavailable"}
        </div>
      </div>
    );
  }
  const rows: Array<[string, number]> = [
    [
      language === "zh" ? "系统提示词" : "System prompt",
      context.categories.systemPrompt,
    ],
    [language === "zh" ? "工具定义" : "Tools", context.categories.tools],
    [
      language === "zh" ? "对话消息" : "Conversation",
      context.categories.conversation,
    ],
    [
      language === "zh" ? "工具结果" : "Tool results",
      context.categories.toolResults,
    ],
    [
      language === "zh" ? "上下文条目" : "Context items",
      context.categories.contextItems,
    ],
  ];
  return (
    <div className={css.frame}>
      <div className={css.header}>
        <span>{language === "zh" ? "上下文已用" : "Context used"}</span>
        <span>
          {Math.round(context.percentUsed)}% · {compact(context.usedTokens)} /{" "}
          {compact(context.contextLimit)}
        </span>
      </div>
      <div className={css.bar}>
        <span style={{ width: `${Math.min(100, context.percentUsed)}%` }} />
      </div>
      <div className={css.rows}>
        {rows.map(([label, tokens]) => (
          <div className={css.row} key={label}>
            <span>{label}</span>
            <span>{compact(tokens)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
