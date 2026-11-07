import React, { useEffect, useState } from "react";

import { t } from "../i18n/index.js";
import { services } from "../services/index.js";

import { Selector, SelectorOption } from "./Selector.js";

interface ModelOption extends SelectorOption {
  index: number;
  provider: string;
}

interface ModelSelectorProps {
  onSelect: (model: ModelOption) => void;
  /** Open the add-model form; offered alongside the list and when it is empty. */
  onAdd: () => void;
  onCancel: () => void;
}

const ADD_MODEL_ID = "__add__";

const ModelSelector: React.FC<ModelSelectorProps> = ({
  onSelect,
  onAdd,
  onCancel,
}) => {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentModelIndex, setCurrentModelIndex] = useState<number>(-1);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const availableModels = services.model.getAvailableChatModels();
        const currentIndex = services.model.getCurrentModelIndex();

        const modelOptions: ModelOption[] = availableModels.map((model) => ({
          id: `${model.provider}-${model.name}-${model.index}`,
          name: model.name,
          index: model.index,
          provider: model.provider,
        }));

        setModels(modelOptions);
        setCurrentModelIndex(currentIndex);
        setSelectedIndex(Math.max(0, currentIndex));
        setLoading(false);
      } catch (err: any) {
        setError(err.message || t("models.loadFailed"));
        setLoading(false);
      }
    };

    void loadModels();
  }, []);

  // The add entry rides at the end of the list - and is the only entry when
  // nothing is configured, so an empty selector is a door rather than a wall.
  const options: ModelOption[] = [
    ...models,
    {
      id: ADD_MODEL_ID,
      name: t("models.add"),
      index: -1,
      provider: "",
    },
  ];

  return (
    <Selector
      title={t("models.title")}
      options={options}
      selectedIndex={selectedIndex}
      loading={loading}
      error={models.length === 0 ? t("models.none") : error}
      loadingMessage={t("models.loading")}
      currentId={
        currentModelIndex >= 0 && models[currentModelIndex]
          ? models[currentModelIndex].id
          : null
      }
      onSelect={(option) => {
        if (option.id === ADD_MODEL_ID) {
          onAdd();
          return;
        }
        onSelect(option);
      }}
      onCancel={onCancel}
      onNavigate={setSelectedIndex}
    />
  );
};

export { ModelSelector };
