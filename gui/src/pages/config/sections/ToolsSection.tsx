import { BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import { useMemo } from "react";
import Alert from "../../../components/gui/Alert";
import { useAppSelector } from "../../../redux/hooks";
import { useI18n } from "../../../i18n";
import { ConfigHeader } from "../components/ConfigHeader";
import { ToolPoliciesGroup } from "../components/ToolPoliciesGroup";

export function ToolsSection() {
  const { t } = useI18n();
  const availableTools = useAppSelector((state) => state.config.config.tools);
  const mode = useAppSelector((store) => store.session.mode);

  const duplicateDetection = useMemo(() => {
    const counts: Record<string, number> = {};
    availableTools.forEach((tool) => {
      if (counts[tool.function.name]) {
        counts[tool.function.name] = counts[tool.function.name] + 1;
      } else {
        counts[tool.function.name] = 1;
      }
    });
    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, v > 1]),
    );
  }, [availableTools]);

  const allToolsOff = useMemo(() => {
    return mode === "chat";
  }, [mode]);

  const availableToolsMessage =
    mode === "chat"
      ? t("tools.chatDisabled")
      : mode === "plan"
        ? t("tools.planReadonly")
        : "";

  return (
    <>
      <ConfigHeader
        title={t("tools.title")}
        subtext={t("tools.subtitle")}
        className="mb-2"
      />
      {!!availableToolsMessage && (
        <div className="mb-4">
          <Alert type="info" size="sm">
            <span className="text-2xs italic">{availableToolsMessage}</span>
          </Alert>
        </div>
      )}
      <div className="mb-4 space-y-6">
        <ToolPoliciesGroup
          showIcon={false}
          groupName={BUILT_IN_GROUP_NAME}
          displayName={t("tools.builtIn")}
          allToolsOff={allToolsOff}
          duplicateDetection={duplicateDetection}
        />
      </div>
    </>
  );
}
