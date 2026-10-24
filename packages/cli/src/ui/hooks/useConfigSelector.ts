import { spawn } from "child_process";
import * as path from "path";

import { env } from "../../config/env.js";
import { t } from "../../i18n/index.js";
import { services } from "../../services/index.js";
import { useNavigation } from "../context/NavigationContext.js";

interface ConfigOption {
  id: string;
  name: string;
  type: "local" | "assistant" | "create";
  slug?: string;
  organizationId?: string | null;
}

interface UseConfigSelectorProps {
  configPath?: string;
  onMessage: (message: {
    role: string;
    content: string;
    messageType: "system";
  }) => void;
  handleClear: () => void;
}

const CONFIG_PATH = path.join(env.continueHome, "config.yaml");

export function useConfigSelector({
  onMessage,
  handleClear,
}: UseConfigSelectorProps) {
  const { closeCurrentScreen } = useNavigation();

  const handleConfigSelect = async (config: ConfigOption) => {
    closeCurrentScreen();

    if (config.type === "create") {
      // Open the web browser to create new assistant. Each platform opener
      // receives the URL as its own argv element, so the value is never
      // re-parsed by a shell.
      const url = new URL("https://github.com/linanwanttodo/TNT");
      url.searchParams.set("type", "assistant");

      try {
        if (process.platform === "darwin") {
          spawn("open", [url.toString()], { stdio: "ignore" }).on(
            "error",
            (error) => {
              console.error(t("chat.browserOpenFailed"), error);
            },
          );
        } else if (process.platform === "win32") {
          // `start` is a cmd builtin, not an executable of its own.
          spawn("cmd.exe", ["/c", "start", "", url.toString()], {
            stdio: "ignore",
          }).on("error", (error) => {
            console.error(t("chat.browserOpenFailed"), error);
          });
        } else {
          spawn("xdg-open", [url.toString()], { stdio: "ignore" }).on(
            "error",
            (error) => {
              console.error(t("chat.browserOpenFailed"), error);
            },
          );
        }

        onMessage({
          role: "system",
          content: `Opening ${url} in your browser to create a new assistant...`,
          messageType: "system" as const,
        });
      } catch {
        onMessage({
          role: "system",
          content: `Please visit ${url} to create a new assistant`,
          messageType: "system" as const,
        });
      }
      return;
    }

    try {
      // Show loading message
      onMessage({
        role: "system",
        content: `Switching to configuration: ${config.name}...`,
        messageType: "system" as const,
      });

      let targetConfigPath: string | undefined;

      if (config.type === "local") {
        targetConfigPath = CONFIG_PATH;
      } else if (config.type === "assistant" && config.slug) {
        targetConfigPath = config.slug;
      }

      await services.config.updateConfigPath(targetConfigPath);

      handleClear();

      // Show success message
      onMessage({
        role: "system",
        content: `Successfully switched to configuration: ${config.name}`,
        messageType: "system" as const,
      });
    } catch (error: any) {
      // Show error message
      onMessage({
        role: "system",
        content: `Failed to switch configuration: ${error.message}`,
        messageType: "system" as const,
      });
    }
  };

  return {
    handleConfigSelect,
  };
}
