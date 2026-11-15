import { t } from "../i18n/index.js";

/**
 * Startup banner for `tnt serve`. The endpoint list is one translated block
 * rather than seven keys: the columns are laid out to line up, and a translator
 * needs to see them together to keep the alignment.
 */
export function renderServerStartupHelp(
  port: number,
  timeoutSeconds: number,
): string[] {
  return [
    t("serve.started", { port }),
    t("serve.endpoints"),
    ...t("serve.endpointList").split("\n"),
    t("serve.inactivity", { seconds: timeoutSeconds }),
  ];
}
