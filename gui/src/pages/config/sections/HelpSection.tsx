import {
  DocumentArrowUpIcon,
  LinkIcon,
  NumberedListIcon,
  PaintBrushIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { useContext, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Shortcut from "../../../components/gui/Shortcut";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { saveCurrentSession } from "../../../redux/thunks/session";
import { isJetBrains } from "../../../util";
import { CONFIG_ROUTES, ROUTES } from "../../../util/navigation";
import { useI18n } from "../../../i18n";
import { ConfigHeader } from "../components/ConfigHeader";
import { ConfigRow } from "../components/ConfigRow";

interface KeyboardShortcutProps {
  shortcut: string;
  description: string;
  isEven: boolean;
}

function KeyboardShortcut(props: KeyboardShortcutProps) {
  return (
    <div
      className={`flex flex-col items-start p-3 sm:flex-row sm:items-center ${props.isEven ? "" : "bg-vsc-editor-background/50"}`}
    >
      <div className="w-full flex-grow pb-2 pr-4 sm:w-auto sm:pb-0">
        <span className="block break-words text-sm">{props.description}:</span>
      </div>
      <div className="flex-shrink-0 whitespace-nowrap">
        <Shortcut>{props.shortcut}</Shortcut>
      </div>
    </div>
  );
}

interface ShortcutDef {
  shortcut: string;
  descriptionKey: string;
}

// Shortcut strings will be rendered correctly based on the platform by the Shortcut component
const vscodeShortcuts: ShortcutDef[] = [
  {
    shortcut: "cmd '",
    descriptionKey: "help.shortcut.toggleModel",
  },
  {
    shortcut: "cmd I",
    descriptionKey: "help.shortcut.editCode",
  },
  {
    shortcut: "cmd L",
    descriptionKey: "help.shortcut.newChat",
  },
  {
    shortcut: "cmd backspace",
    descriptionKey: "help.shortcut.cancel",
  },
  {
    shortcut: "cmd shift I",
    descriptionKey: "help.shortcut.inlineEditFocus",
  },
  {
    shortcut: "cmd shift L",
    descriptionKey: "help.shortcut.focusChat",
  },
  {
    shortcut: "cmd shift R",
    descriptionKey: "help.shortcut.debugTerminal",
  },
  {
    shortcut: "cmd shift backspace",
    descriptionKey: "help.shortcut.rejectDiff",
  },
  {
    shortcut: "cmd shift enter",
    descriptionKey: "help.shortcut.acceptDiff",
  },
  {
    shortcut: "alt cmd N",
    descriptionKey: "help.shortcut.rejectTopChange",
  },
  {
    shortcut: "alt cmd Y",
    descriptionKey: "help.shortcut.acceptTopChange",
  },
  {
    shortcut: "cmd K cmd A",
    descriptionKey: "help.shortcut.toggleAutocomplete",
  },
  {
    shortcut: "cmd alt space",
    descriptionKey: "help.shortcut.forceAutocomplete",
  },
  {
    shortcut: "cmd K cmd M",
    descriptionKey: "help.shortcut.fullScreen",
  },
];

const jetbrainsShortcuts: ShortcutDef[] = [
  {
    shortcut: "cmd '",
    descriptionKey: "help.shortcut.toggleModel",
  },
  {
    shortcut: "cmd I",
    descriptionKey: "help.shortcut.editCode",
  },
  {
    shortcut: "cmd J",
    descriptionKey: "help.shortcut.newChat",
  },
  {
    shortcut: "cmd backspace",
    descriptionKey: "help.shortcut.cancel",
  },
  {
    shortcut: "cmd shift I",
    descriptionKey: "help.shortcut.inlineEditFocus",
  },
  {
    shortcut: "cmd shift J",
    descriptionKey: "help.shortcut.focusChat",
  },
  {
    shortcut: "cmd shift backspace",
    descriptionKey: "help.shortcut.rejectDiff",
  },
  {
    shortcut: "cmd shift enter",
    descriptionKey: "help.shortcut.acceptDiff",
  },
  {
    shortcut: "alt shift J",
    descriptionKey: "help.shortcut.quickInput",
  },
  {
    shortcut: "alt cmd J",
    descriptionKey: "help.shortcut.toggleSidebar",
  },
];

export function HelpSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { t } = useI18n();

  const currentSession = useAppSelector((state) => state.session);

  const shortcuts = useMemo(() => {
    return isJetBrains() ? jetbrainsShortcuts : vscodeShortcuts;
  }, []);

  const handleViewSessionData = async () => {
    const sessionData = await ideMessenger.request("history/load", {
      id: currentSession.id,
    });

    if (sessionData.status === "success") {
      await ideMessenger.request("showVirtualFile", {
        name: `${sessionData.content.title}.json`,
        content: JSON.stringify(sessionData.content, null, 2),
      });
    }
  };

  return (
    <div className="flex flex-col">
      <ConfigHeader title={t("help.title")} />
      <div className="space-y-6">
        {/* Resources */}
        <div>
          <h3 className="mb-3 text-base font-medium">{t("help.resources")}</h3>
          <Card className="!p-0">
            <div className="flex flex-col">
              <ConfigRow
                title={t("help.documentation")}
                description={t("help.documentation.desc")}
                icon={LinkIcon}
                onClick={() =>
                  ideMessenger.post("openUrl", "https://docs.continue.dev/")
                }
              />
            </div>
          </Card>
        </div>

        {/* Tools */}
        <div>
          <h3 className="mb-3 text-base font-medium">{t("help.tools")}</h3>
          <Card className="!p-0">
            <div className="flex flex-col">
              <ConfigRow
                title={t("help.tokenUsage")}
                description={t("help.tokenUsage.desc")}
                icon={TableCellsIcon}
                onClick={() => navigate(CONFIG_ROUTES.USAGE)}
              />

              {currentSession.history.length > 0 &&
                !currentSession.isStreaming && (
                  <ConfigRow
                    title={t("help.sessionHistory")}
                    description={t("help.sessionHistory.desc")}
                    icon={NumberedListIcon}
                    onClick={handleViewSessionData}
                  />
                )}

              <ConfigRow
                title={t("help.quickstart")}
                description={t("help.quickstart.desc")}
                icon={DocumentArrowUpIcon}
                onClick={async () => {
                  navigate("/");
                  // Used to clear the chat panel before showing the tutorial
                  await dispatch(
                    saveCurrentSession({
                      openNewSession: true,
                      generateTitle: true,
                    }),
                  );
                  ideMessenger.post("showTutorial", undefined);
                }}
              />

              {process.env.NODE_ENV === "development" && (
                <ConfigRow
                  title={t("help.themeTest")}
                  description={t("help.themeTest.desc")}
                  icon={PaintBrushIcon}
                  onClick={async () => {
                    navigate(ROUTES.THEME);
                  }}
                />
              )}
            </div>
          </Card>
        </div>

        {/* Keyboard Shortcuts */}
        <div>
          <h3 className="mb-3 text-base font-medium">
            {t("help.keyboardShortcuts")}
          </h3>
          <Card className="!p-0">
            <div className="overflow-hidden rounded-md border border-gray-600">
              {shortcuts.map((shortcut, i) => {
                return (
                  <KeyboardShortcut
                    key={i}
                    shortcut={shortcut.shortcut}
                    description={t(shortcut.descriptionKey)}
                    isEven={i % 2 === 0}
                  />
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
