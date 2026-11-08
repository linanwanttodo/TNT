import type { ComponentProps } from "react";
import { cn } from "../lib/utils.js";

const ALERT_VARIANTS = {
  default: "border-card-border bg-card text-foreground",
  warning:
    "border-warning/40 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning *:[svg]:text-current",
  destructive:
    "border-destructive bg-destructive text-destructive-foreground *:data-[slot=alert-description]:text-destructive-foreground/90 *:[svg]:text-current",
} as const;

export function Alert({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: keyof typeof ALERT_VARIANTS }) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(
        "group/alert text-ui-base/relaxed has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-3.5 relative grid w-full gap-0.5 rounded-lg border px-2 py-1.5 text-left has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-1.5",
        ALERT_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "[&_a]:underline-offset-3 [&_a]:hover:text-foreground font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline",
        className,
      )}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-ui-base/relaxed text-foreground-subtle [&_a]:underline-offset-3 [&_a]:hover:text-foreground text-balance md:text-pretty [&_a]:underline [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

export function AlertAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute right-2 top-1.5", className)}
      {...props}
    />
  );
}
