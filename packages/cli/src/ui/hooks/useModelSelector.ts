import {
  defaultConfigPath,
  writeSelectedModelName,
} from "../../config/modelSelection.js";
import { t } from "../../i18n/index.js";
import {
  SERVICE_NAMES,
  serviceContainer,
  services,
} from "../../services/index.js";
import { ConfigServiceState, ModelServiceState } from "../../services/types.js";
import { useNavigation } from "../context/NavigationContext.js";

interface ModelOption {
  id: string;
  name: string;
  index: number;
  provider: string;
}

interface UseModelSelectorProps {
  onMessage: (message: {
    role: string;
    content: string;
    messageType: "system";
  }) => void;
  onModelSwitch?: () => void;
  onRefreshUI?: () => void;
}

export function useModelSelector({
  onMessage,
  onModelSwitch,
  onRefreshUI,
}: UseModelSelectorProps) {
  const { closeCurrentScreen } = useNavigation();

  const handleModelSelect = async (model: ModelOption) => {
    closeCurrentScreen();

    try {
      await services.model.switchModel(model.index);
      const modelInfo = services.model.getModelInfo();

      // Update the service container to trigger re-renders
      const currentState = services.model.getState();
      serviceContainer.set<ModelServiceState>(
        SERVICE_NAMES.MODEL,
        currentState,
      );

      // The selection lives in the config file, next to the model definitions.
      if (modelInfo?.name) {
        const configState = services.config.getState();
        try {
          writeSelectedModelName(
            modelInfo.name,
            configState.configPath ?? defaultConfigPath(),
          );
          serviceContainer.set<ConfigServiceState>(SERVICE_NAMES.CONFIG, {
            ...configState,
            selectedModel: modelInfo.name,
          });
        } catch (error: any) {
          onMessage({
            role: "system",
            content: t("models.selectionSaveFailed", {
              model: modelInfo.name,
              reason: error?.message ?? String(error),
            }),
            messageType: "system",
          });
        }
      }

      onMessage({
        role: "system",
        content: `Switched to model: ${modelInfo?.name}`,
        messageType: "system",
      });

      // Trigger any additional actions after model switch
      if (onModelSwitch) {
        onModelSwitch();
      }

      // Force UI refresh to update the IntroMessage with new model
      if (onRefreshUI) {
        onRefreshUI();
      }
    } catch (error: any) {
      onMessage({
        role: "system",
        content: `Failed to switch model: ${error.message}`,
        messageType: "system",
      });
    }
  };

  return {
    handleModelSelect,
  };
}
