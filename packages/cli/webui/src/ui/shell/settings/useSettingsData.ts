import { useCallback, useEffect, useState } from "react";

import {
  addModel,
  chooseModel,
  deleteModel,
  fetchModels,
  fetchPlugins,
  fetchState,
  openPath,
  reorderModels,
  reloadPlugins,
  setPluginEnabled,
  testModel,
  updateModel,
  type ModelConfigInput,
  type ModelTestResult,
  type ModelsResponse,
  type PluginsResponse,
} from "../../../api/client.js";
import type { StateSnapshot } from "../../../types/agent-events.js";

export interface SettingsDataState {
  plugins: PluginsResponse | null;
  models: ModelsResponse | null;
  state: StateSnapshot | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  copiedPath: string | null;
  busyPlugin: string | null;
  reload: () => void;
  togglePlugin: (name: string, enabled: boolean) => Promise<void>;
  selectModel: (index: number) => Promise<void>;
  copyPath: (target: string) => void;
  revealPath: (target: string) => void;
  /** Create or edit a declared model; resolves with an error message or null. */
  saveModel: (
    input: ModelConfigInput,
    editName: string | null,
  ) => Promise<string | null>;
  /** Remove one declared model; resolves with an error message or null. */
  removeModel: (name: string) => Promise<string | null>;
  /** Persist a drag-reorder of the declared models. */
  reorderDeclaredModels: (names: string[]) => Promise<string | null>;
  /** One real provider round trip from the model form. */
  testModelConnection: (input: ModelConfigInput) => Promise<ModelTestResult>;
}

/**
 * Data and mutations for the Settings page. The page itself only composes
 * sections; plugin/model/state loads and their error handling live here.
 */
export function useSettingsData(): SettingsDataState {
  const [plugins, setPlugins] = useState<PluginsResponse | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null);

  const loadPlugins = useCallback(async (reload: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setPlugins(reload ? await reloadPlugins() : await fetchPlugins());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      setModels(await fetchModels());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const loadState = useCallback(async () => {
    try {
      setState(await fetchState());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void loadPlugins(false);
    void loadModels();
    void loadState();
  }, [loadPlugins, loadModels, loadState]);

  const reload = useCallback(() => {
    void loadPlugins(true);
    void loadModels();
    void loadState();
  }, [loadPlugins, loadModels, loadState]);

  const togglePlugin = useCallback(async (name: string, enabled: boolean) => {
    setNotice(null);
    setBusyPlugin(name);
    try {
      const next = await setPluginEnabled(name, enabled);
      setPlugins(next);
      setNotice(
        `${name} ${enabled ? "enabled" : "disabled"} for this project.`,
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyPlugin(null);
    }
  }, []);

  const selectModel = useCallback(async (index: number) => {
    try {
      const model = await chooseModel(index);
      setModels((current) =>
        current === null
          ? current
          : {
              ...current,
              current: model,
              models: current.models.map((candidate) => ({
                ...candidate,
                current: candidate.index === model.index,
              })),
            },
      );
      setNotice(`Model set to ${model.name}.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const copyPath = useCallback((target: string) => {
    if (!navigator.clipboard) {
      setNotice("Could not copy the path.");
      return;
    }
    void navigator.clipboard
      .writeText(target)
      .then(() => {
        setCopiedPath(target);
        window.setTimeout(() => setCopiedPath(null), 1200);
      })
      .catch(() => setNotice("Could not copy the path."));
  }, []);

  const saveModel = useCallback(
    async (
      input: ModelConfigInput,
      editName: string | null,
    ): Promise<string | null> => {
      setNotice(null);
      try {
        if (editName === null) {
          await addModel(input);
          setNotice(`Model ${input.name} added and loaded.`);
        } else {
          const next = await updateModel(editName, input);
          if (next.declared.length > 0) {
            setModels((current) =>
              current === null
                ? current
                : { ...current, declared: next.declared },
            );
          }
          setNotice(`Model ${input.name} saved.`);
        }
        await loadModels();
        return null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setNotice(message);
        return message;
      }
    },
    [loadModels],
  );

  const removeModel = useCallback(
    async (name: string): Promise<string | null> => {
      setNotice(null);
      try {
        await deleteModel(name);
        setNotice(`Model ${name} removed.`);
        await loadModels();
        return null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setNotice(message);
        return message;
      }
    },
    [loadModels],
  );

  const testModelConnection = useCallback(
    (input: ModelConfigInput) => testModel(input),
    [],
  );

  const reorderDeclaredModels = useCallback(
    async (names: string[]): Promise<string | null> => {
      setNotice(null);
      try {
        const next = await reorderModels(names);
        setModels((current) =>
          current === null ? current : { ...current, declared: next.declared },
        );
        return null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setNotice(message);
        return message;
      }
    },
    [],
  );

  const revealPath = useCallback((target: string) => {
    void openPath(target).catch((cause: unknown) => {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  return {
    plugins,
    models,
    state,
    loading,
    error,
    notice,
    copiedPath,
    busyPlugin,
    reload,
    togglePlugin,
    selectModel,
    copyPath,
    revealPath,
    saveModel,
    removeModel,
    reorderDeclaredModels,
    testModelConnection,
  };
}
