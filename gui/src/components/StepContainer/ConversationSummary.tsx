import { TrashIcon } from "@heroicons/react/24/outline";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/solid";
import { ChatHistoryItem } from "core";
import { useState } from "react";
import { useI18n } from "../../i18n";
import { useAppSelector } from "../../redux/hooks";
import { useDeleteCompaction } from "../../util/compactConversation";
import { AnimatedEllipsis } from "../AnimatedEllipsis";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import StyledMarkdownPreview from "../StyledMarkdownPreview";

interface ConversationSummaryProps {
  item: ChatHistoryItem;
  index: number;
}

export default function ConversationSummary(props: ConversationSummaryProps) {
  const [open, setOpen] = useState(true);
  const { t } = useI18n();
  const isLoading = useAppSelector(
    (state) => state.session.compactionLoading[props.index] || false,
  );
  const deleteCompaction = useDeleteCompaction();

  if (!props.item.conversationSummary && !isLoading) {
    return null;
  }

  // Loading state - much simpler
  if (isLoading) {
    return (
      <div className="mb-4 mt-2">
        <div className="text-description flex items-center justify-start text-xs">
          <span>{t("context.compactInProgress")}</span>
          <AnimatedEllipsis />
        </div>
      </div>
    );
  }

  // Normal state with content
  return (
    <div className="mb-4 mt-2">
      <div className="border-border border-t border-solid"></div>
      <div
        className="text-description flex cursor-pointer items-center gap-2 pt-2 text-xs"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronUpIcon className="h-3 w-3" />
        ) : (
          <ChevronDownIcon className="h-3 w-3" />
        )}
        <span className="flex-1">{t("context.summaryBoundary")}</span>
        <HeaderButtonWithToolTip
          text={t("context.deleteSummary")}
          onClick={(e) => {
            e.stopPropagation();
            deleteCompaction(props.index);
          }}
        >
          <TrashIcon className="text-description-muted h-3 w-3" />
        </HeaderButtonWithToolTip>
      </div>
      {open && (
        <div className="pt-1">
          <StyledMarkdownPreview
            isRenderingInStepContainer
            source={props.item.conversationSummary}
            itemIndex={props.index}
            useParentBackgroundColor
          />
        </div>
      )}
    </div>
  );
}
