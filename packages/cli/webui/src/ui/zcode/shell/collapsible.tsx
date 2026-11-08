"use client";
import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
} from "react";
import { cn } from "../lib/utils.js";

type Ctx = { open: boolean; setOpen: (open: boolean) => void };
const CollapsibleContext = createContext<Ctx | null>(null);
function useCollapsible() {
  const context = useContext(CollapsibleContext);
  if (!context)
    throw new Error("Collapsible components must be used within Collapsible");
  return context;
}

export type CollapsibleProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Collapsible({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div
        data-slot="collapsible"
        data-state={open ? "open" : "closed"}
        className={className}
        {...props}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

export type CollapsibleTriggerProps = ComponentProps<"button">;

export function CollapsibleTrigger({
  className,
  children,
  onClick,
  ...props
}: CollapsibleTriggerProps) {
  const { open, setOpen } = useCollapsible();
  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      data-state={open ? "open" : "closed"}
      aria-expanded={open}
      className={className}
      onClick={(event) => {
        setOpen(!open);
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export type CollapsibleContentProps = ComponentProps<"div"> & {
  forceMount?: boolean;
};

export function CollapsibleContent({
  className,
  children,
  forceMount,
  ...props
}: CollapsibleContentProps) {
  const { open } = useCollapsible();
  if (!open && !forceMount) return null;
  return (
    <div
      data-slot="collapsible-content"
      data-state={open ? "open" : "closed"}
      className={cn(
        "overflow-hidden",
        "data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up transition-none duration-300 ease-in-out data-[state=closed]:[animation-fill-mode:forwards]",
        "data-[state=open]:[&>div]:animate-in data-[state=open]:[&>div]:fade-in-0",
        "data-[state=closed]:[&>div]:animate-out data-[state=closed]:[&>div]:fade-out-0 data-[state=closed]:[&>div]:[animation-fill-mode:forwards]",
        className,
      )}
      {...props}
    >
      <div className="transition-none duration-300 ease-in-out">{children}</div>
    </div>
  );
}
