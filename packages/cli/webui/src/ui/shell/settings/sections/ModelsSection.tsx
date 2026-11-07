import { useMemo, useState, type CSSProperties } from "react";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type {
  ChatModelOption,
  DeclaredModel,
  ModelConfigInput,
  ModelTestResult,
  ModelsResponse,
} from "../../../../api/client.js";
import css from "../SettingsPage.module.css";

/**
 * Providers the underlying adapters construct; the field is free text (any
 * provider the CLI knows works), the list exists so the common ones need no
 * typing and no docs lookup.
 */
const PROVIDER_SUGGESTIONS = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "openrouter",
  "ollama",
  "groq",
  "mistral",
  "together",
  "fireworks",
  "xAI",
  "zAI",
  "moonshot",
  "minimax",
  "azure",
  "bedrock",
  "vertexai",
  "vllm",
  "lmstudio",
  "llama.cpp",
  "cerebras",
  "nvidia",
  "novita",
  "nebius",
  "sambanova",
  "deepinfra",
  "cohere",
  "voyage",
];

const ROLE_OPTIONS = [
  "chat",
  "edit",
  "apply",
  "autocomplete",
  "embed",
  "rerank",
  "subagent",
];

/** One stable hue per provider name, so the badges read at a glance. */
function providerHue(provider: string): number {
  let hash = 0;
  for (let i = 0; i < provider.length; i++) {
    hash = (hash * 31 + provider.charCodeAt(i)) % 360;
  }
  return hash;
}

/** The provider chip next to a model name, colored like a provider logo. */
function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span
      className={css.providerBadge}
      style={
        {
          "--provider-hue": `${providerHue(provider)}`,
        } as CSSProperties
      }
    >
      <span className={css.providerDot} />
      {provider}
    </span>
  );
}

interface ModelFormValues {
  name: string;
  provider: string;
  model: string;
  apiBase: string;
  apiKey: string;
  contextLength: string;
  roles: string[];
}

/**
 * Provider templates, ported from ZCode's ProviderTemplatePicker: the add
 * flow starts from a grid of known providers (base URLs pre-filled where the
 * adapter defines one) plus a custom card, instead of a blank form.
 */
const PROVIDER_TEMPLATES: Array<{
  provider: string;
  apiBase?: string | undefined;
}> = [
  { provider: "anthropic" },
  { provider: "openai" },
  { provider: "gemini" },
  { provider: "deepseek" },
  { provider: "openrouter" },
  { provider: "ollama", apiBase: "http://localhost:11434" },
  { provider: "groq", apiBase: "https://api.groq.com/openai/v1/" },
  { provider: "mistral", apiBase: "https://api.mistral.ai/v1/" },
  { provider: "together", apiBase: "https://api.together.xyz/v1/" },
  { provider: "fireworks", apiBase: "https://api.fireworks.ai/inference/v1/" },
  { provider: "xAI", apiBase: "https://api.x.ai/v1/" },
  { provider: "zAI", apiBase: "https://api.z.ai/api/paas/v4/" },
  { provider: "moonshot" },
  { provider: "vllm", apiBase: "http://localhost:8000/v1/" },
  { provider: "lmstudio", apiBase: "http://localhost:1234/" },
  { provider: "cerebras", apiBase: "https://api.cerebras.ai/v1/" },
];

type FormState =
  | { mode: "create"; preset: { provider: string; apiBase: string } | null }
  | { mode: "edit"; name: string; entry: DeclaredModel }
  | null;

function emptyFormValues(
  preset: { provider: string; apiBase: string } | null,
): ModelFormValues {
  return {
    name: "",
    provider: preset?.provider ?? "",
    model: "",
    apiBase: preset?.apiBase ?? "",
    apiKey: "",
    contextLength: "",
    roles: ["chat"],
  };
}

function formValuesFromEntry(entry: DeclaredModel): ModelFormValues {
  return {
    name: entry.name,
    provider: entry.provider,
    model: entry.model,
    apiBase: entry.apiBase ?? "",
    apiKey: "",
    contextLength:
      entry.contextLength === null ? "" : String(entry.contextLength),
    roles: entry.roles.length > 0 ? entry.roles : ["chat"],
  };
}

export interface ModelsSectionProps {
  models: ModelsResponse | null;
  onUse: (index: number) => void;
  onRetry: () => void;
  /** Persist a create or an edit; resolves when the server answered. */
  onSave: (
    input: ModelConfigInput,
    editName: string | null,
  ) => Promise<string | null>;
  /** Remove one declared entry; resolves when the server answered. */
  onDelete: (name: string) => Promise<string | null>;
  /** Persist a drag-reorder of the declared entries. */
  onReorder: (names: string[]) => Promise<string | null>;
  /** One real provider round trip for the Test connection button. */
  onTest: (input: ModelConfigInput) => Promise<ModelTestResult>;
}

/**
 * The Models settings page: the chat models the process runs, the entries
 * config.yaml declares, and the create/edit/delete/test flows over them.
 * Every action is a real server call; nothing here is local-only state.
 */
export function ModelsSection({
  models,
  onUse,
  onRetry,
  onSave,
  onDelete,
  onReorder,
  onTest,
}: ModelsSectionProps) {
  const [form, setForm] = useState<FormState>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ZCode's sensors: a 4px threshold so clicking a card never starts a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // The chat list is the source for rows even when the server predates the
  // config store: derive declared entries from it so editing still works.
  const declared: DeclaredModel[] = useMemo(() => {
    if (models === null) return [];
    if (models.declared && models.declared.length > 0) return models.declared;
    return models.models.map((model) => ({
      name: model.name,
      model: model.name,
      provider: model.provider,
      hasApiKey: false,
      apiBase: null,
      roles: ["chat"],
      contextLength: null,
    }));
  }, [models]);

  if (models === null) {
    return <div className={css.loading}>Loading models...</div>;
  }

  const declaredNames = new Set(declared.map((entry) => entry.name));

  return (
    <div className={css.modelsWrap}>
      <div className={css.modelsToolbar}>
        <span className={css.resultCount}>
          {models.configPath
            ? `Declared in ${models.configPath}`
            : "Declared in the server's config.yaml"}
        </span>
        <button
          type="button"
          className={css.primaryAction}
          disabled={form !== null}
          onClick={() => setForm({ mode: "create", preset: null })}
        >
          Add model
        </button>
      </div>

      {/* The add flow starts from the template grid, ZCode's
          ProviderTemplatePicker: pick a known provider to have its base URL
          pre-filled, or go custom. */}
      {form !== null && form.mode === "create" && form.preset === null ? (
        <div className={css.templateGrid}>
          {PROVIDER_TEMPLATES.map((template) => (
            <button
              key={template.provider}
              type="button"
              className={css.templateCard}
              onClick={() =>
                setForm({
                  mode: "create",
                  preset: {
                    provider: template.provider,
                    apiBase: template.apiBase ?? "",
                  },
                })
              }
            >
              <ProviderBadge provider={template.provider} />
              {template.apiBase ? (
                <span className={css.templateBase}>{template.apiBase}</span>
              ) : (
                <span className={css.templateBase}>default endpoint</span>
              )}
            </button>
          ))}
          <button
            type="button"
            className={css.templateCard}
            onClick={() =>
              setForm({ mode: "create", preset: { provider: "", apiBase: "" } })
            }
          >
            <ProviderBadge provider="custom" />
            <span className={css.templateBase}>Custom provider</span>
          </button>
        </div>
      ) : null}

      {form !== null && !(form.mode === "create" && form.preset === null) ? (
        <ModelForm
          key={form.mode === "edit" ? `edit:${form.name}` : "create"}
          form={form}
          declared={declared}
          busy={busy}
          onCancel={() => setForm(null)}
          onBackToTemplates={() => setForm({ mode: "create", preset: null })}
          onSave={async (input) => {
            setBusy(true);
            const error = await onSave(
              input,
              form.mode === "edit" ? form.name : null,
            );
            setBusy(false);
            if (error === null) {
              setForm(null);
              onRetry();
            }
          }}
          onTest={onTest}
        />
      ) : null}

      {declared.length === 0 ? (
        <div className={css.empty}>
          <h3 className={css.emptyTitle}>No models configured</h3>
          <p className={css.emptyBody}>
            Add one here and it is written to the server's config.yaml and
            loaded immediately - no restart, no hand-edited YAML.
          </p>
          <button
            type="button"
            className={css.primaryAction}
            onClick={() => setForm({ mode: "create", preset: null })}
          >
            Add model
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const names = declared.map((entry) => entry.name);
            const from = names.indexOf(String(active.id));
            const to = names.indexOf(String(over.id));
            if (from === -1 || to === -1) return;
            names.splice(to, 0, ...names.splice(from, 1));
            void onReorder(names);
          }}
        >
          <div className={css.modelCardList}>
            <SortableContext
              items={declared.map((entry) => entry.name)}
              strategy={horizontalListSortingStrategy}
            >
              {declared.map((entry) => {
                const chatOption = models.models.find(
                  (candidate) => candidate.name === entry.name,
                );
                return (
                  <SortableModelRow
                    key={entry.name}
                    entry={entry}
                    chatOption={chatOption}
                    formOpen={form !== null}
                    confirmingDelete={confirmingDelete === entry.name}
                    busy={busy}
                    onUse={onUse}
                    onRename={(entry_, name) => {
                      // Inline rename: patch the name, keep everything else.
                      void onSave(
                        {
                          name,
                          model: entry_.model,
                          provider: entry_.provider,
                          roles: entry_.roles,
                          contextLength: entry_.contextLength ?? undefined,
                        },
                        entry_.name,
                      ).then(() => onRetry());
                    }}
                    onEdit={() =>
                      setForm({ mode: "edit", name: entry.name, entry })
                    }
                    onRequestDelete={() => setConfirmingDelete(entry.name)}
                    onCancelDelete={() => setConfirmingDelete(null)}
                    onConfirmDelete={async () => {
                      setBusy(true);
                      await onDelete(entry.name);
                      setBusy(false);
                      setConfirmingDelete(null);
                      onRetry();
                    }}
                  />
                );
              })}
            </SortableContext>
          </div>
          {/* Chat models the process runs that config.yaml does not declare
              (injected blocks) - listed so their presence is not a mystery. */}
          {models.models
            .filter((model) => !declaredNames.has(model.name))
            .map((model) => (
              <div key={`injected:${model.name}`} className={css.row}>
                <span className={css.rowName}>{model.name}</span>
                <ProviderBadge provider={model.provider} />
                <span className={css.rowDetail}>
                  {model.current ? "Current model" : "injected"}
                </span>
                {!model.current ? (
                  <button
                    type="button"
                    className={css.secondaryAction}
                    onClick={() => onUse(model.index)}
                  >
                    Use
                  </button>
                ) : null}
              </div>
            ))}
        </DndContext>
      )}
    </div>
  );
}

function SortableModelRow({
  entry,
  chatOption,
  formOpen,
  confirmingDelete,
  busy,
  onUse,
  onRename,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  entry: DeclaredModel;
  chatOption: ChatModelOption | undefined;
  formOpen: boolean;
  confirmingDelete: boolean;
  busy: boolean;
  onUse: (index: number) => void;
  onRename: (entry: DeclaredModel, name: string) => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  // Drag-reorder over the declared list, ZCode's SortableProviderModelList.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.name });
  const current = chatOption?.current ?? false;
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(entry.name);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  const commitRename = () => {
    setRenaming(false);
    const name = draftName.trim();
    if (name !== "" && name !== entry.name) onRename(entry, name);
  };

  const details = [entry.hasApiKey ? "" : "no apiKey", entry.apiBase ?? ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={setNodeRef}
      className={css.modelCard}
      data-current={current}
      style={style}
      {...attributes}
    >
      <button
        type="button"
        className={css.modelCardGrip}
        aria-label={`Reorder ${entry.name}`}
        title="Drag to reorder"
        {...listeners}
      >
        ⋮⋮
      </button>
      <div className={css.modelCardBody}>
        <div className={css.modelCardTitleRow}>
          {renaming ? (
            <input
              type="text"
              className={css.modelCardRename}
              value={draftName}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <button
              type="button"
              className={css.modelCardName}
              title="Click to rename"
              disabled={formOpen || busy}
              onClick={() => {
                setDraftName(entry.name);
                setRenaming(true);
              }}
            >
              {entry.name}
            </button>
          )}
          <ProviderBadge provider={entry.provider} />
          {current ? <span className={css.rowBadge}>Current model</span> : null}
          <span className={css.modelCardDetail}>{details}</span>
        </div>
        <div className={css.modelCardMetaRow}>
          <span className={css.modelCardModel}>{entry.model}</span>
          {entry.roles.map((role) => (
            <span key={role} className={css.modelCardRole}>
              {role}
            </span>
          ))}
        </div>
      </div>
      <div className={css.modelCardActions}>
        {chatOption && !current ? (
          <button
            type="button"
            className={css.secondaryAction}
            disabled={formOpen || busy}
            onClick={() => onUse(chatOption.index)}
          >
            Use
          </button>
        ) : null}
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className={css.primaryAction}
              disabled={busy}
              onClick={onConfirmDelete}
            >
              Delete
            </button>
            <button
              type="button"
              className={css.secondaryAction}
              disabled={busy}
              onClick={onCancelDelete}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={css.secondaryAction}
              disabled={formOpen || busy}
              onClick={onEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className={css.secondaryAction}
              disabled={formOpen || busy}
              onClick={onRequestDelete}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ModelForm({
  form,
  declared,
  busy,
  onCancel,
  onBackToTemplates,
  onSave,
  onTest,
}: {
  form: NonNullable<FormState>;
  declared: DeclaredModel[];
  busy: boolean;
  onCancel: () => void;
  onBackToTemplates: () => void;
  onSave: (input: ModelConfigInput) => Promise<void>;
  onTest: (input: ModelConfigInput) => Promise<ModelTestResult>;
}) {
  const [values, setValues] = useState<ModelFormValues>(() =>
    form.mode === "edit"
      ? formValuesFromEntry(form.entry)
      : emptyFormValues(form.preset),
  );
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = form.mode === "edit";
  const editName = form.mode === "edit" ? form.name : null;
  const hasStoredKey = form.mode === "edit" ? form.entry.hasApiKey : false;
  const nameTaken = declared.some(
    (entry) => entry.name === values.name.trim() && entry.name !== editName,
  );
  const canSubmit =
    !busy &&
    values.name.trim() !== "" &&
    values.model.trim() !== "" &&
    values.provider.trim() !== "" &&
    !nameTaken;

  const buildInput = (): ModelConfigInput => {
    const input: ModelConfigInput = {
      name: values.name.trim(),
      model: values.model.trim(),
      provider: values.provider.trim(),
      roles: values.roles,
    };
    if (values.apiKey.trim() !== "") {
      input.apiKey = values.apiKey.trim();
    }
    if (values.apiBase.trim() !== "") {
      input.apiBase = values.apiBase.trim();
    }
    if (values.contextLength.trim() !== "") {
      const parsed = Number(values.contextLength);
      if (Number.isInteger(parsed) && parsed > 0) {
        input.contextLength = parsed;
      }
    }
    return input;
  };

  const set = (patch: Partial<ModelFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  return (
    <form
      className={css.modelForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        void onSave(buildInput());
      }}
    >
      <div className={css.modelFormGrid}>
        <label className={css.modelField}>
          <span className={css.modelFieldLabel}>Name</span>
          <input
            className={css.modelInput}
            value={values.name}
            placeholder="my-model"
            onChange={(event) => set({ name: event.target.value })}
          />
          {nameTaken ? (
            <span className={css.modelFieldError}>name is already used</span>
          ) : null}
        </label>
        <label className={css.modelField}>
          <span className={css.modelFieldLabel}>Provider</span>
          <input
            className={css.modelInput}
            value={values.provider}
            list="model-provider-suggestions"
            onChange={(event) => set({ provider: event.target.value })}
          />
          <datalist id="model-provider-suggestions">
            {PROVIDER_SUGGESTIONS.map((provider) => (
              <option key={provider} value={provider} />
            ))}
          </datalist>
        </label>
        <label className={css.modelField}>
          <span className={css.modelFieldLabel}>Model ID</span>
          <input
            className={css.modelInput}
            value={values.model}
            placeholder="e.g. gpt-4o / claude-sonnet-4-5 / qwen2.5-coder:7b"
            onChange={(event) => set({ model: event.target.value })}
          />
        </label>
        <label className={css.modelField}>
          <span className={css.modelFieldLabel}>API base URL</span>
          <input
            className={css.modelInput}
            value={values.apiBase}
            placeholder="optional - provider default when empty"
            onChange={(event) => set({ apiBase: event.target.value })}
          />
        </label>
        <label className={css.modelField}>
          <span className={css.modelFieldLabel}>API key</span>
          <input
            className={css.modelInput}
            type="password"
            value={values.apiKey}
            placeholder={
              hasStoredKey
                ? "stored - type to replace"
                : "required by most providers"
            }
            onChange={(event) => set({ apiKey: event.target.value })}
          />
        </label>
        <label className={css.modelField}>
          <span className={css.modelFieldLabel}>Context length</span>
          <input
            className={css.modelInput}
            value={values.contextLength}
            inputMode="numeric"
            placeholder="optional"
            onChange={(event) => set({ contextLength: event.target.value })}
          />
        </label>
      </div>

      <div className={css.modelRolesRow}>
        <span className={css.modelFieldLabel}>Roles</span>
        {ROLE_OPTIONS.map((role) => (
          <label key={role} className={css.modelRoleChip}>
            <input
              type="checkbox"
              checked={values.roles.includes(role)}
              onChange={(event) =>
                set({
                  roles: event.target.checked
                    ? [...values.roles, role]
                    : values.roles.filter((candidate) => candidate !== role),
                })
              }
            />
            {role}
          </label>
        ))}
      </div>

      {formError ? (
        <div className={css.modelTestResult} data-ok="false">
          {formError}
        </div>
      ) : null}
      {testResult ? (
        <div className={css.modelTestResult} data-ok={testResult.ok}>
          {testResult.ok
            ? `OK · ${testResult.latencyMs}ms · ${testResult.detail}`
            : `Failed · ${testResult.detail}`}
        </div>
      ) : null}

      <div className={css.modelFormActions}>
        <button
          type="button"
          className={css.secondaryAction}
          disabled={testing || busy}
          onClick={async () => {
            setTesting(true);
            setTestResult(null);
            setFormError(null);
            try {
              setTestResult(await onTest(buildInput()));
            } catch (cause) {
              setFormError(
                cause instanceof Error ? cause.message : String(cause),
              );
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? "Testing..." : "Test connection"}
        </button>
        <span className={css.modelFormSpacer} />
        {!isEdit ? (
          <button
            type="button"
            className={css.secondaryAction}
            disabled={busy}
            onClick={onBackToTemplates}
          >
            ‹ Providers
          </button>
        ) : null}
        <button
          type="button"
          className={css.secondaryAction}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={css.primaryAction}
          disabled={!canSubmit}
        >
          {isEdit ? "Save changes" : "Add model"}
        </button>
      </div>
    </form>
  );
}
