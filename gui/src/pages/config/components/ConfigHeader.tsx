import { PlusIcon } from "@heroicons/react/24/outline";
import { ToolTip } from "../../../components/gui/Tooltip";
import { Button } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import { cn } from "../../../util/cn";

interface ConfigHeaderProps {
  title: string;
  subtext?: string;
  onAddClick?: () => void;
  addButtonTooltip?: string;
  /** Text for a labelled add button; without it only the icon is shown. */
  addButtonLabel?: string;
  className?: string;
  variant?: "default" | "sm";
  showAddButton?: boolean;
}

export function ConfigHeader({
  title,
  subtext,
  onAddClick,
  addButtonTooltip,
  addButtonLabel,
  className = "",
  variant = "default",
  showAddButton = true,
}: ConfigHeaderProps) {
  const { t } = useI18n();
  const isSmall = variant === "sm";
  const marginBottom = isSmall ? "mb-3" : "mb-5";
  const titleSize = isSmall
    ? "text-xs font-medium tracking-wide uppercase"
    : "text-xl font-semibold";
  const HeadingTag = isSmall ? "h3" : "h2";

  return (
    <div
      className={cn(
        `${marginBottom} flex items-center justify-between`,
        className,
      )}
    >
      <div className="flex flex-col">
        <HeadingTag
          className={cn("my-0", titleSize, isSmall && "text-description-muted")}
        >
          {title}
        </HeadingTag>
        {subtext && (
          <p className="text-description-muted mt-1 text-sm">{subtext}</p>
        )}
      </div>
      {showAddButton && onAddClick && (
        <ToolTip content={addButtonTooltip ?? t("config.addItem")}>
          {addButtonLabel ? (
            // A labelled button makes the action self-explanatory instead of
            // relying on a bare icon the user has to discover.
            <Button
              onClick={onAddClick}
              variant="secondary"
              size={isSmall ? "sm" : "lg"}
              className="flex items-center gap-1.5"
            >
              <PlusIcon className={isSmall ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
              <span className={isSmall ? "text-xs" : "text-sm"}>
                {addButtonLabel}
              </span>
            </Button>
          ) : (
            <Button
              onClick={onAddClick}
              variant="icon"
              size={isSmall ? "sm" : "lg"}
            >
              <PlusIcon className={isSmall ? "h-2.5 w-2.5" : "h-3 w-3"} />
            </Button>
          )}
        </ToolTip>
      )}
    </div>
  );
}
