import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button.js";

export function useCodingPlanEntryGate() {
  return {
    status: "ready" as const,
    label: undefined,
    retry: () => undefined,
  };
}

export function CodingPlanEntryButton({
  children,
  disabled,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { bypassGate?: boolean }) {
  return (
    <Button {...props} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
