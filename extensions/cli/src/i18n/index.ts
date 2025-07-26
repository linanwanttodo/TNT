/**
 * UI strings for the CLI, with a locale the user can switch at runtime.
 *
 * Keys are dotted and grouped by the surface that uses them. A missing key
 * falls back to English rather than printing the key, so a partially
 * translated locale still renders readable text.
 */

import * as fs from "fs";
import * as path from "path";

import { env } from "../env.js";

export type Locale = "en" | "zh-CN";

export const LOCALES: Locale[] = ["en", "zh-CN"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const en = {
  "intro.config": "Config",
  "intro.model": "Model",
  "intro.org": "Org",
  "intro.loading": "Loading...",
  "composer.placeholder":
    "Ask anything, @ for context, / for slash commands, ! for shell mode",
  "composer.placeholderRemote":
    "Ask anything, / for slash commands, ! for shell mode",
  "commands.noMatches": "No matching commands found",
  "commands.navigation": "↑/↓ to navigate, Enter to select, Tab to complete",
  "cmd.help": "Show help message",
  "cmd.clear": "Clear the chat history",
  "cmd.update": "Update the TNT",
  "cmd.info": "Show session information",
  "cmd.model": "Switch between available chat models",
  "cmd.config": "Switch configuration",
  "cmd.mcp": "Manage MCP server connections",
  "cmd.init": "Create an AGENTS.md file",
  "cmd.compact": "Summarize chat history into a compact form",
  "cmd.resume": "Resume a previous chat session",
  "cmd.fork": "Start a forked chat session from the current history",
  "cmd.title": "Set the title for the current session",
  "cmd.goal": "Set the goal for the current session",
  "cmd.plugins": "List installed plugins and what they contribute",
  "cmd.rename": "Rename the current session",
  "cmd.exit": "Exit the chat",
  "cmd.jobs": "List background jobs",
  "cmd.sessions": "Show all chat sessions",
  "cmd.subagents": "Show sessions delegated from the current one",
  "cmd.back": "Return from a delegated session to its parent",
  "cmd.skills": "List all available skills",
  "cmd.importSkill": "Import a skill from a URL or name into ~/.tnt/skills",
  "cmd.export": "Export a session to JSON file",
  "cmd.import": "Import a session from JSON file",
  "cmd.diff": "Show the current diff from the remote environment",
  "cmd.apply": "Apply the current diff to the local working tree",
  "files.noMatches": "No matching files found",
  "interrupted.message": "Interrupted by user - Press enter to continue",
  "action.background": "ctrl+b to background",
  "action.compacting": "Compacting history",
  "status.context": "Context",
  "status.cache": "Cache",
  "status.think": "think",
  "status.image": "Ctrl+V paste image",
  "status.cost": "Cost",
  "status.exit": "ctrl+c to exit",
  "mcp.failed": "MCP servers failed to connect: {servers}",
  "mcp.failedHint": "Run /mcp to see the details.",
  "session.empty":
    "No previous sessions found. Start a new conversation with: tnt",
  "session.newWith": "Start a new conversation with: tnt",
  "session.loading": "Loading sessions...",
  "session.recent": "Recent Sessions",
  "session.local": "(local)",
  "session.remote": "(remote)",
  "session.pressEsc": "Press Esc to exit",
  "session.navigate": "↑/↓ to navigate, Enter to select, Esc to exit",
  "session.moreAbove": "{count} more sessions above...",
  "subagent.empty": "No subagent sessions for this conversation yet.",
  "subagent.title": "Subagent sessions ({count})",
  "subagent.unlabeled": "agent",
  "subagent.breadcrumb": "subagent: {type}",
  "subagent.readOnly":
    "Read-only transcript. Use /back to return to the parent conversation.",
  "subagent.selectorTitle": "Subagent sessions",
  "subagent.loading": "Loading subagent sessions...",
  "subagent.noParent": "This conversation is not a delegated session.",
  "compaction.boundary": "context compacted",
  "compaction.done": "Chat history compacted successfully.",
  "compaction.cancelled": "Compaction cancelled.",
  "compaction.failed": "Compaction failed: {error}",
  "config.loading": "Loading configurations...",
  "config.select": "Select Configuration",
  "config.local": "Local config.yaml",
  "config.loadFailed": "Failed to load configurations",
  "setup.intro":
    "A provider is needed before the first request can be sent. Nothing is sent anywhere while you answer these four questions.",
  "setup.protocol": "Protocol",
  "setup.baseUrl": "Base URL",
  "setup.apiKey": "API key",
  "setup.model": "Model name",
  "setup.apiKeyRequired": "An API key is required.",
  "setup.invalidProtocol":
    "Choose a number between 1 and {count}, or press enter for the default.",
  "setup.saved": "Config file written to {path}",
  "setup.bedrock": "Using AWS Bedrock (CONTINUE_USE_BEDROCK detected)",
  "language.title": "Language",
  "language.changed": "Language set to {locale}",
};

export type TranslationKey = keyof typeof en;

const zhCN: Record<TranslationKey, string> = {
  "intro.config": "配置",
  "intro.model": "模型",
  "intro.org": "组织",
  "intro.loading": "加载中...",
  "composer.placeholder": "输入内容，@ 引用上下文，/ 打开命令，! 执行 shell",
  "composer.placeholderRemote": "输入内容，/ 打开命令，! 执行 shell",
  "commands.noMatches": "没有匹配的命令",
  "commands.navigation": "↑/↓ 选择，Enter 确认，Tab 补全",
  "cmd.help": "显示帮助信息",
  "cmd.clear": "清空对话历史",
  "cmd.update": "更新 TNT",
  "cmd.info": "显示当前会话信息",
  "cmd.model": "切换可用的对话模型",
  "cmd.config": "切换配置",
  "cmd.mcp": "管理 MCP 服务器连接",
  "cmd.init": "创建 AGENTS.md 文件",
  "cmd.compact": "把对话历史压缩成摘要",
  "cmd.resume": "恢复之前的一次会话",
  "cmd.fork": "从当前历史派生一个新会话",
  "cmd.title": "设置当前会话标题",
  "cmd.goal": "设置当前会话目标",
  "cmd.plugins": "列出已安装插件及其贡献的内容",
  "cmd.rename": "重命名当前会话",
  "cmd.exit": "退出对话",
  "cmd.jobs": "列出后台任务",
  "cmd.sessions": "显示全部会话",
  "cmd.subagents": "显示由当前会话派生的子代理会话",
  "cmd.back": "从子代理会话返回其父会话",
  "cmd.skills": "列出全部可用技能",
  "cmd.importSkill": "从 URL 或名称导入技能到 ~/.tnt/skills",
  "cmd.export": "把会话导出为 JSON 文件",
  "cmd.import": "从 JSON 文件导入会话",
  "cmd.diff": "显示远端环境的当前 diff",
  "cmd.apply": "把当前 diff 应用到本地工作区",
  "files.noMatches": "没有匹配的文件",
  "interrupted.message": "已由用户中断 - 按回车继续",
  "action.background": "ctrl+b 放到后台",
  "action.compacting": "正在压缩历史",
  "status.context": "上下文",
  "status.cache": "缓存",
  "status.think": "思考",
  "status.image": "Ctrl+V 粘贴图片",
  "status.cost": "费用",
  "status.exit": "ctrl+c 退出",
  "mcp.failed": "MCP 服务器连接失败：{servers}",
  "mcp.failedHint": "输入 /mcp 查看详情。",
  "session.empty": "没有找到历史会话。输入 tnt 开始新会话。",
  "session.newWith": "输入 tnt 开始新会话：",
  "session.loading": "正在加载会话...",
  "session.recent": "最近的会话",
  "session.local": "（本地）",
  "session.remote": "（远程）",
  "session.pressEsc": "按 Esc 退出",
  "session.navigate": "↑/↓ 移动，Enter 选择，Esc 退出",
  "session.moreAbove": "上方还有 {count} 个会话...",
  "subagent.empty": "本次会话还没有子代理记录。",
  "subagent.title": "子代理会话（{count}）",
  "subagent.unlabeled": "子代理",
  "subagent.breadcrumb": "子代理：{type}",
  "subagent.readOnly": "只读记录。输入 /back 返回父会话。",
  "subagent.selectorTitle": "子代理会话",
  "subagent.loading": "正在加载子代理会话...",
  "subagent.noParent": "当前会话不是子代理会话。",
  "compaction.boundary": "上下文已压缩",
  "compaction.done": "上下文压缩完成。",
  "compaction.cancelled": "已取消压缩。",
  "compaction.failed": "压缩失败：{error}",
  "config.loading": "正在加载配置...",
  "config.select": "选择配置",
  "config.local": "本地配置 config.yaml",
  "config.loadFailed": "加载配置失败",
  "setup.intro":
    "发送第一个请求前需要先配置模型服务。回答这四个问题不会向任何服务发送数据。",
  "setup.protocol": "协议",
  "setup.baseUrl": "接口地址",
  "setup.apiKey": "API 密钥",
  "setup.model": "模型名称",
  "setup.apiKeyRequired": "API 密钥不能为空。",
  "setup.invalidProtocol":
    "请输入 1 到 {count} 之间的数字，直接回车使用默认值。",
  "setup.saved": "配置文件已写入 {path}",
  "setup.bedrock": "正在使用 AWS Bedrock（检测到 CONTINUE_USE_BEDROCK）",
  "language.title": "语言",
  "language.changed": "语言已切换为 {locale}",
};

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  "zh-CN": zhCN,
};

function detectLocale(): Locale {
  // process.env can be absent or partial (some sandboxes stub the process
  // global), so read it defensively rather than assuming it exists.
  const envVars =
    typeof process !== "undefined" && process.env ? process.env : undefined;
  const candidates = [
    envVars?.LC_ALL,
    envVars?.LC_MESSAGES,
    envVars?.LANG,
    envVars?.LANGUAGE,
  ].filter((value): value is string => Boolean(value));
  const fromEnv = candidates.join(":").toLowerCase();
  return fromEnv.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

const SETTINGS_PATH = path.join(env.continueHome, "settings.json");

function readStoredLocale(): Locale | undefined {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    const stored = parsed?.locale;
    return LOCALES.includes(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify({ ...existing, locale }, null, 2),
    );
  } catch {
    // A home directory that cannot be written should not stop the CLI from
    // running; the locale simply will not persist.
  }
}

let currentLocale: Locale | undefined;
const localeListeners = new Set<() => void>();

export function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function getLocale(): Locale {
  if (!currentLocale) {
    currentLocale = readStoredLocale() ?? detectLocale();
  }
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (getLocale() === locale) {
    return;
  }
  currentLocale = locale;
  writeStoredLocale(locale);
  localeListeners.forEach((listener) => listener());
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dictionary = DICTIONARIES[getLocale()] ?? en;
  const text = dictionary[key] ?? en[key] ?? key;
  if (!params) {
    return text;
  }
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    text,
  );
}
