"use client";

// ZCode 原版 `components/ai-elements/chat-loading.tsx` 逐字搬运；
// 仅适配了三处：import 路径（cn / workDuration / i18n）、i18n 文案层（TNT webui 无
// IntlProvider，用 src/ui/zcode/i18n.ts 的同名 useZCodeIntl 兜底）。
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "../zcode/lib/utils.js";
import { formatRunningWorkDuration } from "../zcode/lib/workDuration.js";
import { useZCodeIntl } from "../zcode/i18n.js";

export interface ChatLoadingProps extends ComponentPropsWithoutRef<"div"> {
  loading: boolean;
  initialElapsedMs?: number;
  size?: "default" | "sm";
}

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];

export function ChatLoadingPixels() {
  return (
    <span
      aria-hidden="true"
      className="text-foreground grid size-[13px] shrink-0 grid-cols-3 grid-rows-3 gap-[1.3px]"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className="zcode-loading-pixel size-full rounded-[1px] bg-current"
          style={{
            opacity: index === 4 ? 0.07 : 0.15,
            animationName: index === 4 ? "none" : undefined,
            animationDuration: "950ms",
            animationDelay: `${Math.max(0, ORBIT_ORDER.indexOf(index)) * 110}ms`,
          }}
        />
      ))}
    </span>
  );
}

export function ChatLoading({
  loading,
  initialElapsedMs = 0,
  className,
  size: _size,
  ...props
}: ChatLoadingProps) {
  const { intl, locale } = useZCodeIntl();
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);
  useEffect(() => {
    if (!loading) return;
    // 本轮已有耗时作为起点；独立刷新小组件，避免整个对话每 100ms 重渲染。
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedMs(initialElapsedMs + performance.now() - started);
    }, 100);
    return () => window.clearInterval(timer);
  }, [loading, initialElapsedMs]);
  if (!loading) return null;
  return (
    <div
      role="status"
      aria-label={intl.formatMessage({ id: "common.loading" })}
      data-zcode-chat-loading-animate="true"
      {...props}
      className={cn("inline-flex w-fit items-center gap-2.5", className)}
    >
      <ChatLoadingPixels />
      <span className="zcode-loading-label text-ui-base font-medium">
        {intl.formatMessage({ id: "chat.loading.working" })}
      </span>
      <span
        aria-hidden="true"
        className="text-ui-caption text-foreground-subtle font-mono tabular-nums"
      >
        {formatRunningWorkDuration(
          elapsedMs,
          (descriptor) => intl.formatMessage(descriptor),
          locale,
        )}
      </span>
    </div>
  );
}
