import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";
import { isAppleKeyboardPlatform } from "../lib/keyboardShortcuts.ts";

export function ControlShortcutBadge({
  className,
  style,
  ...props
}: ComponentProps<"kbd">) {
  const apple = isAppleKeyboardPlatform();
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-tooltip-tag text-ui-xs text-tooltip-tag-foreground inline-flex h-4 shrink-0 items-center rounded-md px-1.5 font-medium",
        apple ? "tracking-normal" : "font-mono",
        className,
      )}
      style={{
        ...(apple
          ? {
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif',
            }
          : {}),
        ...style,
      }}
      {...props}
    />
  );
}
