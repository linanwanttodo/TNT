import React from "react";
import { Button } from "../../../components/ui/Button";
import { cn } from "../../../util/cn";

export interface ConfigRowProps {
  title: string;
  description: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function ConfigRow({
  title,
  description,
  icon: Icon,
  onClick,
  disabled = false,
  children,
  className = "",
}: ConfigRowProps) {
  const baseClasses = "flex items-start justify-between px-4 py-2.5";
  const interactiveClasses = onClick ? "cursor-pointer" : "";
  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : "";

  const handleClick = (event: React.MouseEvent) => {
    if (!disabled && onClick) {
      const target = event.target as HTMLElement;
      const isInteractiveChild = target.closest(
        'button, input, textarea, select, [role="button"], [role="switch"]',
      );

      if (
        !isInteractiveChild ||
        target.closest("[data-config-row]") === event.currentTarget
      ) {
        onClick();
      }
    }
  };

  if (onClick) {
    return (
      <Button
        variant="ghost"
        className={cn(
          baseClasses,
          interactiveClasses,
          disabledClasses,
          "!my-0 text-left",
          className,
        )}
        onClick={handleClick}
        disabled={disabled}
        data-config-row
      >
        <div className="flex flex-col">
          <span className="text-sm font-medium">{title}</span>
          <p className="text-description-muted mt-0.5 text-xs">{description}</p>
        </div>
        <div className="flex items-center gap-4">
          {children}
          {Icon && (
            <Icon className="text-description-muted h-5 w-5 flex-shrink-0" />
          )}
        </div>
      </Button>
    );
  }

  return (
    <div
      className={cn(baseClasses, disabledClasses, className)}
      data-config-row
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <p className="text-description-muted mt-0.5 text-xs">{description}</p>
      </div>
      <div className="flex items-center gap-4">
        {children}
        {Icon && (
          <Icon className="text-description-muted h-5 w-5 flex-shrink-0" />
        )}
      </div>
    </div>
  );
}
