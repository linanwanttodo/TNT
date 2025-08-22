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

import { setConfigFilePermissions } from "core/util/paths.js";

import { env } from "./env.js";
import { t } from "../i18n/index.js";
import { question } from "../utils/prompt.js";
import { writeFileAtomically } from "core/util/atomicWrite.js";

export const CONFIG_PATH = path.join(env.continueHome, "config.yaml");

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
  contextLength: number;
  maxTokens: number;
}

export const PROTOCOLS: ProtocolOption[] = [
  {
    id: "openai-chat-completions",
    label: "OpenAI Chat Completions",
    defaultApiBase: "https://api.openai.com/v1/",
    defaultModel: "gpt-4.1",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    defaultApiBase: "https://api.openai.com/v1/",
    defaultModel: "gpt-4.1",
    contextLength: 200_000,
    maxTokens: 32_768,
  },
  {
    id: "anthropic-messages",
    label: "Anthropic Messages",
    defaultApiBase: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5",
    contextLength: 200_000,
    maxTokens: 64_000,
  },
  {
    id: "google-generative-ai",
    label: "Google Generative AI",
    defaultApiBase: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    contextLength: 1_000_000,
    maxTokens: 65_536,
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    defaultApiBase: "",
    exampleApiBase: "https://api.deepseek.com/",
    defaultModel: "",
    contextLength: 128_000,
    maxTokens: 8_192,
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
    await question(
      chalk.white(`\nProtocol [1-${PROTOCOLS.length}, default 1]: `),
    )
  ).trim();

  if (answer === "") {
    return PROTOCOLS[0];
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
export function buildConfigYaml(setup: ProviderSetup): string {
  const apiBase = normalizeApiBase(setup.protocol, setup.apiBase);
  const model = setup.model || getDefaultModel(setup.protocol, apiBase);
  const lines = [
    "name: TNT",
    "version: 1.0.0",
    "schema: v1",
    "models:",
    `  - name: "${escapeYaml(model)}"`,
    `    provider: ${mapProtocolToProvider(setup.protocol, apiBase)}`,
    `    model: "${escapeYaml(model)}"`,
  ];

  if (
    setup.protocol === "openai-chat-completions" ||
    setup.protocol === "openai-responses" ||
    setup.protocol === "openai-compatible"
  ) {
    lines.push(`    useResponsesApi: ${setup.protocol === "openai-responses"}`);
  }

  if (apiBase) {
    lines.push(`    apiBase: "${escapeYaml(apiBase)}"`);
  }

  lines.push(`    apiKey: "${escapeYaml(setup.apiKey)}"`);
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
