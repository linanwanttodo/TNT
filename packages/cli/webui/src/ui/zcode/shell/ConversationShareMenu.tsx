import { ShareIcon } from "lucide-react";
import { ControlHintTooltip } from "./Tooltip.tsx";
import { cn } from "../lib/utils.ts";
import { Button } from "./button.tsx";
import { useZCodeIntl } from "../i18n.ts";
import { useConversationShareSelectionStore } from "../lib/headerBridge.tsx";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "../lib/windowCaptionControls.ts";

export function ConversationShareMenu({
  taskId,
  useWindowsCaptionSpacing = false,
}: {
  taskId: string;
  useWindowsCaptionSpacing?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const openShare = useConversationShareSelectionStore(
    (state) => state.openShare,
  );
  const closeShare = useConversationShareSelectionStore(
    (state) => state.closeShare,
  );
  const publishing = useConversationShareSelectionStore(
    (state) => state.dockStates[taskId]?.publishing ?? false,
  );
  const active = useConversationShareSelectionStore(
    (state) => state.drafts[taskId]?.open ?? false,
  );
  const handleClick = () => {
    if (publishing) return;
    if (active) closeShare(taskId);
    else openShare(taskId);
  };

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      // 分享曾使用更大的热区和独立 mask 缩放；复用相邻工具栏按钮的尺寸与图标规范。
      size="icon-md"
      className={cn(
        "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
        useWindowsCaptionSpacing ? "ml-3" : "ml-2.5",
        useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
        active && "bg-selected",
      )}
      aria-label={intl.formatMessage({ id: "conversationShare.trigger" })}
      data-testid="conversation-share-trigger"
      data-share-session={taskId}
      aria-pressed={active}
      disabled={publishing}
      onClick={handleClick}
    >
      <ShareIcon className="size-4" />
    </Button>
  );

  return active ? (
    trigger
  ) : (
    <ControlHintTooltip
      title={intl.formatMessage({ id: "conversationShare.trigger" })}
      side="bottom"
    >
      {trigger}
    </ControlHintTooltip>
  );
}
