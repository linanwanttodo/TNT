import { IndexingProgressUpdate } from "core";
import { useI18n } from "../../../../i18n";

export interface IndexingProgressSubtextProps {
  update: IndexingProgressUpdate;
  onClick: () => void;
}

const STATUS_TO_SUBTITLE_KEY: Record<
  IndexingProgressUpdate["status"],
  string | undefined
> = {
  done: "indexing.action.reindex",
  loading: "indexing.action.none",
  waiting: "indexing.action.none",
  indexing: "indexing.action.pause",
  paused: "indexing.action.resume",
  failed: "indexing.action.retry",
  disabled: "indexing.action.openConfig",
  cancelled: "indexing.action.restart",
};

function IndexingProgressSubtext({
  update,
  onClick,
}: IndexingProgressSubtextProps) {
  const { t } = useI18n();
  const showIndexingDesc = update.status === "indexing";

  return (
    <div className="flex justify-between">
      <span
        className={`text-lightgray inline-block cursor-pointer text-xs underline`}
        onClick={onClick}
      >
        {t(STATUS_TO_SUBTITLE_KEY[update.status] ?? "indexing.action.none")}
      </span>

      <div className={`${showIndexingDesc ? "w-2/3" : "flex-1"}`}>
        {showIndexingDesc && (
          <span className="text-lightgray block truncate text-right text-xs">
            {update.desc}
          </span>
        )}
      </div>
    </div>
  );
}

export default IndexingProgressSubtext;
