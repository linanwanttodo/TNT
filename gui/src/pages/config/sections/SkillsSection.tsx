import { ArrowPathIcon, FolderOpenIcon } from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useState } from "react";
import { Card, EmptyState } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useI18n } from "../../../i18n";
import { ConfigHeader } from "../components/ConfigHeader";

interface SkillView {
  name: string;
  description: string;
  path: string;
  files: string[];
  uri: string;
  scope: "global" | "workspace";
}

interface SkillsView {
  skills: SkillView[];
  errors: { message: string }[];
}

export function SkillsSection() {
  const { t } = useI18n();
  const ideMessenger = useContext(IdeMessengerContext);
  const [view, setView] = useState<SkillsView | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  const refresh = useCallback(() => {
    setLoading(true);
    void ideMessenger
      .request("skills/list", undefined)
      .then((result) => {
        if (result.status === "success") {
          setView(result.content);
        }
      })
      .finally(() => setLoading(false));
  }, [ideMessenger]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const skills = view?.skills ?? [];

  return (
    <div>
      <ConfigHeader
        title={t("skills.title")}
        subtext={t("skills.subtitle")}
        className="mb-2"
      />

      <Card>
        <div className="flex items-center justify-between">
          <div className="text-description-muted text-xs">
            {t("skills.location")}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="text-description-muted flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs"
          >
            <ArrowPathIcon
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            {t("skills.refresh")}
          </button>
        </div>
      </Card>

      <div className="mt-3 space-y-2">
        {!view ? null : skills.length === 0 ? (
          <Card>
            <EmptyState message={t("skills.empty")} />
          </Card>
        ) : (
          skills.map((skill) => {
            const isOpen = expanded === skill.uri;
            return (
              <Card key={skill.uri}>
                <div
                  className="flex cursor-pointer items-center justify-between"
                  onClick={() => setExpanded(isOpen ? undefined : skill.uri)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground truncate text-sm font-medium">
                        {skill.name}
                      </span>
                      <span className="text-description-muted border-border text-2xs flex-shrink-0 rounded border px-1.5 py-0.5">
                        {skill.scope === "global"
                          ? t("skills.scope.global")
                          : t("skills.scope.workspace")}
                      </span>
                    </div>
                    <div className="text-description-muted mt-1 line-clamp-2 text-xs">
                      {skill.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    title={t("skills.openFile")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void ideMessenger.request("skills/openFile", {
                        path: skill.uri,
                      });
                    }}
                    className="text-description-muted ml-2 flex-shrink-0 cursor-pointer border-none bg-transparent p-1"
                  >
                    <FolderOpenIcon className="h-4 w-4" />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-border mt-2 border-t pt-2">
                    <div className="text-description-muted mb-1 text-xs">
                      {t("skills.files")}
                    </div>
                    <div className="text-description-muted break-all text-xs">
                      {skill.path}
                    </div>
                    {skill.files.length > 0 ? (
                      <ul className="text-description-muted mt-1 space-y-0.5 text-xs">
                        {skill.files.map((file) => (
                          <li key={file} className="break-all">
                            {file}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-description-muted text-xs">
                        {t("skills.noFiles")}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {view?.errors && view.errors.length > 0 && (
        <div className="mt-3 space-y-1">
          {view.errors.map((error, index) => (
            <div key={index} className="text-warning text-xs">
              {error.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
