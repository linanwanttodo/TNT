/**
 * A `providers:` block is one endpoint shared by several models. It keeps the
 * URL, key and protocol on the parent instead of repeating them on every model
 * entry, which is what a provider-level setting means in the shell.
 *
 * The block is expanded into the flat `models:` list before the schema sees it,
 * so every downstream reader (CLI runtime, WebUI, model listing) gets ordinary
 * model entries and needs no knowledge of the shorthand.
 */
export interface ProviderBlockModel {
  name: string;
  model?: string;
  [key: string]: unknown;
}

export interface ProviderBlock {
  name?: string;
  provider: string;
  apiBase?: string;
  apiKey?: string;
  useResponsesApi?: boolean;
  models: Array<ProviderBlockModel | string>;
  [key: string]: unknown;
}

const INHERITED_KEYS = ["apiBase", "apiKey", "useResponsesApi"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModel(
  value: ProviderBlockModel | string,
): Record<string, unknown> {
  if (typeof value === "string") {
    return { name: value, model: value };
  }
  return { ...value, model: value.model ?? value.name };
}

/** Expand `providers:` into `models:` and remove the shorthand key. */
export function expandProviderBlocks(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const blocks = document.providers;
  if (!Array.isArray(blocks)) return document;

  const expanded: Record<string, unknown>[] = [];
  for (const raw of blocks) {
    if (!isRecord(raw) || !Array.isArray(raw.models)) continue;
    const provider = typeof raw.provider === "string" ? raw.provider : "openai";
    for (const value of raw.models) {
      if (typeof value !== "string" && !isRecord(value)) continue;
      const model = normalizeModel(value as ProviderBlockModel | string);
      for (const key of INHERITED_KEYS) {
        if (model[key] === undefined && raw[key] !== undefined) {
          model[key] = raw[key];
        }
      }
      expanded.push({ provider, ...model });
    }
  }
  const flat = Array.isArray(document.models) ? document.models : [];
  const { providers: _removed, ...rest } = document;
  return { ...rest, models: [...expanded, ...flat] };
}

/**
 * Fold a flat `models:` list back into the original `providers:` structure.
 * A value shared by every model of the family is lifted onto the block, so the
 * URL/key is written once; a model that differs keeps its own value.
 */
export function foldProviderBlocks(
  document: Record<string, unknown>,
  models: Record<string, unknown>[],
): Record<string, unknown> {
  const original = document.providers;
  if (!Array.isArray(original)) {
    return { ...document, models };
  }

  const folded: Record<string, unknown>[] = [];
  const consumed = new Set<number>();
  for (const raw of original) {
    if (!isRecord(raw) || typeof raw.provider !== "string") continue;
    const family = raw.provider;
    const familyModels = models.filter(
      (model, index) => model.provider === family && !consumed.has(index),
    );
    models.forEach((model, index) => {
      if (model.provider === family) consumed.add(index);
    });

    const block: Record<string, unknown> = { ...raw };
    for (const key of INHERITED_KEYS) {
      const values = familyModels
        .map((model) => model[key])
        .filter((value) => value !== undefined);
      const shared =
        values.length === familyModels.length &&
        values.every((value) => value === values[0]);
      if (shared && values[0] !== undefined) {
        block[key] = values[0];
      } else {
        delete block[key];
      }
    }

    block.models = familyModels.map((model) => {
      const entry: Record<string, unknown> = { ...model };
      delete entry.provider;
      for (const key of INHERITED_KEYS) {
        if (entry[key] === block[key]) delete entry[key];
      }
      return entry;
    });
    folded.push(block);
  }

  const remaining = models.filter((_, index) => !consumed.has(index));
  const { models: _removed, ...rest } = document;
  return {
    ...rest,
    providers: folded,
    ...(remaining.length ? { models: remaining } : {}),
  };
}
