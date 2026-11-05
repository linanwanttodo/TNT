import type {
  ChatModelOption,
  ModelsResponse,
} from "../../../../api/client.js";
import { EmptyState } from "../shared.tsx";
import css from "../SettingsPage.module.css";

export interface ModelsSectionProps {
  models: ModelsResponse | null;
  onUse: (index: number) => void;
  onRetry: () => void;
}

export function ModelsSection({ models, onUse, onRetry }: ModelsSectionProps) {
  if (models === null) {
    return <div className={css.loading}>Loading models...</div>;
  }
  if (models.models.length === 0) {
    return (
      <EmptyState
        title="No models available"
        body="Add a model to ~/.tnt/config.yaml, then retry."
        onAction={onRetry}
        actionLabel="Retry"
      />
    );
  }
  return (
    <div className={css.rows}>
      {models.models.map((model) => (
        <ModelRow
          key={`${model.provider}:${model.index}`}
          model={model}
          onUse={onUse}
        />
      ))}
    </div>
  );
}

function ModelRow({
  model,
  onUse,
}: {
  model: ChatModelOption;
  onUse: (index: number) => void;
}) {
  return (
    <div className={css.row} data-current={model.current}>
      <span className={css.rowName}>{model.name}</span>
      <span className={css.rowBadge}>{model.provider}</span>
      <span className={css.rowDetail}>
        {model.current ? "Current model" : ""}
      </span>
      {!model.current ? (
        <button
          type="button"
          className={css.secondaryAction}
          onClick={() => onUse(model.index)}
        >
          Use
        </button>
      ) : null}
    </div>
  );
}
