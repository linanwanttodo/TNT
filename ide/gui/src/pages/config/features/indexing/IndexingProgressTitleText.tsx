import { IndexingProgressUpdate } from "core";
import { useI18n } from "../../../../i18n";
import { AnimatedEllipsis } from "../../../../components/AnimatedEllipsis";

export interface IndexingProgressTitleTextProps {
  update: IndexingProgressUpdate;
}

const STATUS_TO_KEY: Record<
  IndexingProgressUpdate["status"],
  | "indexing.status.done"
  | "indexing.status.loading"
  | "indexing.status.waiting"
  | "indexing.status.indexing"
  | "indexing.status.paused"
  | "indexing.status.failed"
  | "indexing.status.disabled"
  | "indexing.status.cancelled"
> = {
  done: "indexing.status.done",
  loading: "indexing.status.loading",
  waiting: "indexing.status.waiting",
  indexing: "indexing.status.indexing",
  paused: "indexing.status.paused",
  failed: "indexing.status.failed",
  disabled: "indexing.status.disabled",
  cancelled: "indexing.status.cancelled",
};

function IndexingProgressTitleText({ update }: IndexingProgressTitleTextProps) {
  const { t } = useI18n();
  const showEllipsis = update.status === "loading";

  return (
    <span>
      {t(STATUS_TO_KEY[update.status])}
      {showEllipsis && <AnimatedEllipsis />}
    </span>
  );
}

export default IndexingProgressTitleText;
