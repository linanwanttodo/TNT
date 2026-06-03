// TNT Tooltip 薄封装：暴露 ControlHintTooltip 形状的 props（title/shortcut/side/delayMs），
// 外观走 TNT 的 Tooltip 原语。ZCode 原版 ControlHintTooltip 基于 radix，webui 不引入 radix。
import type { AnchorHTMLAttributes, ReactElement } from "react";
import { Tooltip } from "../../primitives/Tooltip.tsx";

interface TooltipShellProps {
  title: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
  /** The trigger: one anchor element, which the primitive clones to attach handlers. */
  children: ReactElement<AnchorHTMLAttributes<HTMLAnchorElement>>;
}

export function ControlHintTooltip({
  title,
  shortcut,
  side = "bottom",
  delayMs,
  children,
}: TooltipShellProps) {
  return (
    <Tooltip
      label={title}
      shortcutKeys={shortcut ? [shortcut] : undefined}
      side={side}
      delayMs={delayMs}
    >
      {children}
    </Tooltip>
  );
}
