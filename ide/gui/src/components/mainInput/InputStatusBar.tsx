import { Tool } from "core";
import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  ReasoningDepth,
  setReasoningDepth,
} from "../../redux/slices/sessionSlice";
import { setToolPolicy } from "../../redux/slices/uiSlice";
import { Popover, PopoverButton, PopoverPanel } from "../ui";

const REASONING_DEPTHS: ReasoningDepth[] = ["off", "low", "medium", "high"];

type ToolPolicyMode = "ask" | "autoAllow" | "autoAll";

function policyOf(
  tool: Tool,
  policies: Record<string, string>,
): "allowedWithPermission" | "allowedWithoutPermission" | "disabled" {
  return (
    (policies[tool.function.name] as any) ??
    tool.defaultToolPolicy ??
    "allowedWithPermission"
  );
}

function currentPolicyMode(
  tools: Tool[],
  policies: Record<string, string>,
): ToolPolicyMode {
  if (!tools.length) {
    return "ask";
  }
  const allAuto = tools.every(
    (t) => policyOf(t, policies) === "allowedWithoutPermission",
  );
  if (allAuto) {
    return "autoAll";
  }
  const readonlyAuto = tools.every(
    (t) => !t.readonly || policyOf(t, policies) === "allowedWithoutPermission",
  );
  if (readonlyAuto) {
    return "autoAllow";
  }
  return "ask";
}

function ContextUsageItem({ pct }: { pct: number }) {
  const { t } = useI18n();
  const usedPct = Math.round(Math.min(Math.max(pct, 0), 1) * 100);
  return (
    <Popover>
      <PopoverButton className="text-description-muted cursor-pointer border-none bg-transparent p-0 text-xs outline-none">
        {t("toolbar.contextUsage")} {usedPct}%
      </PopoverButton>
      <PopoverPanel
        anchor="top start"
        className="bg-vsc-background border-border z-50 w-56 rounded-lg border p-3 shadow-md"
      >
        <div className="text-foreground mb-1 text-xs font-medium">
          {t("toolbar.contextUsage")}
        </div>
        <div className="text-description-muted text-xs">
          {t("toolbar.contextUsage.desc")}
        </div>
        <div className="mt-2 flex h-1.5 w-full gap-0.5">
          <div
            className="rounded-sm"
            style={{
              width: `${usedPct}%`,
              minWidth: usedPct > 0 ? "2px" : undefined,
              backgroundColor:
                "color-mix(in srgb, var(--vscode-editor-foreground) 60%, transparent)",
            }}
          />
          <div
            className="flex-1 rounded-sm"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent)",
            }}
          />
        </div>
        <div className="text-description-muted mt-1 flex justify-between text-xs">
          <span>{usedPct}%</span>
          <span>
            {t("toolbar.contextUsage.free")} {100 - usedPct}%
          </span>
        </div>
      </PopoverPanel>
    </Popover>
  );
}

function ToolPolicyItem({ tools }: { tools: Tool[] }) {
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const policies = useAppSelector((state) => state.ui.toolSettings);
  const mode = useMemo(
    () => currentPolicyMode(tools, policies),
    [tools, policies],
  );

  const modeLabel: Record<ToolPolicyMode, string> = {
    ask: t("toolbar.toolPolicy.ask"),
    autoAllow: t("toolbar.toolPolicy.autoAllow"),
    autoAll: t("toolbar.toolPolicy.autoAll"),
  };

  function applyMode(next: ToolPolicyMode) {
    for (const tool of tools) {
      const policy =
        next === "autoAll" || (next === "autoAllow" && tool.readonly)
          ? "allowedWithoutPermission"
          : "allowedWithPermission";
      dispatch(setToolPolicy({ toolName: tool.function.name, policy }));
    }
  }

  const options: ToolPolicyMode[] = ["ask", "autoAllow", "autoAll"];

  return (
    <Popover>
      <PopoverButton className="text-description-muted cursor-pointer border-none bg-transparent p-0 text-xs outline-none">
        {modeLabel[mode]}
      </PopoverButton>
      <PopoverPanel
        anchor="top start"
        className="bg-vsc-background border-border z-50 w-56 rounded-lg border p-1 shadow-md"
      >
        <div className="text-description-muted px-2 py-1 text-xs">
          {t("toolbar.toolPolicy.desc")}
        </div>
        {options.map((option) => (
          <button
            key={option}
            className={`flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-2 py-1.5 text-left text-xs ${
              option === mode ? "text-foreground" : "text-description-muted"
            }`}
            onClick={() => applyMode(option)}
          >
            <span>{modeLabel[option]}</span>
            {option === mode && <span className="text-xs">•</span>}
          </button>
        ))}
      </PopoverPanel>
    </Popover>
  );
}

function ReasoningDepthItem() {
  const dispatch = useAppDispatch();
  const { t } = useI18n();
  const depth = useAppSelector(
    (state) => state.session.reasoningDepth ?? "off",
  );

  const depthLabel: Record<ReasoningDepth, string> = {
    off: t("reasoningDepth.off"),
    low: t("reasoningDepth.low"),
    medium: t("reasoningDepth.medium"),
    high: t("reasoningDepth.high"),
  };

  return (
    <Popover>
      <PopoverButton className="text-description-muted cursor-pointer border-none bg-transparent p-0 text-xs outline-none">
        {t("toolbar.reasoningDepth")}: {depthLabel[depth]}
      </PopoverButton>
      <PopoverPanel
        anchor="top start"
        className="bg-vsc-background border-border z-50 w-48 rounded-lg border p-1 shadow-md"
      >
        <div className="text-description-muted px-2 py-1 text-xs">
          {t("toolbar.reasoningDepth.desc")}
        </div>
        {REASONING_DEPTHS.map((option) => (
          <button
            key={option}
            className={`flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-2 py-1.5 text-left text-xs ${
              option === depth ? "text-foreground" : "text-description-muted"
            }`}
            onClick={() => dispatch(setReasoningDepth(option))}
          >
            <span>{depthLabel[option]}</span>
            {option === depth && <span className="text-xs">•</span>}
          </button>
        ))}
      </PopoverPanel>
    </Popover>
  );
}

export function InputStatusBar() {
  const tools = useAppSelector((state) => state.config.config.tools ?? []);
  const contextPercentage = useAppSelector(
    (state) => state.session.contextPercentage,
  );

  return (
    <div className="text-description-muted mt-1 flex items-center gap-3 px-1 pb-1 text-xs">
      {typeof contextPercentage === "number" && (
        <ContextUsageItem pct={contextPercentage} />
      )}
      {tools.length > 0 && <ToolPolicyItem tools={tools} />}
      <ReasoningDepthItem />
    </div>
  );
}
