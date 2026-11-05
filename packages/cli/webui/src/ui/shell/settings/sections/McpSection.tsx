import { EmptyState, mcpLabel } from "../shared.tsx";
import css from "../SettingsPage.module.css";

export interface McpSectionProps {
  entries: Array<[string, unknown]>;
  total: number;
  onClear: () => void;
}

export function McpSection({ entries, total, onClear }: McpSectionProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title={total === 0 ? "No MCP servers configured" : "No matches"}
        body={
          total === 0
            ? "Add an MCP server to the project or user settings, then refresh."
            : "Try a different name or clear the search."
        }
        onAction={onClear}
        actionLabel="Clear search"
      />
    );
  }
  return (
    <div className={css.rows}>
      {entries.map(([name, value]) => (
        <div key={name} className={css.row}>
          <span className={css.rowName}>{name}</span>
          <span className={css.rowDetail}>{mcpLabel(value)}</span>
        </div>
      ))}
    </div>
  );
}
