/**
 * UI strings for the CLI, with a locale the user can switch at runtime.
 *
 * Keys are dotted and grouped by the surface that uses them. A missing key
 * falls back to English rather than printing the key, so a partially
 * translated locale still renders readable text.
 */

import * as fs from "fs";
import * as path from "path";

import { env } from "../config/env.js";

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
  "status.compact": "Compaction",
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
  "skills.none":
    "No skills found. Add skills under .tnt/skills or .claude/skills.",
  "session.forkFailed": "Failed to create fork command: {error}",
  "session.titleUsage": "Please provide a title. Usage: /title <your title>",
  "session.titleUpdated": 'Session title updated to: "{title}"',
  "session.titleFailed": "Failed to update title: {error}",
  "session.goalUsage":
    "No goal set. Usage: /goal <objective> or /goal clear to remove it.",
  "session.currentGoal": "Current goal: {goal}",
  "session.goalCleared": "Goal cleared",
  "session.goalSet": "Goal set: {goal}",
  "session.fileNotFound": "File not found: {path}",
  "session.invalidFile":
    "Invalid session file: expected a valid Continue exported session (version 1).",
  "plugin.none": "No plugins installed.",
  "plugin.addMarketplaceHint":
    "Add a marketplace: /plugin marketplace add <name> github:<owner>/<repo>",
  "plugin.installHint": "Then install: /plugin install <name>@<marketplace>",
  "plugin.placeHint":
    "Or place plugins under ~/.tnt/plugins/cache/<marketplace>/<name>/<version>.",
  "plugin.marketplacesRegistered": "{count} marketplace(s) registered",
  "plugin.installedHeader": "Installed plugins ({count})",
  "plugin.installUsage": "Usage: /plugin install <name>[@marketplace]",
  "plugin.uninstallUsage": "Usage: /plugin uninstall <name>[@marketplace]",
  "plugin.needMarketplace": "No marketplaces registered. Add one first.",
  "plugin.chooseMarketplace":
    "Name the marketplace: Registered are {list}. Use {name}@<marketplace>",
  "plugin.uninstallDone":
    "Removed {id} from the registry. Its cached files stay until cleaned.",
  "plugin.uninstallMissing": "No installation recorded for {id}.",
  "plugin.installFailed": "Could not install {reference}: {message}",
  "plugin.installed": "Installed {id} {version}",
  "plugin.alreadyInstalled": "Already installed {id} {version}",
  "plugin.marketplace.empty": "No marketplaces registered.",
  "plugin.marketplace.added": "Added marketplace {name} with {count} plugins.",
  "plugin.marketplace.addedReused":
    "Added marketplace {name} with {count} plugins (reused local files).",
  "plugin.marketplace.removeHint":
    "Removed marketplace {name}. Cached plugins stay until cleaned.",
  "plugin.marketplace.unknown": "No marketplace named {name}.",
  "plugin.marketplace.addUsage":
    "Usage: /plugin marketplace add <name> <source> | /plugin marketplace add <source>",
  "plugin.marketplace.addFailed": "Could not add marketplace: {message}",
  "review.noPatches": "No patches to apply.",
  "review.applyingFixes": "\\nApplying fixes...",
  "review.appliedPatch": "  ✓ Applied patch from {name}",
  "review.patchConflict":
    "  ✗ Could not apply patch from {name} (conflict with working tree)",
  "review.appliedSummary": "\\nApplied {applied}/{total} patches.",
  "review.conflictsSuffix": " {count} had conflicts (see above).",
  "review.noChanges":
    "No changes detected. Make some changes or specify a different base branch with --base.",
  "review.none":
    "\\nNo reviews found. To add reviews:\\n  1. Create .tnt/agents/my-review.md with agent instructions\\n  2. Or specify an agent: tnt review --review-agents org/agent-name\\n  3. Or configure reviews on https://github.com/linanwanttodo/TNT\\n",
  "checks.detecting": "Auto-detecting PR from current branch...",
  "checks.noPr":
    "Could not detect a PR for the current branch. Please provide a PR URL.",
  "checks.foundPr": "Found PR: {url}",
  "checks.diff": "   Diff:",
  "checks.none": "No checks found for this PR.",
  "checks.header": "\\nChecks for {url}\\n",
  "checks.commit": "   Commit: {message}",
  "checks.suggestion": "   Suggestion: {status}",
  "checks.accepting": "\\nAccepting {count} pending suggestion(s)...\\n",
  "checks.accepted": "✓  Accepted: {name}",
  "checks.acceptFailed": "✗  Failed to accept {name}: {message}",
  "checks.noPendingAccept": "No pending suggestions to accept.",
  "checks.rejecting": "\\nRejecting {count} pending suggestion(s)...\\n",
  "checks.rejected": "✗  Rejected: {name}",
  "checks.rejectFailed": "✗  Failed to reject {name}: {message}",
  "checks.noPendingReject": "No pending suggestions to reject.",
  "chat.compacting": "Compacting chat history...",
  "chat.compacted": "Chat history compacted successfully.",
  "chat.compactionSkipped": "Continuing without compaction...",
  "chat.forking": "Forking from existing session...",
  "chat.resuming": "Resuming previous session...",
  "chat.noPreviousSession": "No previous session found, starting fresh...",
  "serve.shuttingDown": "\\nShutting down server...",
  "startup.anthropicKey": "Using ANTHROPIC_API_KEY from the environment",
  "cmd.outputStyle": "Output style",
  "outputStyle.current": "Output style: {name}",
  "outputStyle.none": "No output style selected.",
  "outputStyle.available": "Available styles:",
  "outputStyle.noneAvailable": "No output styles are installed.",
  "outputStyle.set": "Output style set to {name}.",
  "outputStyle.cleared": "Output style cleared.",
  "outputStyle.unknown": "No output style named {name}.",
  "outputStyle.usage": "Usage: /output-style <name> | /output-style clear",
  "outputStyle.fromSettings": "Output style: {name} (from settings)",
  "cmd.diagnostics": "Language server diagnostics",
  "diagnostics.usage": "Usage: /diagnostics <file>",
  "diagnostics.missing": "No such file: {path}",
  "diagnostics.noServers":
    "No language server is running. Declare one in a plugin manifest under lspServers.",
  "diagnostics.clean": "No diagnostics for {path}.",
  "diagnostics.header": "{count} diagnostic(s) for {path}:",
  "diagnostics.severity.error": "error",
  "diagnostics.severity.warning": "warning",
  "diagnostics.severity.info": "info",
  "diagnostics.severity.hint": "hint",
  "serve.started": "Server started on http://localhost:{port}",
  "serve.endpoints": "Endpoints:",
  "serve.endpointList":
    "  GET  /state      - Get current agent state\n  POST /message    - Send a message (body: { message: string })\n  POST /permission - Approve/reject tool (body: { requestId, approved })\n  POST /pause      - Pause the current agent run\n  GET  /diff       - Get git diff against main branch\n  POST /exit       - Gracefully shut down the server",
  "serve.inactivity":
    "\nServer will shut down after {seconds} seconds of inactivity",
  "checks.summary.passed": "{count} passed",
  "checks.summary.failing": "{count} failing",
  "checks.summary.pending": "{count} pending",
  "plugin.marketplace.refreshUsage":
    "Usage: /plugin marketplace refresh [name]",
  "plugin.marketplace.refreshed":
    "Marketplace {name}: {updated} plugin(s) updated",
  "plugin.marketplace.refreshFailed": "Could not refresh {name}: {message}",
  "plugin.marketplace.unchanged": "Marketplace {name} is already up to date.",
  "plugin.marketplace.refreshUpdateFailed":
    "  {id} could not be updated: {message}",
  "plugin.marketplace.unknownAction":
    "Unknown marketplace action: {action}. Use add, list, refresh or remove.",
  "plugin.dependenciesInstalled": "  dependencies: {list}",
  "tool.cancelled": "Cancelled by user",
  "tool.errorSummary": "Error: {message}",
  "tool.pathSummary": "{name} {path} ({count} lines)",
  "tool.outputSummary": "{name} tool output ({count} lines)",
  "tool.fileCreated": "File created successfully",
  "tool.fileUpdated": "File updated successfully",
  "tool.fileEdited": "File edited successfully",
  "tool.listedItem": "Listed {count} item",
  "tool.listedItems": "Listed {count} items",
  "tool.foundMatch": "Found {count} match",
  "tool.foundMatches": "Found {count} matches",
  "tool.taskListStatus": "Task list status:\n{content}",
  "update.error": "Update service error",
  "update.failed": "Update failed",
  "update.preparing": "Preparing update...",
  "update.working": "Working...",
  "update.runVersion": "Run update to v{version}",
  "update.run": "Run update",
  "update.autoOff": "Turn off auto-updates",
  "update.autoOn": "Turn on auto-updates",
  "models.title": "Select Model",
  "models.none": "No chat models available in the configuration",
  "models.loadFailed": "Failed to load models",
  "models.loading": "Loading available models...",
  "mcp.restarted": "All servers restarted",
  "mcp.stopped": "All servers stopped",
  "session.exportMissing": "Failed to export: Session {id} not found",
  "session.exported": "Session exported to {path}",
  "session.exportFailed": "Failed to export session: {message}",
  "common.back": "Back",
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
  "status.compact": "压缩",
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
  "skills.none": "没有找到技能。把技能放在 .tnt/skills 或 .claude/skills 下。",
  "session.forkFailed": "创建 fork 命令失败：{error}",
  "session.titleUsage": "请提供标题。用法：/title <标题>",
  "session.titleUpdated": '会话标题已更新为："{title}"',
  "session.titleFailed": "更新标题失败：{error}",
  "session.goalUsage": "未设置目标。用法：/goal <目标>，或 /goal clear 清除。",
  "session.currentGoal": "当前目标：{goal}",
  "session.goalCleared": "目标已清除",
  "session.goalSet": "目标已设置：{goal}",
  "session.fileNotFound": "文件不存在：{path}",
  "session.invalidFile":
    "会话文件无效：需要 Continue 导出的合法会话（版本 1）。",
  "plugin.none": "未安装任何插件。",
  "plugin.addMarketplaceHint":
    "添加插件市场：/plugin marketplace add <名称> github:<owner>/<repo>",
  "plugin.installHint": "然后安装：/plugin install <名称>@<市场>",
  "plugin.placeHint":
    "或把插件放在 ~/.tnt/plugins/cache/<市场>/<名称>/<版本> 下。",
  "plugin.marketplacesRegistered": "已注册 {count} 个插件市场",
  "plugin.installedHeader": "已安装插件（{count}）",
  "plugin.installUsage": "用法：/plugin install <名称>[@市场]",
  "plugin.uninstallUsage": "用法：/plugin uninstall <名称>[@市场]",
  "plugin.needMarketplace": "尚未注册插件市场，请先添加一个。",
  "plugin.chooseMarketplace": "请指定市场：已注册 {list}。使用 {name}@<市场>",
  "plugin.uninstallDone": "已从注册表移除 {id}，其缓存文件保留待清理。",
  "plugin.uninstallMissing": "没有 {id} 的安装记录。",
  "plugin.installFailed": "无法安装 {reference}：{message}",
  "plugin.installed": "已安装 {id} {version}",
  "plugin.alreadyInstalled": "此前已安装 {id} {version}",
  "plugin.marketplace.empty": "尚未注册插件市场。",
  "plugin.marketplace.added": "已添加市场 {name}，包含 {count} 个插件。",
  "plugin.marketplace.addedReused":
    "已添加市场 {name}，包含 {count} 个插件（复用了本地文件）。",
  "plugin.marketplace.removeHint": "已移除市场 {name}，插件缓存保留待清理。",
  "plugin.marketplace.unknown": "没有名为 {name} 的市场。",
  "plugin.marketplace.addUsage":
    "用法：/plugin marketplace add <名称> <来源> 或 /plugin marketplace add <来源>",
  "plugin.marketplace.addFailed": "添加市场失败：{message}",
  "review.noPatches": "没有可用的补丁。",
  "review.applyingFixes": "\\n正在应用修复...",
  "review.appliedPatch": "  ✓ 已应用补丁 {name}",
  "review.patchConflict": "  ✗ 补丁 {name} 应用失败（与工作区冲突）",
  "review.appliedSummary": "\\n已应用 {applied}/{total} 个补丁。",
  "review.conflictsSuffix": " 其中 {count} 个存在冲突（见上）。",
  "review.noChanges":
    "未检测到改动。请先修改代码，或用 --base 指定其它基线分支。",
  "review.none":
    "\\n未找到评审配置。添加方式：\\n  1. 创建 .tnt/agents/my-review.md 并写入智能体指令\\n  2. 或指定智能体：tnt review --review-agents org/agent-name\\n  3. 或在 https://github.com/linanwanttodo/TNT 上配置评审\\n",
  "checks.detecting": "正在根据当前分支自动检测 PR...",
  "checks.noPr": "无法从当前分支检测到 PR，请提供 PR 链接。",
  "checks.foundPr": "已找到 PR：{url}",
  "checks.diff": "   差异：",
  "checks.none": "该 PR 没有检查项。",
  "checks.header": "\\n{url} 的检查项\\n",
  "checks.commit": "   提交：{message}",
  "checks.suggestion": "   建议：{status}",
  "checks.accepting": "\\n正在接受 {count} 条待处理建议...\\n",
  "checks.accepted": "✓  已接受：{name}",
  "checks.acceptFailed": "✗  接受 {name} 失败：{message}",
  "checks.noPendingAccept": "没有待接受的建议。",
  "checks.rejecting": "\\n正在拒绝 {count} 条待处理建议...\\n",
  "checks.rejected": "✗  已拒绝：{name}",
  "checks.rejectFailed": "✗  拒绝 {name} 失败：{message}",
  "checks.noPendingReject": "没有待拒绝的建议。",
  "chat.compacting": "正在压缩对话历史...",
  "chat.compacted": "对话历史已压缩完成。",
  "chat.compactionSkipped": "未压缩，继续执行...",
  "chat.forking": "正在从已有会话分叉...",
  "chat.resuming": "正在恢复上一个会话...",
  "chat.noPreviousSession": "未找到上一个会话，从头开始...",
  "serve.shuttingDown": "\\n正在关闭服务器...",
  "startup.anthropicKey": "使用环境变量中的 ANTHROPIC_API_KEY",
  "cmd.outputStyle": "输出风格",
  "outputStyle.current": "当前输出风格：{name}",
  "outputStyle.none": "尚未选择输出风格。",
  "outputStyle.available": "可用风格：",
  "outputStyle.noneAvailable": "没有已安装的输出风格。",
  "outputStyle.set": "输出风格已设为 {name}。",
  "outputStyle.cleared": "已清除输出风格。",
  "outputStyle.unknown": "没有名为 {name} 的输出风格。",
  "outputStyle.usage": "用法：/output-style <名称> | /output-style clear",
  "outputStyle.fromSettings": "当前输出风格：{name}（来自设置）",
  "cmd.diagnostics": "语言服务器诊断",
  "diagnostics.usage": "用法：/diagnostics <文件>",
  "diagnostics.missing": "文件不存在：{path}",
  "diagnostics.noServers":
    "没有运行中的语言服务器。请在插件清单的 lspServers 中声明。",
  "diagnostics.clean": "{path} 没有诊断信息。",
  "diagnostics.header": "{path} 共 {count} 条诊断：",
  "diagnostics.severity.error": "错误",
  "diagnostics.severity.warning": "警告",
  "diagnostics.severity.info": "信息",
  "diagnostics.severity.hint": "提示",
  "serve.started": "服务器已启动：http://localhost:{port}",
  "serve.endpoints": "端点：",
  "serve.endpointList":
    "  GET  /state      - 获取当前智能体状态\n  POST /message    - 发送消息（body: { message: string }）\n  POST /permission - 批准/拒绝工具调用（body: { requestId, approved }）\n  POST /pause      - 暂停当前智能体运行\n  GET  /diff       - 获取相对主分支的 git diff\n  POST /exit       - 优雅关闭服务",
  "serve.inactivity": "\n闲置 {seconds} 秒后服务器将自动关闭",
  "checks.summary.passed": "{count} 通过",
  "checks.summary.failing": "{count} 失败",
  "checks.summary.pending": "{count} 待处理",
  "plugin.marketplace.refreshUsage": "用法：/plugin marketplace refresh [名称]",
  "plugin.marketplace.refreshed": "市场 {name}：已更新 {updated} 个插件",
  "plugin.marketplace.refreshFailed": "刷新 {name} 失败：{message}",
  "plugin.marketplace.unchanged": "市场 {name} 已是最新。",
  "plugin.marketplace.refreshUpdateFailed": "  {id} 更新失败：{message}",
  "plugin.marketplace.unknownAction":
    "未知的市场操作：{action}。可用 add、list、refresh、remove。",
  "plugin.dependenciesInstalled": "  依赖：{list}",
  "tool.cancelled": "已被用户取消",
  "tool.errorSummary": "错误：{message}",
  "tool.pathSummary": "{name} {path}（{count} 行）",
  "tool.outputSummary": "{name} 工具输出（{count} 行）",
  "tool.fileCreated": "文件创建成功",
  "tool.fileUpdated": "文件更新成功",
  "tool.fileEdited": "文件编辑成功",
  "tool.listedItem": "已列出 {count} 项",
  "tool.listedItems": "已列出 {count} 项",
  "tool.foundMatch": "找到 {count} 处匹配",
  "tool.foundMatches": "找到 {count} 处匹配",
  "tool.taskListStatus": "任务清单状态：\n{content}",
  "update.error": "更新服务出错",
  "update.failed": "更新失败",
  "update.preparing": "正在准备更新...",
  "update.working": "处理中...",
  "update.runVersion": "更新到 v{version}",
  "update.run": "执行更新",
  "update.autoOff": "关闭自动更新",
  "update.autoOn": "开启自动更新",
  "models.title": "选择模型",
  "models.none": "配置中没有可用的对话模型",
  "models.loadFailed": "加载模型失败",
  "models.loading": "正在加载可用模型...",
  "mcp.restarted": "已重启所有服务器",
  "mcp.stopped": "已停止所有服务器",
  "session.exportMissing": "导出失败：未找到会话 {id}",
  "session.exported": "会话已导出到 {path}",
  "session.exportFailed": "导出会话失败：{message}",
  "common.back": "返回",
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
