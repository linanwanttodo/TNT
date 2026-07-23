/**
 * Interactive provider setup for a first run.
 *
 * The flow asks for a protocol, a base URL, an API key and a model in that
 * order, and writes the result as the single config file. Nothing is
 * preselected: every field can be changed before it is saved, and the config
 * file is the only place any of it is recorded.
 */

import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import { writeFileAtomically } from "core/util/atomicWrite.js";
import { setConfigFilePermissions } from "core/util/paths.js";

import { t } from "../i18n/index.js";
import { question } from "../utils/prompt.js";

import { env } from "./env.js";

export const CONFIG_PATH = path.join(env.continueHome, "config.yaml");

/**
 * The context window written for a freshly configured model: the 200k most
 * long-context models actually ship. Per-entry overrides live in the config
 * file's own `contextLength` key.
 */
export const DEFAULT_CONTEXT_LENGTH = 200_000;

/**
 * A protocol the CLI can talk to. `apiBase` is only a default: the setup asks
 * for the URL either way, so a gateway, a proxy or a self-hosted endpoint can
 * be used with any of them.
 */
export interface ProtocolOption {
  id: string;
  label: string;
  defaultApiBase: string;
  exampleApiBase?: string;
  defaultModel: string;
  /** Placeholder for a model the user must choose, e.g. a local Ollama tag. */
  exampleModel?: string;
  /**
   * Where the vendor lists its models, relative to the API base. The vendor
   * owns that route, and it is often not the one the requests use: DeepSeek
   * answers `/models` on the origin root while its traffic goes to
   * `/anthropic/v1/messages`. Empty means the base URL itself.
   */
  modelsPath?: string;
  /** True when the key is obtained by signing in through a browser. */
  browserLogin?: boolean;
  contextLength: number;
  maxTokens: number;
}

export const PROTOCOLS: ProtocolOption[] = [
  {
    id: "openai-chat-completions",
    label: "OpenAI Chat Completions",
    defaultApiBase: "https://api.openai.com/v1/",
    defaultModel: "gpt-4.1",
    modelsPath: "/v1/models",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    defaultApiBase: "https://api.openai.com/v1/",
    defaultModel: "gpt-4.1",
    modelsPath: "/v1/models",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "anthropic-messages",
    label: "Anthropic Messages",
    defaultApiBase: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5",
    modelsPath: "/v1/models",
    contextLength: 200_000,
    maxTokens: 64_000,
  },
  {
    id: "google-generative-ai",
    label: "Google Generative AI",
    defaultApiBase: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    modelsPath: "/v1beta/models",
    contextLength: 200_000,
    maxTokens: 65_536,
  },
  {
    id: "openai-compatible",
    label: "OpenAI compatible / local model",
    defaultApiBase: "http://localhost:11434/v1/",
    defaultModel: "",
    modelsPath: "/v1/models",
    exampleModel: "llama3.2",
    contextLength: 200_000,
    maxTokens: 8_192,
  },
  {
    // DeepSeek's Anthropic-compatible endpoint is the one that speaks native
    // thinking blocks, mid-conversation tool changes and the Files API; the
    // OpenAI-shaped route cannot carry any of them. The models come from the
    // vendor's own listing because they change without notice.
    id: "deepseek-global-preset",
    label: "DeepSeek (Global)",
    defaultApiBase: "https://api.deepseek.com/anthropic/v1",
    defaultModel: "",
    modelsPath: "/models",
    contextLength: 1_000_000,
    maxTokens: 32_768,
  },
  {
    // Zhipu splits by region, and the split is not two addresses for one
    // protocol: the international endpoint speaks the Anthropic shape and the
    // domestic one the OpenAI shape.
    id: "zhipu-global-preset",
    label: "Zhipu GLM (Global)",
    defaultApiBase: "https://api.z.ai/api/anthropic/v1",
    defaultModel: "",
    modelsPath: "/api/anthropic/v1/models",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "zhipu-cn-preset",
    label: "Zhipu GLM (CN)",
    defaultApiBase: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "",
    modelsPath: "/api/paas/v4/models",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "moonshot-cn-preset",
    label: "Moonshot Kimi (CN)",
    defaultApiBase: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    modelsPath: "/v1/models",
    contextLength: 200_000,
    maxTokens: 8_192,
  },
  {
    id: "qwen-cn-preset",
    label: "Qwen / DashScope (CN)",
    defaultApiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.5-plus",
    modelsPath: "/compatible-mode/v1/models",
    contextLength: 200_000,
    maxTokens: 8_192,
  },
  {
    id: "siliconflow-cn-preset",
    label: "SiliconFlow (CN)",
    defaultApiBase: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3.2",
    modelsPath: "/v1/models",
    contextLength: 200_000,
    maxTokens: 8_192,
  },
  {
    id: "minimax-global-preset",
    label: "MiniMax (Global)",
    defaultApiBase: "https://api.minimaxi.com/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "minimax-cn-preset",
    label: "MiniMax (CN)",
    defaultApiBase: "https://api.minimax.cn/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "xiaomi-mimo-cn-preset",
    label: "Xiaomi MiMo (CN)",
    defaultApiBase: "https://api.xiaomimimo.com/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "openrouter-global-preset",
    label: "OpenRouter (Global)",
    defaultApiBase: "https://openrouter.ai/api/v1",
    defaultModel: "",
    modelsPath: "/api/v1/models",
    browserLogin: true,
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "groq-global-preset",
    label: "Groq (Global)",
    defaultApiBase: "https://api.groq.com/openai/v1",
    defaultModel: "",
    modelsPath: "/openai/v1/models",
    contextLength: 128_000,
    maxTokens: 32_768,
  },
  {
    id: "together-global-preset",
    label: "Together AI (Global)",
    defaultApiBase: "https://api.together.xyz/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "fireworks-global-preset",
    label: "Fireworks AI (Global)",
    defaultApiBase: "https://api.fireworks.ai/inference/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "mistral-global-preset",
    label: "Mistral AI (Global)",
    defaultApiBase: "https://api.mistral.ai/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "nebius-global-preset",
    label: "Nebius AI (Global)",
    defaultApiBase: "https://api.tokenfactory.nebius.com/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "step-cn-preset",
    label: "StepFun (CN)",
    defaultApiBase: "https://api.stepfun.com/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "baichuan-cn-preset",
    label: "Baichuan (CN)",
    defaultApiBase: "https://api.baichuan-ai.com/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "zero-one-cn-preset",
    label: "01.AI (CN)",
    defaultApiBase: "https://api.lingyiwanwu.com/v1",
    defaultModel: "",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
];

export interface ProviderSetup {
  protocol: string;
  apiBase: string;
  apiKey: string;
  model: string;
}

function renderProtocolMenu(): void {
  console.log(chalk.bold(`\n${t("setup.protocol")}:`));
  PROTOCOLS.forEach((protocol, index) => {
    const hint = protocol.defaultApiBase
      ? chalk.dim(`  ${protocol.defaultApiBase}`)
      : chalk.dim(
          protocol.exampleApiBase
            ? `  e.g. ${protocol.exampleApiBase}`
            : "  (bring your own URL)",
        );
    console.log(`  ${chalk.cyan(String(index + 1))}) ${protocol.label}${hint}`);
  });
}

async function askProtocol(): Promise<ProtocolOption> {
  renderProtocolMenu();
  const answer = (
    await question(chalk.white(`\nProtocol [1-${PROTOCOLS.length}]: `))
  ).trim();

  if (answer === "") {
    throw new Error(t("setup.protocolRequired"));
  }

  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index < 1 || index > PROTOCOLS.length) {
    throw new Error(t("setup.invalidProtocol", { count: PROTOCOLS.length }));
  }

  return PROTOCOLS[index - 1];
}

async function askApiBase(protocol: ProtocolOption): Promise<string> {
  const prompt = protocol.defaultApiBase
    ? chalk.white(`\n${t("setup.baseUrl")} [${protocol.defaultApiBase}]: `)
    : chalk.white(`\n${t("setup.baseUrl")}: `);

  const answer = (await question(prompt)).trim();
  return normalizeApiBase(protocol.id, answer || protocol.defaultApiBase);
}

async function askApiKey(): Promise<string> {
  while (true) {
    const answer = (
      await question(chalk.white(`\n${t("setup.apiKey")}: `))
    ).trim();
    if (answer) {
      return answer;
    }
    console.log(chalk.yellow(t("setup.apiKeyRequired")));
  }
}

async function askModel(
  protocol: ProtocolOption,
  apiBase: string,
): Promise<string> {
  const defaultModel = getDefaultModel(protocol.id, apiBase);
  const prompt = defaultModel
    ? chalk.white(`\n${t("setup.model")} [${defaultModel}]: `)
    : chalk.white(`\n${t("setup.model")}: `);

  const answer = (await question(prompt)).trim();
  return answer || defaultModel;
}

export async function runProviderSetup(): Promise<ProviderSetup> {
  console.log(chalk.dim(t("setup.intro")));

  const protocol = await askProtocol();
  const apiBase = await askApiBase(protocol);
  const apiKey = await askApiKey();
  const model = await askModel(protocol, apiBase);

  return { protocol: protocol.id, apiBase, apiKey, model };
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The protocol the adapter layer understands. "openai-compatible" is only a
 * setup convenience: it is recorded as "openai" together with the custom URL
 * the user supplied, because the adapter has no "openai-compatible" provider.
 */
function isDeepSeekBase(apiBase: string): boolean {
  try {
    return new URL(apiBase).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

export function normalizeApiBase(protocolId: string, apiBase: string): string {
  if (
    protocolId !== "openai-compatible" &&
    protocolId !== "openai-chat-completions"
  ) {
    return apiBase;
  }

  try {
    const url = new URL(apiBase);
    if (
      url.hostname.toLowerCase() === "api.deepseek.com" &&
      (url.pathname === "" || url.pathname === "/" || url.pathname === "/v1")
    ) {
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    return apiBase;
  }
  return apiBase;
}

export function getDefaultModel(protocolId: string, apiBase: string): string {
  if (
    (protocolId === "openai-compatible" ||
      protocolId === "openai-chat-completions") &&
    isDeepSeekBase(apiBase)
  ) {
    return "deepseek-chat";
  }
  return (
    PROTOCOLS.find((protocol) => protocol.id === protocolId)?.defaultModel ?? ""
  );
}

export function mapProtocolToProvider(
  protocolId: string,
  apiBase = "",
): string {
  if (
    (protocolId === "openai-compatible" ||
      protocolId === "openai-chat-completions") &&
    isDeepSeekBase(apiBase)
  ) {
    return "deepseek";
  }

  switch (protocolId) {
    case "anthropic-messages":
      return "anthropic";
    case "google-generative-ai":
      return "gemini";
    case "deepseek-global-preset":
    case "zhipu-global-preset":
      return "anthropic";
    case "moonshot-cn-preset":
      return "moonshot";
    case "qwen-cn-preset":
    case "siliconflow-cn-preset":
    case "minimax-global-preset":
    case "minimax-cn-preset":
    case "zhipu-cn-preset":
    case "xiaomi-mimo-cn-preset":
    case "openrouter-global-preset":
    case "groq-global-preset":
    case "together-global-preset":
    case "fireworks-global-preset":
    case "mistral-global-preset":
    case "nebius-global-preset":
    case "step-cn-preset":
    case "baichuan-cn-preset":
    case "zero-one-cn-preset":
      return "openai";
    case "openai-chat-completions":
    case "openai-responses":
    case "openai-compatible":
      return "openai";
    default:
      return protocolId;
  }
}

/**
 * Writes the setup as the one config file. Only what was answered is recorded:
 * the capabilities are left off entirely rather than guessed, so the provider
 * adapter decides what it supports instead of the setup claiming it does.
 */
/**
 * The context window written for a model. A preset that knows its vendor's
 * window uses it; anything else gets the 200k most long-context models ship.
 * The value is a default the provider never states, and it stays editable in
 * the config file.
 */
export async function fetchModelIds(options: {
  apiBase: string;
  apiKey: string;
  modelsPath?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const base = new URL(options.apiBase);
  // A vendor's listing usually sits under the same version prefix as its
  // requests. DeepSeek is the exception: it lists models on the origin root.
  const prefix = base.pathname.replace(/\/+$/, "");
  const listingPath =
    options.modelsPath ?? `${prefix === "" ? "" : prefix}/models`;
  const url = new URL(listingPath, base.origin).href;
  const headerSets: Record<string, string>[] = [
    { Authorization: `Bearer ${options.apiKey}` },
    {
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
    },
  ];
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let failure: string | undefined;
  let answered = false;
  for (const headers of headerSets) {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (!response.ok) {
      failure = `HTTP ${response.status}`;
      continue;
    }
    answered = true;
    const body = (await response.json().catch(() => undefined)) as
      { data?: Array<{ id?: string }> } | undefined;
    const ids = (body?.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    if (ids.length > 0) return ids;
  }
  // A provider that answered but listed nothing is a fact the caller shows;
  // every attempt failing is a different fact, and swallowing it would make a
  // refused key look like an empty catalogue.
  if (!answered) {
    throw new Error(
      `Could not list models at ${url}: ${failure ?? "no attempt succeeded"}`,
    );
  }
  return [];
}

export function contextLengthFor(setup: ProviderSetup): number {
  const preset = PROTOCOLS.find((protocol) => protocol.id === setup.protocol);
  return preset?.contextLength ?? DEFAULT_CONTEXT_LENGTH;
}

export function buildConfigYaml(setup: ProviderSetup): string {
  const apiBase = normalizeApiBase(setup.protocol, setup.apiBase);
  // The model field accepts several ids separated by spaces; every id becomes
  // its own selectable entry under one provider and key.
  const modelIds = (setup.model || getDefaultModel(setup.protocol, apiBase))
    .split(/\s+/)
    .filter((id) => id !== "");
  const lines = ["name: TNT", "models:"];

  for (const model of modelIds) {
    lines.push(
      `  - name: "${escapeYaml(model)}"`,
      `    provider: ${mapProtocolToProvider(setup.protocol, apiBase)}`,
      `    model: "${escapeYaml(model)}"`,
      // A default the provider never states: the window the vendor declares,
      // or the 200k most long-context models ship. Editable per entry here.
      `    contextLength: ${contextLengthFor(setup)}`,
    );

    if (
      setup.protocol === "openai-chat-completions" ||
      setup.protocol === "openai-responses" ||
      setup.protocol === "openai-compatible" ||
      setup.protocol.endsWith("-preset")
    ) {
      // The switch is OpenAI-shaped; an Anthropic-shaped preset has no
      // responses route, and the key would only confuse the adapter.
      if (mapProtocolToProvider(setup.protocol, apiBase) === "openai") {
        lines.push(
          `    useResponsesApi: ${setup.protocol === "openai-responses"}`,
        );
      }
    }

    if (apiBase) {
      lines.push(`    apiBase: "${escapeYaml(apiBase)}"`);
    }

    lines.push(`    apiKey: "${escapeYaml(setup.apiKey)}"`);
  }

  lines.push("");

  return lines.join("\n");
}

export function writeConfig(contents: string): void {
  const configDir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  writeFileAtomically(CONFIG_PATH, contents);
  setConfigFilePermissions(CONFIG_PATH);
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export async function checkHasAcceptableModel(
  configPath: string,
): Promise<boolean> {
  try {
    if (!fs.existsSync(configPath)) {
      return false;
    }
    const content = fs.readFileSync(configPath, "utf8");
    return /provider:\s*\S+/.test(content);
  } catch {
    return false;
  }
}
