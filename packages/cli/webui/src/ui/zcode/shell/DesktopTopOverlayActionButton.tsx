// ZCode 原版 packages/ui/src/DesktopTopOverlayActionButton.tsx 逐字搬运。
// 适配：Button 用 ./button.tsx（复现 ghost/icon-md 精确类串）；ControlHintTooltip 用
// 同目录 Tooltip.tsx（TNT Tooltip 薄封装）；ZCode 原版基于 radix，webui 不引入 radix。
import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { ControlHintTooltip } from "./Tooltip.js";

interface DesktopTopOverlayActionButtonProps {
  title: string;
  ariaLabel: string;
  children: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  side?: "top" | "bottom" | "left" | "right";
  buttonClassName?: string;
  testId?: string;
}

export function DesktopTopOverlayActionButton({
  title,
  ariaLabel,
  children,
  shortcut,
  disabled,
  onClick,
  onMouseEnter,
  side = "bottom",
  buttonClassName,
  testId,
}: DesktopTopOverlayActionButtonProps) {
  return (
    <ControlHintTooltip title={title} shortcut={shortcut} side={side}>
      <button
        type="button"
        className={cn(
          // ZCode Button ghost + icon-md 精确类串
          "text-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
          "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-4",
          "transition-colors [app-region:no-drag]",
          buttonClassName,
        )}
        aria-label={ariaLabel}
        data-testid={testId}
        disabled={disabled}
        // 顶部浮层的新建任务入口会复用带可选 provider 参数的业务函数。
        // 如果直接交给 React onClick，MouseEvent 会被当成 provider 传下去，并在日志 IPC 克隆时抛错。
        // 这里统一丢弃 DOM 事件，只调用组件约定的无参动作。
        onClick={() => onClick()}
      >
        {children}
      </button>
    </ControlHintTooltip>
  );
}
