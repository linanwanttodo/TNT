import {
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  ClipboardIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { IndexingProgressUpdate } from "core";
import { useContext, useState } from "react";
import { GhostButton } from "../../../../components";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useI18n } from "../../../../i18n";
import { useAppSelector } from "../../../../redux/hooks";

export interface IndexingProgressErrorTextProps {
  update: IndexingProgressUpdate;
}

const copyWarningsToClipboard = (warnings: string[] = []) => {
  const warningsText = warnings.join("\n");
  void navigator.clipboard.writeText(warningsText);
};

function IndexingProgressErrorText({ update }: IndexingProgressErrorTextProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const { t } = useI18n();
  const [showWarnings, setShowWarnings] = useState(false);
  const embeddingsProvider = useAppSelector(
    (state) => state.config.config.selectedModelByRole.embed,
  );

  if (!embeddingsProvider) {
    return (
      <div className="flex items-center gap-2 italic">
        <XCircleIcon className="h-4 w-4 min-w-[10%]" />
        <span className="leading-relaxed">
          {t("indexing.embeddingsRequired")}
          <a
            href="https://github.com/linanwanttodo/TNT/tree/main/docs/walkthroughs/codebase-embeddings#embeddings-providers"
            target="_blank"
            className="cursor-pointer text-inherit underline hover:text-inherit"
          >
            https://github.com/linanwanttodo/TNT/tree/main/docs/walkthroughs/codebase-embeddings#embeddings-providers
          </a>
        </span>
      </div>
    );
  }

  // Show warnings if they exist (for completed indexing with warnings)
  if (
    update.warnings &&
    update.warnings.length > 0 &&
    update.status !== "failed"
  ) {
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-2 italic text-yellow-600"
          onClick={() => setShowWarnings(!showWarnings)}
        >
          <span className="leading-relaxed">
            {t("indexing.warningsCount", {
              count: update.warnings.length,
            })}
          </span>
          <ChevronRightIcon
            className={`h-3 w-3 transition-transform duration-300 ${
              showWarnings ? "rotate-90" : ""
            }`}
          />
        </div>

        <div
          className={`ml-3 overflow-hidden transition-all duration-300 ease-in-out ${
            showWarnings ? "mt-2 max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {/* Warning messages */}
          <div className="space-y-1">
            {update.warnings.map((warning, index) => (
              <div key={index} className="text-xs">
                • {warning}
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-row items-center justify-end gap-2 pt-4">
            {/* Copy all warnings to clipboard */}
            <GhostButton
              onClick={() => copyWarningsToClipboard(update.warnings)}
              className="flex items-center !px-1.5 !py-0.5 text-xs"
            >
              <ClipboardIcon className="mr-1 h-3 w-3" />
              <span>{t("indexing.copyOutput")}</span>
            </GhostButton>

            {/* Open dev tools to view logs */}
            <GhostButton
              onClick={() => {
                ideMessenger.post("toggleDevTools", undefined);
              }}
              className="flex items-center !px-1.5 !py-0.5 text-xs"
            >
              <ArrowTopRightOnSquareIcon className="mr-1 h-3 w-3" />
              <span>{t("indexing.viewLogs")}</span>
            </GhostButton>
          </div>
        </div>
      </div>
    );
  }

  // Show error for failed status
  return (
    <div className="flex items-center gap-2 italic text-red-600">
      <XCircleIcon className="h-4 w-4" />
      <span className="leading-relaxed">{update.desc}</span>
    </div>
  );
}

export default IndexingProgressErrorText;
