import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../../../i18n";
import { useAppSelector } from "../../../../redux/hooks";
import { ToolTip } from "../../../ide/gui/Tooltip";

import { CONFIG_ROUTES } from "../../../../util/navigation";

export function BlockSettingsTopToolbar() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const configError = useAppSelector((store) => store.config.configError);

  const shouldShowError = configError && configError?.length > 0;

  if (!shouldShowError) {
    // Idle state carries no controls. Settings have their own pages, and the
    // composer should not double as a second entry point to them.
    return null;
  }

  return (
    <div className="flex flex-1 items-center">
      <ToolTip delayShow={700} content={t("composer.strip.configError")}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate(CONFIG_ROUTES.CONFIGS)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate(CONFIG_ROUTES.CONFIGS);
            }
          }}
          data-testid="block-settings-toolbar-icon-error"
          className="relative flex cursor-pointer select-none items-center rounded-full px-1.5 py-1"
        >
          <ExclamationTriangleIcon
            className="text-warning h-[13px] w-[13px] flex-shrink-0"
            aria-hidden="true"
          />
        </div>
      </ToolTip>
    </div>
  );
}
