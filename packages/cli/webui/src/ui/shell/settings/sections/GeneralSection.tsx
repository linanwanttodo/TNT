import { Fact, SettingsGroup } from "../shared.tsx";
import css from "../SettingsPage.module.css";

export interface GeneralSectionProps {
  workspace: string;
  sessionTitle: string;
  model: string;
  permissionMode: string;
  queueLength: number;
  isProcessing: boolean;
  settingsPath: string;
  pluginsDir: string;
  copiedPath: string | null;
  onOpen: (target: string) => void;
  onCopy: (target: string) => void;
}

export function GeneralSection({
  workspace,
  sessionTitle,
  model,
  permissionMode,
  queueLength,
  isProcessing,
  settingsPath,
  pluginsDir,
  copiedPath,
  onOpen,
  onCopy,
}: GeneralSectionProps) {
  return (
    <div className={css.settings}>
      <SettingsGroup title="Session">
        <Fact
          label="Workspace"
          value={workspace}
          action={
            workspace ? (
              <button
                type="button"
                className={css.secondaryAction}
                onClick={() => onOpen(workspace)}
              >
                Open
              </button>
            ) : null
          }
        />
        <Fact label="Conversation" value={sessionTitle} />
        <Fact label="Model" value={model} />
        <Fact
          label="Permission mode"
          value={permissionMode}
          hint="Change it from the composer."
        />
        <Fact label="State" value={isProcessing ? "Running a turn" : "Idle"} />
        <Fact
          label="Queue"
          value={queueLength === 0 ? "Empty" : `${queueLength} queued`}
        />
      </SettingsGroup>

      <SettingsGroup title="Storage">
        <Fact
          label="Settings file"
          value={settingsPath}
          action={
            settingsPath ? (
              <button
                type="button"
                className={css.secondaryAction}
                onClick={() => onCopy(settingsPath)}
              >
                {copiedPath === settingsPath ? "Copied" : "Copy"}
              </button>
            ) : null
          }
        />
        <Fact
          label="Plugin folder"
          value={pluginsDir}
          action={
            pluginsDir ? (
              <button
                type="button"
                className={css.secondaryAction}
                onClick={() => onOpen(pluginsDir)}
              >
                Open
              </button>
            ) : null
          }
        />
      </SettingsGroup>
    </div>
  );
}
