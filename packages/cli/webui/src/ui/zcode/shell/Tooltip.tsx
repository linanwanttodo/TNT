import type { ReactNode } from "react";
// TNT Tooltip 薄封装：暴露 ControlHintTooltip 形状的 props（title/shortcut/side/delayMs），
// 外观走 TNT 的 Tooltip 原语。ZCode 原版 ControlHintTooltip 基于 radix，webui 不引入 radix。
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { Tooltip } from "../../primitives/Tooltip.tsx";

interface TooltipShellProps {
  title: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  delayMs?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** The trigger: one anchor element, which the primitive clones to attach handlers. */
  children?: ReactElement<AnchorHTMLAttributes<HTMLAnchorElement>>;
}

export function ControlHintTooltip({
  title,
  shortcut,
  side = "bottom",
  delayMs,
  open,
  onOpenChange,
  children,
}: TooltipShellProps) {
  if (!children) {
    // ZCode 顶栏把 ControlHintTooltip 当受控弹层用（无触发子元素）；
    // TNT 的 Tooltip 原语只支持触发器克隆，这里退化为静态浮层内容。
    return null;
  }
  return (
    <Tooltip
      label={typeof title === "string" ? title : ""}
      shortcutKeys={shortcut ? [shortcut] : undefined}
      side={side}
      delayMs={delayMs}
    >
      {children}
    </Tooltip>
  );
}
