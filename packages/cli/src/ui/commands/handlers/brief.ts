import { buildUserBrief, findLastUserText } from "../../../agent/userBrief.js";
import {
  getUserBriefEnabled,
  saveUserBriefEnabled,
} from "../../../agent/userBriefSettings.js";
import { t } from "../../../i18n/index.js";
import { services } from "../../../services/index.js";
import type { SlashCommandResult } from "../types.js";

/**
 * `/brief on|off|status`. Status prints the brief that would precede the last
 * user message, so the extraction is inspectable before the user decides
 * whether to keep it on.
 */
export function handleBrief(args: string[] = []): SlashCommandResult {
  const option = (args[0] ?? "").trim().toLowerCase();

  if (option === "on" || option === "off") {
    const enabled = option === "on";
    try {
      saveUserBriefEnabled(enabled);
    } catch (error) {
      return {
        output: t("brief.saveFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      };
    }
    return { output: t(enabled ? "brief.on" : "brief.off") };
  }

  if (option !== "" && option !== "status") {
    return { output: t("brief.usage") };
  }

  const enabled = getUserBriefEnabled();
  const heading = t(enabled ? "brief.statusOn" : "brief.statusOff");
  const history = services.chatHistory?.getHistory?.() ?? [];
  const lastUserText = findLastUserText(history);

  if (!lastUserText) {
    return { output: `${heading}\n${t("brief.noMessage")}` };
  }

  const brief = buildUserBrief(lastUserText, { enabled: true });
  if (!brief) {
    return { output: `${heading}\n${t("brief.noBrief")}` };
  }

  return { output: `${heading}\n${t("brief.lastBrief")}\n${brief.text}` };
}
