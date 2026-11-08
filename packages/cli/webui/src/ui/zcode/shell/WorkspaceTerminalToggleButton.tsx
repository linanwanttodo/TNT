import { TID_TERMINAL_TOGGLE } from "../lib/headerBridge.tsx";
import { SquareTerminalIcon } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { Button } from "./button.tsx";
import { ControlHintTooltip } from "./Tooltip.tsx";
import { useZCodeIntl } from "../i18n.ts";
import { useShortcutCommandLabel } from "../lib/headerBridge.tsx";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "../lib/windowCaptionControls.ts";
import { runUserAction } from "../lib/headerBridge.tsx";
import { useIsOfficeMode } from "../lib/headerBridge.tsx";

export function WorkspaceTerminalToggleButton({
  isTerminalOpen,
  onToggleTerminal,
  disabledReason,
  useWindowsCaptionSpacing = false,
}: {
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  disabledReason?: string;
  useWindowsCaptionSpacing?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const label = intl.formatMessage({ id: "terminal.toggle" });
  // 展示 label 从快捷键生效表取，用户改键后 tooltip 跟随更新
  const toggleTerminalShortcutLabel = useShortcutCommandLabel("toggleTerminal");

  if (isOfficeMode) return null;

  return (
    <ControlHintTooltip
      title={disabledReason ?? label}
      side="bottom"
      shortcut={toggleTerminalShortcutLabel}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-md"
        data-testid={TID_TERMINAL_TOGGLE}
        className={cn(
          "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
          useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
          isTerminalOpen && "!bg-selected text-foreground",
        )}
        aria-label={label}
        disabled={Boolean(disabledReason)}
        onClick={() =>
          runUserAction({
            input: {
              featureId: "workbench.terminal",
              action: isTerminalOpen ? "close" : "open",
              trigger: "button",
            },
            operation: onToggleTerminal,
            completed: { resultSource: "local_commit" },
            failureStage: "terminal_toggle",
          })
        }
      >
        <SquareTerminalIcon className="size-4" />
      </Button>
    </ControlHintTooltip>
  );
}
