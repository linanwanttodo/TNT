// ZCode 原版 packages/ui/src/components/ui/button.tsx 的 variant/size 类串复刻
// （webui 不引入 cva，直接写死 ghost / icon-md / default 的精确类串，数值照抄）。
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

const VARIANT_CLASSES = {
  default: "bg-primary text-primary-foreground hover:bg-primary/80",
  outline:
    "border-border text-foreground hover:border-border-hover hover:bg-input/50 hover:text-foreground aria-expanded:bg-input/50 aria-expanded:text-foreground",
  secondary:
    "bg-secondary text-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-foreground",
  ghost:
    "text-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
} as const;

const SIZE_CLASSES = {
  default:
    "h-7 gap-1 px-2 text-ui-base has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
  sm: "h-6 gap-1 px-2 text-ui-base/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
  "icon-md": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-4",
} as const;

export interface ZCodeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT_CLASSES;
  size?: keyof typeof SIZE_CLASSES;
}

export const Button = forwardRef<HTMLButtonElement, ZCodeButtonProps>(
  function Button(
    { variant = "default", size = "default", className, type, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
        {...props}
      />
    );
  },
);
