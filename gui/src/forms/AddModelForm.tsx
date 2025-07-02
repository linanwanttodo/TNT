import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useCallback, useContext, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { Button, Input } from "../components";
import ModelSelectionListbox from "../components/modelSelection/ModelSelectionListbox";
import { useAuth } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useI18n } from "../i18n";

// Curated whitelist of registered providerName values from core LLMClasses.
// The backend matches LLM implementation classes statically by provider name,
// so free-form provider input is not allowed.
const PROVIDER_OPTIONS = [
  { title: "OpenAI", provider: "openai" },
  { title: "Anthropic", provider: "anthropic" },
  { title: "Gemini", provider: "gemini" },
  { title: "Azure", provider: "azure" },
  { title: "Mistral", provider: "mistral" },
  { title: "DeepSeek", provider: "deepseek" },
  { title: "Groq", provider: "groq" },
  { title: "OpenRouter", provider: "openrouter" },
  { title: "Together", provider: "together" },
  { title: "Fireworks", provider: "fireworks" },
  { title: "Cohere", provider: "cohere" },
  { title: "xAI", provider: "xAI" },
  { title: "Bedrock", provider: "bedrock" },
  { title: "Vertex AI", provider: "vertexai" },
  { title: "Moonshot", provider: "moonshot" },
  { title: "MiniMax", provider: "minimax" },
  { title: "SiliconFlow", provider: "siliconflow" },
  { title: "Novita", provider: "novita" },
  { title: "Nebius", provider: "nebius" },
  { title: "Cerebras", provider: "cerebras" },
  { title: "Ollama", provider: "ollama" },
  { title: "LM Studio", provider: "lmstudio" },
  { title: "llama.cpp", provider: "llama.cpp" },
  { title: "vLLM", provider: "vllm" },
  { title: "HuggingFace TEI", provider: "huggingface-tei" },
  { title: "HuggingFace TGI", provider: "huggingface-tgi" },
  { title: "HuggingFace Inference API", provider: "huggingface-inference-api" },
].sort((a, b) => a.title.localeCompare(b.title));

interface AddModelFormProps {
  onDone: () => void;
}

interface FetchedModel {
  name: string;
  modelId?: string;
  description?: string;
  contextLength?: number;
  maxTokens?: number;
  supportsTools?: boolean;
}

function toModelDescription(
  fields: Record<string, any>,
  modelId: string,
  overrides?: Partial<FetchedModel>,
): Record<string, any> {
  const contextLength =
    parseInt(fields.contextLength, 10) || overrides?.contextLength;
  const maxTokens = parseInt(fields.maxTokens, 10) || overrides?.maxTokens;

  const capabilities: Record<string, boolean> = {};
  if (fields.capToolUse || overrides?.supportsTools) {
    capabilities.tools = true;
  }
  if (fields.capImageInput) {
    capabilities.uploadImage = true;
  }

  // Only fields the user actually set are written, so an untouched form adds
  // a model with the provider defaults rather than empty overrides.
  const completionOptions: Record<string, unknown> = {};
  if (maxTokens) {
    completionOptions.maxTokens = maxTokens;
  }
  if (fields.reasoningEffort) {
    completionOptions.reasoning = true;
    completionOptions.reasoningEffort = fields.reasoningEffort;
  }
  if (fields.responseFormatJson) {
    completionOptions.responseFormat = "json";
  }
  if (fields.contextManagement) {
    completionOptions.contextManagement = true;
  }
  if (fields.openaiStore || fields.openaiServiceTier) {
    completionOptions.openaiRequestOptions = {
      ...(fields.openaiStore ? { store: true } : {}),
      ...(fields.openaiServiceTier
        ? { serviceTier: fields.openaiServiceTier }
        : {}),
    };
  }

  return {
    provider: fields.provider,
    title: fields.title,
    model: modelId,
    ...(fields.apiBase ? { apiBase: fields.apiBase } : {}),
    ...(fields.apiKey ? { apiKey: fields.apiKey } : {}),
    ...(contextLength ? { contextLength } : {}),
    ...(Object.keys(completionOptions).length > 0 ? { completionOptions } : {}),
    ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
  };
}

export function AddModelForm({ onDone }: AddModelFormProps) {
  const formMethods = useForm<Record<string, any>>({
    defaultValues: { provider: "openai" },
  });
  const ideMessenger = useContext(IdeMessengerContext);
  const { t } = useI18n();
  const { selectedProfile } = useAuth();

  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [checkedModels, setCheckedModels] = useState<Set<string>>(new Set());
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | undefined>(undefined);

  const selectedProvider = formMethods.watch("provider");
  const titleValue = formMethods.watch("title");
  const modelValue = formMethods.watch("model");

  const handleFetchModels = useCallback(async () => {
    const apiKey = formMethods.getValues("apiKey");
    const apiBase = formMethods.getValues("apiBase");
    const provider = formMethods.getValues("provider");
    if (!provider) return;

    setIsFetchingModels(true);
    setFetchError(undefined);
    try {
      const response = await ideMessenger.request("models/fetch", {
        provider,
        apiKey,
        apiBase,
      });
      if (response.status === "error" || !response.content) {
        setFetchError("Failed to fetch models. Check your API key and base.");
        return;
      }
      const models = [...response.content].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      setFetchedModels(models);
      setCheckedModels(new Set(models.map((m) => m.modelId ?? m.name)));
    } catch (error) {
      console.error("Failed to fetch models:", error);
      setFetchError("Failed to fetch models. Check your API key and base.");
    } finally {
      setIsFetchingModels(false);
    }
  }, [ideMessenger, formMethods]);

  function toggleModel(modelId: string) {
    setCheckedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  }

  function isDisabled() {
    if (checkedModels.size > 0) {
      return false;
    }
    return !modelValue || modelValue.length === 0 || !titleValue;
  }

  function onSubmit(fields: Record<string, any>) {
    const modelIds = checkedModels.size > 0 ? [...checkedModels] : [modelValue];

    for (const modelId of modelIds) {
      const override = fetchedModels.find(
        (m) => (m.modelId ?? m.name) === modelId,
      );
      const model = toModelDescription(fields, modelId, override) as any;
      ideMessenger.post("config/addModel", { model });

      if (selectedProfile) {
        ideMessenger.post("config/updateSelectedModel", {
          profileId: selectedProfile.id,
          role: "chat",
          title: model.title,
        });
      }
    }

    onDone();
  }

  return (
    <FormProvider {...formMethods}>
      <form onSubmit={formMethods.handleSubmit(onSubmit)}>
        <div className="mx-auto max-w-md p-6">
          <h1 className="mb-0 text-center text-2xl">
            {t("addChatModel.title")}
          </h1>

          <div className="my-8 flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.displayName")}
              </label>
              <Input
                id="title"
                className="w-full"
                placeholder={t("addChatModel.displayName.placeholder")}
                {...formMethods.register("title")}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.provider")}
              </label>
              <ModelSelectionListbox
                selectedProvider={{
                  title:
                    PROVIDER_OPTIONS.find(
                      (p) => p.provider === selectedProvider,
                    )?.title ?? selectedProvider,
                  provider: selectedProvider,
                }}
                setSelectedProvider={(val) => {
                  formMethods.setValue("provider", val.provider ?? "openai");
                  setFetchedModels([]);
                  setCheckedModels(new Set());
                }}
                topOptions={PROVIDER_OPTIONS.map((p) => ({
                  title: p.title,
                  provider: p.provider,
                }))}
                searchPlaceholder={t("addChatModel.searchProviders")}
              />
              <span className="text-description-muted mt-1 block text-xs">
                {t("addChatModel.provider.hint")}
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="mb-1 block text-sm font-medium">
                  {t("addChatModel.modelId")}
                </label>
                <button
                  type="button"
                  title="Fetch available models from the provider"
                  className="text-description-muted cursor-pointer border-none bg-transparent p-0"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels}
                >
                  {isFetchingModels ? (
                    <span className="flex items-center gap-1 text-xs">
                      <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                      {t("addChatModel.fetching")}
                    </span>
                  ) : (
                    <span className="text-xs underline">
                      {t("addChatModel.fetchModelList")}
                    </span>
                  )}
                </button>
              </div>
              <Input
                id="model"
                className="w-full"
                placeholder={t("addChatModel.modelId.placeholder")}
                {...formMethods.register("model")}
              />
              {fetchError && (
                <span className="text-warning mt-1 block text-xs">
                  {t("addChatModel.fetchError")}
                </span>
              )}
              {fetchedModels.length > 0 && (
                <div className="border-border bg-input mt-2 max-h-48 overflow-y-auto rounded border p-2">
                  <div className="text-description-muted mb-1 text-xs">
                    {t("addChatModel.selectModelsToAdd")}
                  </div>
                  {fetchedModels.map((m) => {
                    const id = m.modelId ?? m.name;
                    return (
                      <label
                        key={id}
                        className="flex cursor-pointer items-center gap-2 py-1"
                      >
                        <input
                          type="checkbox"
                          checked={checkedModels.has(id)}
                          onChange={() => toggleModel(id)}
                        />
                        <span className="text-xs">{m.name}</span>
                        {m.contextLength && (
                          <span className="text-description-muted text-xs">
                            {Math.round(m.contextLength / 1000)}k
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.apiBase")}
              </label>
              <Input
                id="apiBase"
                className="w-full"
                placeholder="https://api.example.com/v1"
                {...formMethods.register("apiBase")}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.apiKey")}
              </label>
              <Input
                id="apiKey"
                className="w-full"
                type="password"
                placeholder={t("addChatModel.apiKey.placeholder")}
                {...formMethods.register("apiKey")}
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium">
                  {t("addChatModel.contextLength")}
                </label>
                <Input
                  id="contextLength"
                  className="w-full"
                  type="number"
                  placeholder="128000"
                  {...formMethods.register("contextLength")}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-sm font-medium">
                  {t("addChatModel.maxOutputTokens")}
                </label>
                <Input
                  id="maxTokens"
                  className="w-full"
                  type="number"
                  placeholder="4096"
                  {...formMethods.register("maxTokens")}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.capabilities")}
              </label>
              <div className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    {...formMethods.register("capToolUse")}
                  />
                  <span className="text-xs">{t("addChatModel.toolUse")}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    {...formMethods.register("capImageInput")}
                  />
                  <span className="text-xs">
                    {t("addChatModel.imageInput")}
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.reasoningDepth")}
              </label>
              <select
                className="border-border bg-input text-foreground w-full rounded border px-2 py-1.5 text-sm"
                {...formMethods.register("reasoningEffort")}
              >
                <option value="">{t("reasoningDepth.inherit")}</option>
                <option value="low">{t("reasoningDepth.low")}</option>
                <option value="medium">{t("reasoningDepth.medium")}</option>
                <option value="high">{t("reasoningDepth.high")}</option>
                <option value="xhigh">{t("reasoningDepth.xhigh")}</option>
                <option value="max">{t("reasoningDepth.max")}</option>
              </select>
              <span className="text-description-muted mt-1 block text-xs">
                {t("addChatModel.reasoningDepth.desc")}
              </span>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("addChatModel.advanced")}
              </label>
              <div className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    {...formMethods.register("responseFormatJson")}
                  />
                  <span className="text-xs">
                    {t("addChatModel.responseFormatJson")}
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    {...formMethods.register("contextManagement")}
                  />
                  <span className="text-xs">
                    {t("addChatModel.contextManagement")}
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    {...formMethods.register("openaiStore")}
                  />
                  <span className="text-xs">
                    {t("addChatModel.openaiStore")}
                  </span>
                </label>
              </div>
              <div className="mt-2">
                <label className="mb-1 block text-xs">
                  {t("addChatModel.serviceTier")}
                </label>
                <select
                  className="border-border bg-input text-foreground w-full rounded border px-2 py-1.5 text-sm"
                  {...formMethods.register("openaiServiceTier")}
                >
                  <option value="">
                    {t("addChatModel.serviceTier.default")}
                  </option>
                  <option value="auto">auto</option>
                  <option value="flex">flex</option>
                  <option value="scale">scale</option>
                  <option value="priority">priority</option>
                </select>
              </div>
              <span className="text-description-muted mt-1 block text-xs">
                {t("addChatModel.advanced.desc")}
              </span>
            </div>
          </div>

          <div className="mt-4 w-full">
            <Button type="submit" className="w-full" disabled={isDisabled()}>
              {t("addChatModel.connect")}
            </Button>

            <span className="text-description-muted block w-full text-center text-xs">
              {t("addChatModel.willUpdateConfig")}{" "}
              <span
                className="cursor-pointer underline"
                onClick={() =>
                  ideMessenger.post("config/openProfile", {
                    profileId: undefined,
                  })
                }
              >
                {t("addChatModel.configFile")}
              </span>
            </span>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

export default AddModelForm;
