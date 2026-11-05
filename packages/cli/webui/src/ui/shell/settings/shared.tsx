import type { ReactNode } from "react";

import css from "./SettingsPage.module.css";

export function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={css.settingsGroup}>
      <h2 className={css.groupTitle}>{title}</h2>
      <div className={css.facts}>{children}</div>
    </section>
  );
}

export function Fact({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className={css.fact}>
      <span className={css.factLabel}>{label}</span>
      <span className={css.factValue} title={value}>
        {value || "—"}
      </span>
      {hint ? <span className={css.factHint}>{hint}</span> : null}
      {action ? <span className={css.factAction}>{action}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  onAction,
  actionLabel,
}: {
  title: string;
  body: string;
  onAction: () => void;
  actionLabel: string;
}) {
  return (
    <div className={css.empty}>
      <h3 className={css.emptyTitle}>{title}</h3>
      <p className={css.emptyBody}>{body}</p>
      <button type="button" className={css.secondaryAction} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

export function ContributionList({
  items,
  emptyTitle,
  emptyBody,
  onClear,
}: {
  items: Array<{ name: string; description: string; plugin: string }>;
  emptyTitle: string;
  emptyBody: string;
  onClear: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        body={emptyBody}
        onAction={onClear}
        actionLabel="Clear search"
      />
    );
  }
  return (
    <div className={css.rows}>
      {items.map((item) => (
        <div key={`${item.plugin}:${item.name}`} className={css.row}>
          <span className={css.rowName}>{item.name}</span>
          {item.plugin ? (
            <span className={css.rowBadge}>{item.plugin}</span>
          ) : null}
          <span className={css.rowDetail}>{item.description}</span>
        </div>
      ))}
    </div>
  );
}

export function mcpLabel(value: unknown): string {
  if (value === null || value === undefined) return "configured";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as { url?: unknown; command?: unknown };
    if (typeof record.url === "string") return record.url;
    if (typeof record.command === "string") {
      const args = (value as { args?: unknown }).args;
      return Array.isArray(args)
        ? [
            record.command,
            ...args.filter((arg) => typeof arg === "string"),
          ].join(" ")
        : record.command;
    }
  }
  return "configured";
}
