/**
 * UI strings for the CLI, with a locale the user can switch at runtime.
 *
 * Keys are dotted and grouped by the surface that uses them. A missing key
 * falls back to English rather than printing the key, so a partially
 * translated locale still renders readable text.
 */

import * as fs from "fs";
import * as path from "path";

import { writeFileAtomically } from "core/util/atomicWrite.js";

import { env } from "../config/env.js";

export type Locale = "en" | "zh-CN";

export const LOCALES: Locale[] = ["en", "zh-CN"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

const en = {
  "utils.requestFailed": "Request failed: {message}",
  "utils.envInstallFailed": "Failed to run environment install script: {error}",
  "services.llmInitWithSource": "Failed to initialize LLM with {source} model",
  "services.modelServiceNotInitialized":
    "ModelService not initialized - assistant data missing",
  "services.invalidModelIndex":
    "Invalid model index: {index}. Available models: 0-{max}",
  "services.llmInitSelected": "Failed to initialize LLM with selected model",
  "services.defaultModelNoBlock":
    "Loaded default model contained no model block",
  "services.noModelHeadless":
    "No model specified in headless mode (and failed to load default model)",
  "services.noConfigPathForReload":
    "No configuration path available for reload",
  "services.agentNotMarkdown":
    "Failed to load agent from {path}. Not a markdown file",
  "services.agentLoadFailed": "Failed to load agent from {path}: {message}",
  "services.agentModelUnavailable":
    "Cannot load agent model, failed to load api client service",
  "plugins.manifestNotObject": "Marketplace manifest must be an object",
  "plugins.manifestNoName": "Marketplace manifest has no name",
  "plugins.manifestImpersonates":
    "Marketplace name impersonates an official catalogue: {name}",
  "plugins.manifestNameMismatch":
    "Marketplace declares {name} but was added as {expected}",
  "plugins.manifestNoOwner": "Marketplace manifest has no owner",
  "plugins.manifestPluginsNotList": "Marketplace plugins must be a list",
  "plugins.manifestEntryNotObject": "Marketplace plugin entry is not an object",
  "plugins.manifestEntryNeedsNameAndSource":
    "Marketplace plugin needs both a name and a source",
  "plugins.manifestNotFound": "Marketplace manifest not found at {path}",
  "plugins.manifestOfficialOnly":
    "Marketplace {name} may only be served from the official organization",
  "ui.imageTooLarge":
    "Image size {size}MB exceeds maximum allowed size of {max}MB",
  "ui.tooManyImages": "Cannot add more than {count} images",
  "ui.imageMemoryLimit":
    "Adding image would exceed total memory limit. Current usage: {current}MB, Maximum: {max}MB",
  "tools.patchOutsideWorkspace":
    "ApplyPatch writes inside the workspace only; '{path}' is outside it.",
  "tools.couldNotReadPatch": "Could not read the patch: {message}",
  "tools.authRequired": "Error: Authentication required",
  "tools.reportFailureStatus": "Error reporting failure: {status} {detail}",
  "tools.reportFailure": "Error reporting failure: {message}",
  "tools.setStatusFailedStatus": "Error setting status: {status} {detail}",
  "tools.setStatusFailed": "Error setting status: {message}",
  "tools.modelServiceUninitialized": "Model service is not initialized",
  "tools.filepathMustBeString": "Filepath must be a string",
  "tools.contentMustBeString": "New file content must be a string",
  "tools.commandArgRequired":
    "command arg is required and must be a non-empty string",
  "plugins.unsafeMarketplaceName": "Unsafe marketplace name: {name}",
  "plugins.pathOutsideCache":
    "Refusing to touch a path outside the marketplace cache: {path}",
  "plugins.corruptedRegistry":
    "Corrupted marketplace registry {file}: {message}",
  "plugins.installLocationAbsolute": "installLocation must be absolute: {path}",
  "plugins.notAPluginId": "Not a plugin id: {id}",
  "plugins.couldNotFetch": "Could not fetch marketplace: {reason}",
  "plugins.noAttemptMade": "no attempt made",
  "plugins.npmPackFailed": "npm pack failed for {pkg}: {reason}",
  "plugins.npmPackNoArchive": "npm pack produced no archive for {pkg}",
  "plugins.couldNotUnpack": "Could not unpack {archive}: {reason}",
  "plugins.gitMissingGithub":
    "git is not installed, so a github marketplace cannot be fetched",
  "plugins.gitMissingGit":
    "git is not installed, so a git marketplace cannot be fetched",
  "plugins.noMarketplace": "No marketplace named {name}",
  "plugins.marketplaceNotFetched":
    "Marketplace {name} is not fetched; re-add it to refresh",
  "plugins.marketplaceHasNoPlugin":
    "Marketplace {marketplace} has no plugin named {plugin}",
  "plugins.sourceMissing":
    "Plugin source {source} is missing from marketplace {marketplace}",
  "plugins.needsGit": "Plugin {id} needs git to be installed and on PATH",
  "plugins.subdirMissing":
    "Plugin {id} declares the subdirectory {path}, which the repository does not contain",
  "plugins.unsupportedSource":
    "Unsupported plugin source {source}; supported forms are a relative path, github:<owner>/<repo>, git:<url>, url:<git-url> and npm:<package>",
  "plugins.unsupportedSourceType": "Unsupported plugin source type {type}",
  "plugins.npmNeedsPackage": "An npm plugin source needs a package",
  "plugins.githubNeedsRepo": "A github plugin source needs a repo",
  "plugins.urlNeedsUrl": "A url plugin source needs a url",
  "plugins.gitSubdirNeedsUrlAndPath":
    "A git-subdir plugin source needs a url and a path",
  "plugins.pipUnsupported": "Python package plugins are not supported",
  "plugins.dependencyCycle": "Dependency cycle: {path}",
  "services.apiClientUnavailable": "API client not available",
  "services.configUnavailable": "Config not available",
  "services.configUnavailableForMcp": "Config not available for MCP service",
  "mcp.serversFailedToLoad": "MCP server(s) failed to load:\n{errors}",
  "mcp.serverNotConfigured": "Server {server} not found in configuration",
  "config.noModels": "No models found in the configured assistant",
  "config.noChatModels":
    "No models with the chat role found in the configured assistant",
  "config.llmInitFailed":
    "Failed to initialize LLM. Please check your configuration.",
  "config.hubRemoved":
    'Hub package loading has been removed. Cannot load "{slug}" from hub.',
  "config.ruleFileReadFailed": 'Failed to read rule file "{spec}": {message}',
  "cli.readonlyAutoConflict":
    "Cannot use both --readonly and --auto flags together",
  "config.failedToLoadConfig": "Failed to load config",
  "ui.ttyLess":
    'Cannot start TUI in TTY-less environment. No TTY available for interactive mode.\nFor non-interactive use, run with -p flag:\n  tnt -p "your prompt here"',
  "ui.rawModeRequired":
    'Terminal does not support raw mode required for interactive UI.\nUse -p flag for headless mode: tnt -p "your prompt"',
  "ui.remoteTtyLess":
    "Cannot start remote TUI in TTY-less environment. No TTY available for interactive mode.",
  "ui.remoteRawMode":
    "Terminal does not support raw mode required for interactive UI.",
  "tools.globNeedsPattern":
    "Glob needs a pattern: an empty pattern would list the whole tree.",
  "tools.globNeedsRipgrep":
    "Glob lists files with ripgrep (rg), which is not installed. Use List for one directory, or install rg.",
  "tools.unknownAgentTypeWithList":
    "Unknown agent type: {name}. Available agents: {agents}",
  "tools.unknownAgentType": "Unknown agent type: {name}",
  "tools.noActiveSession": "No active session found",
  "compaction.summaryEmpty": "Compaction summary is empty",
  "compaction.exceedsBudget":
    "Compaction request exceeds the available context budget",
  "compaction.noSummarizer":
    "Compaction has no summarizer: pass options.summarize to write the summary.",
  "compaction.noReduction": "Compaction did not reduce context usage",
  "config.failedToLoadConfigWithReason": "Failed to load config: {reason}",
  "config.failedToLoadConfigDetails": "Failed to load config:\\n{details}",
  "config.failedToLoadDefaultAgentBody":
    "Failed to load default agent. Body:\\n{body}",
  "config.failedToLoadAssistant": "Failed to load assistant.",
  "mcp.toolNotFoundOnServer": "Tool {name} not found on {server}",
  "mcp.toolNotFound": "Tool {name} not found",
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
  "cmd.parent": "Alias for /back",
  "cmd.todos": "List this session's todo items",
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
  "status.output": "Out",
  "status.think": "think",
  "status.image": "Ctrl+V paste image",
  "status.cost": "Cost",
  "status.unpriced": "unpriced",
  "status.prefix": "Prefix",
  "status.cacheExtended": "extended",
  "status.cacheMoved": "moved",
  "status.compact": "Compaction",
  "status.exit": "ctrl+c to exit",
  "mcp.failed": "MCP servers failed to connect: {servers}",
  "mcp.failedHint": "Run /mcp to see the details.",
  "session.empty":
    "No previous sessions found. Start a new conversation with: tnt",
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
  "plugin.noMarketplace": "No marketplace to install from.",
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
  "review.failed": "Error: {message}",
  "review.workerNeedsFork":
    "Error: the review worker must be run as a forked process (via tnt review).",
  "review.hubUnavailable":
    "\\n{names} is not a review source this build can read: hub reviews are not available.\\n  Point --review-agents at a file instead, for example .tnt/agents/my-review.md\\n",
  "review.none":
    "\\nNo reviews found. To add one:\\n  1. Create .tnt/agents/my-review.md with agent instructions\\n  2. Or point at a file: tnt review --review-agents .tnt/agents/my-review.md\\n",
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
  "chat.fileFilterFailed": "Error filtering files:",
  "chat.timedOut":
    "Headless turn cut short after {seconds}s (--request-timeout or TNT_HEADLESS_TIMEOUT)",
  "chat.sessionLoadFailed": "Error loading session:",
  "chat.fileReadFailed": "Error reading file {path}:",
  "chat.browserOpenFailed": "Failed to open browser:",
  "serve.shuttingDown": "\\nShutting down server...",
  "startup.anthropicKey": "Using ANTHROPIC_API_KEY from the environment",
  "cmd.outputStyle": "Output style",
  "cmd.profile": "Mode of work",
  "profile.current": "Mode of work: {name}",
  "profile.noneSelected": "No mode of work selected.",
  "profile.available": "Available modes of work:",
  "profile.desc.default": "the usual agent behaviour",
  "profile.desc.plan": "investigate and plan, write nothing but documents",
  "profile.desc.debug": "find the cause of a failure before changing anything",
  "profile.desc.review": "findings first, ordered by severity",
  "profile.set": "Mode of work set to {name}.",
  "profile.cleared": "Mode of work cleared.",
  "profile.unknown": "No mode of work named {name}.",
  "profile.enteredPlanMode":
    "Plan mode is on; ask for agent mode when you want changes made.",
  "profile.usage": "Usage: /profile <name> | /profile clear",
  "outputStyle.current": "Output style: {name}",
  "outputStyle.none": "No output style selected.",
  "outputStyle.available": "Available styles:",
  "outputStyle.noneAvailable": "No output styles are installed.",
  "outputStyle.set": "Output style set to {name}.",
  "outputStyle.cleared": "Output style cleared.",
  "outputStyle.unknown": "No output style named {name}.",
  "outputStyle.usage":
    "Usage: /output-style <name> | /output-style clear | /output-style save [name]",
  "outputStyle.fromSettings": "Output style: {name} (from settings)",
  "outputStyle.saved": "Default output style set to {name} in {path}.",
  "outputStyle.saveNothing":
    "Nothing to save: select a style first, or pass a style name.",
  "outputStyle.saveFailed": "Could not write {path}: {message}",
  "cmd.diagnostics": "Language server diagnostics",
  "cmd.index": "Codebase index",
  "index.usage": "Usage: /index [status] | /index embed [name]",
  "index.embedNone":
    "No embeddings model is configured. Add a models entry with roles: [embed] - provider transformers.js runs locally without a key.",
  "index.embedList": "Embeddings model: {current}. Configured:",
  "index.embedUnset": "none selected",
  "index.embedUsage": "Usage: /index embed <name>",
  "index.embedSelected":
    "Embeddings model set to {name}. The next search builds the vector index with it.",
  "index.embedUnknown": "No embeddings model named {name} is configured.",
  "index.started":
    "Indexing started in the background. /index status reports progress.",
  "index.progress": "Indexing... {percent}% - {desc}",
  "index.statusBuilt": "The codebase index is built for this workspace.",
  "index.statusFullTextOnly":
    "The codebase index is built for this workspace (full text only). Add a models entry with roles: [embed] - provider transformers.js runs locally without a key - to enable semantic search.",
  "index.statusMissing":
    "No codebase index for this workspace yet. Run /index to build it.",
  "index.disabled":
    "Indexing is not enabled: the config declares no codebase context provider, so there is nothing to index.",
  "index.failed": "Indexing failed: {message}",
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
  "help.title": "Keyboard Shortcuts:",
  "help.navigationTitle": "Navigation:",
  "help.navigationMove": "Navigate command/file suggestions or history",
  "help.navigationComplete": "Complete command or file selection",
  "help.navigationSubmit": "Submit message",
  "help.navigationNewLine": "New line",
  "help.navigationContinue": "Line continuation (at end of line)",
  "help.navigationShellMode": "Shell mode - run shell commands",
  "help.controlsTitle": "Controls:",
  "help.controlsClearInput": "Clear input",
  "help.controlsExit": "Exit application",
  "help.controlsClearScreen": "Clear screen",
  "help.controlsModes": "Cycle permission modes (agent/plan/auto)",
  "help.controlsCancel": "Cancel streaming or close suggestions",
  "help.specialTitle": "Special Characters:",
  "help.specialFiles": "Search and attach files for context",
  "help.specialSlash": "Access slash commands",
  "help.specialBash": "Execute bash commands directly",
  "help.commandsTitle": "Available Commands:",
  "help.commandsSlashHint": "Type {slash} to see available slash commands",
  "help.commandsBashHint":
    "Type {bang} followed by a command to execute bash directly",
  "todos.none": "No todos yet.",
  "todos.header": "Todos ({done}/{total} completed)",
  "mcp.title": "MCP Servers",
  "mcp.serverTitle": "Server: {name}",
  "mcp.serverRestarted": 'Server "{name}" restarted',
  "mcp.serverStopped": 'Server "{name}" stopped',
  "mcp.actionError": "Error: {message}",
  "mcp.backLabel": "Back",
  "mcp.restartAll": "Restart all servers",
  "mcp.stopAll": "Stop all servers",
  "mcp.explore": "Explore MCP Servers",
  "mcp.restartOne": "Restart server",
  "mcp.stopOne": "Stop server",
  "mcp.statusLabel": "Status:",
  "mcp.statusIdle": "idle",
  "mcp.statusConnecting": "connecting",
  "mcp.statusConnected": "connected",
  "mcp.statusError": "error",
  "mcp.statusWithWarnings": "connected (with warnings)",
  "mcp.toolsCount": "tools {count}",
  "mcp.promptsCount": "prompts {count}",
  "mcp.errorLabel": "Error:",
  "mcp.warningsLabel": "Warnings:",
  "mcp.toolsLabel": "Tools: {count}",
  "mcp.promptsLabel": "Prompts: {count}",
  "mcp.commandFragment": " • Command: {command}",
  "mcp.urlFragment": " • URL: {url}",
  "mcp.working": "Working...",
  "mcp.footerHint": "↑/↓ to navigate, Enter to select, Esc to go back",
  "skills.header": "Available skills:",
  "skills.importUsage":
    "Please provide a skill URL or name. Usage: /import-skill <url-or-name>",
  "session.cleared": "Chat history cleared",
  "session.goodbye": "Goodbye!",
  "serve.started": "Server started on http://localhost:{port}",
  "serve.bindFailed": "Error: could not bind to {host}:{port} - {message}",
  "serve.endpoints": "Endpoints:",
  "serve.endpointList":
    "  GET  /state      - Get current agent state\n  POST /message    - Send a message (body: { message: string })\n  POST /permission - Approve/reject tool (body: { requestId, approved })\n  POST /pause      - Pause the current agent run\n  GET  /diff       - Get git diff against main branch\n  POST /exit       - Gracefully shut down the server",
  "serve.inactivity":
    "\nServer will shut down after {seconds} seconds of inactivity",
  "serve.configHeader": "\nConfiguration:",
  "serve.assistantLine": "  Assistant: {name}",
  "serve.modelLine": "  Model: {provider}/{model}",
  "serve.configFileLine": "  Config file: {path}",
  "serve.exitRequested": "\nReceived exit request, shutting down server...",
  "serve.processingInitialPrompt": "\nProcessing initial prompt...",
  "serve.skippingInitialPrompt":
    "Skipping initial prompt because existing conversation history was found.",
  "serve.inactivityShutdown":
    "\nShutting down due to {seconds} seconds of inactivity",
  "checks.summary.passed": "{count} passed",
  "checks.summary.failing": "{count} failing",
  "checks.summary.pending": "{count} pending",
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
  "common.agentConfigReadFailed":
    "Warning: Could not read agent configuration file:",
  "common.ruleProcessFailed":
    'Warning: Failed to process rule "{rule}": {message}',
  "common.assistantsFallback":
    "Failed to load user assistants, falling back to default agent",
  "common.warningDetail": "Warning: {detail}",
  "common.verboseLogging": "Verbose logging enabled (session: {session})",
  "common.logsAt": "Logs: {path}",
  "common.filterSession":
    "Filter this session: grep '\\[{sessionId}\\]' {path}",
  "common.unknownCommand": "Error: Unknown command '{command}'\n",
  "cli.formatRequiresPrint":
    "Error: --format flag can only be used with -p/--print flag",
  "cli.silentRequiresPrint":
    "Error: --silent flag can only be used with -p/--print flag",
  "cli.outputSchemaRequiresPrint":
    "Error: --output-schema flag can only be used with -p/--print flag",
  "cli.invalidFormat":
    'Error: Unsupported --format "{value}". Expected one of: {expected}',
  "cli.invalidMaxSteps":
    'Error: --max-steps expects a whole number of rounds of 1 or more, got "{value}".',
  "cli.invalidRequestTimeout":
    'Error: --request-timeout expects a whole number of seconds of 0 or more, got "{value}"',
  "cli.conflictingReadonlyAuto":
    "Error: Cannot use both --readonly and --auto flags together",
  "cli.modeConflictsWithReadonlyAuto":
    "Error: Cannot use --mode together with --readonly or --auto",
  "cli.invalidMode":
    'Error: Invalid --mode "{value}". Expected one of: agent, plan, auto',
  "cli.conflictingResumeFork":
    "Error: Cannot use both --resume and --fork flags together",
  "cli.forkRequiresSessionId":
    "Error: --fork requires a session ID (e.g., --fork abc123)",
  "cli.invalidConfigPath": "Error: --config must be a valid path",
  "cli.allowRequiresTool":
    "Error: --allow requires a tool name (e.g., --allow readFile)",
  "cli.askRequiresTool":
    "Error: --ask requires a tool name (e.g., --ask writeFile)",
  "cli.excludeRequiresTool":
    "Error: --exclude requires a tool name (e.g., --exclude Write)",
  "cli.invalidNumericFlag":
    'Error: --{name} expects a whole number between 1 and {max}, got "{value}".',
  "cli.noModelsFound": "No models were found.",
  "cli.noApiClient": "No LLM API instance found.",
  "cli.headlessNeedsPrompt":
    'Headless mode requires a prompt. Use: tnt -p "your prompt"\nOr pipe input: echo "prompt" | tnt -p\nOr use agent files: tnt -p --agent my-org/my-agent\nNote: Agent files must contain a prompt field.',
  "serve.servicesUnavailable": "Failed to initialize required services",
  "cli.promptRequired":
    "Error: A prompt is required when using the -p/--print flag, unless --prompt, --agent, or --resume is provided.",
  "cli.usageExamples": "Usage examples:",
  "stream.contextLimitAfterCompaction":
    "Context limit exceeded even after compaction: {error}",
  "stream.contextLimitCompactionFailed":
    "Context limit exceeded and compaction failed. Unable to continue.",
  "stream.contextValidationFailed": "Context length validation failed: {error}",
  "auth.loginUnavailable":
    "Login is not available. Hub authentication has been removed.",
  "startup.failedToLoadConfigFrom":
    'Failed to load config from "{path}": {error}',
  "config.invalidAssistantSlug":
    'Invalid assistant slug format. Expected "owner/package", got: {slug}',
  "config.unknownConfigSourceType": "Unknown config source type: {type}",
  "config.invalidSavedConfigUri": "Invalid saved config URI: {uri}",
  "cli.foundValidationErrors": "Found {count} validation errors.",
  "chat.blockedByPromptHook": "blocked by UserPromptSubmit hook",
  "cli.unsupportedFormat":
    'Error: Unsupported --format "{value}" for tnt {command}. Expected: {expected}',
  "common.slashUnknownCommand": "Unknown command: {command}",
  "debug.overallStatus": "Overall Status:",
  "debug.individualServices": "Individual Services:",
  "debug.introConditions": "Intro Message Conditions:",
  "debug.noAuth": "No auth config",
  "debug.noConfig": "No config",
  "debug.noModel": "No model",
  "debug.noMcp": "No MCP service",
  "debug.apiReady": "API client ready",
  "debug.noApi": "No API client",
  "debug.resourceError": "Resource monitoring error",
  "debug.label": "Debug: ",
  "debug.current": "Current: ",
  "debug.peak": "Peak: ",
  "debug.average": "Average: ",
  "jobs.none": "No background jobs",
  "jobs.backHint": "Press Esc to go back",
  "jobs.listHint": "Press Esc/b to go back, x to cancel job",
  "jobs.status": "Status:",
  "jobs.duration": "Duration:",
  "jobs.command": "Command:",
  "jobs.exitCode": "Exit Code:",
  "jobs.error": "Error:",
  "jobs.outputTail": "Last 10 lines of output:",
  "permission.continue": "Continue",
  "permission.continueThisSession": "Continue + don't ask again this session",
  "permission.continueDontAsk": "Continue + don't ask again",
  "permission.tellDifferently": "No, and tell Continue what to do differently",
  "permission.prompt": "Would you like to continue?",
  "edit.none": "No user messages to edit.",
  "edit.exitHint": "Press Esc to exit",
  "edit.inputHint": "Enter to submit, Esc to cancel, Shift+Enter for newline",
  "edit.prompt": "Select a message to edit:",
  "tool.executionFailed": "Tool execution failed",
  "goal.label": "Goal: ",
  "session.you": "You",
  "session.assistant": "Assistant",
  "selector.loading": "Loading...",
  "quiz.typeAnswer": "Type answer, Enter submit",
  "mcp.none": "No servers configured",
  "mcp.hubOpened": "Opened MCP servers hub in browser",
  "tool.willCall": "Will call {name}",
  "tool.todosCount": "Todos {done}/{total}",
  "language.changed": "Language set to {locale}",
};

export type TranslationKey = keyof typeof en;

const zhCN: Record<TranslationKey, string> = {
  "utils.requestFailed": "请求失败：{message}",
  "utils.envInstallFailed": "运行环境安装脚本失败：{error}",
  "services.llmInitWithSource": "初始化 {source} 模型失败",
  "services.modelServiceNotInitialized": "ModelService 未初始化：缺少助手数据",
  "services.invalidModelIndex": "无效的模型索引：{index}。可用模型：0-{max}",
  "services.llmInitSelected": "初始化所选模型失败",
  "services.defaultModelNoBlock": "加载的默认模型不含 model 块",
  "services.noModelHeadless": "无头模式未指定模型（且加载默认模型失败）",
  "services.noConfigPathForReload": "没有可用于重新加载的配置路径",
  "services.agentNotMarkdown": "无法从 {path} 加载智能体：不是 Markdown 文件",
  "services.agentLoadFailed": "无法从 {path} 加载智能体：{message}",
  "services.agentModelUnavailable":
    "无法加载智能体模型：API 客户端服务加载失败",
  "plugins.manifestNotObject": "插件市场清单必须是一个对象",
  "plugins.manifestNoName": "插件市场清单缺少 name",
  "plugins.manifestImpersonates": "插件市场名称冒充官方目录：{name}",
  "plugins.manifestNameMismatch":
    "插件市场声明为 {name}，但添加时名为 {expected}",
  "plugins.manifestNoOwner": "插件市场清单缺少 owner",
  "plugins.manifestPluginsNotList": "插件市场的 plugins 必须是列表",
  "plugins.manifestEntryNotObject": "插件市场中的插件条目不是对象",
  "plugins.manifestEntryNeedsNameAndSource":
    "插件市场条目需要同时提供 name 与 source",
  "plugins.manifestNotFound": "未找到插件市场清单：{path}",
  "plugins.manifestOfficialOnly": "插件市场 {name} 只能由官方组织提供",
  "ui.imageTooLarge": "图片大小 {size}MB 超过允许的上限 {max}MB",
  "ui.tooManyImages": "最多只能添加 {count} 张图片",
  "ui.imageMemoryLimit":
    "添加图片会超出总内存上限。当前用量：{current}MB，上限：{max}MB",
  "tools.patchOutsideWorkspace":
    "ApplyPatch 只能写入工作区内部；'{path}' 在工作区之外。",
  "tools.couldNotReadPatch": "无法读取补丁：{message}",
  "tools.authRequired": "错误：需要身份验证",
  "tools.reportFailureStatus": "上报失败时出错：{status} {detail}",
  "tools.reportFailure": "上报失败时出错：{message}",
  "tools.setStatusFailedStatus": "设置状态失败：{status} {detail}",
  "tools.setStatusFailed": "设置状态失败：{message}",
  "tools.modelServiceUninitialized": "模型服务尚未初始化",
  "tools.filepathMustBeString": "filepath 必须是字符串",
  "tools.contentMustBeString": "新文件内容必须是字符串",
  "tools.commandArgRequired": "command 参数必填，且必须是非空字符串",
  "plugins.unsafeMarketplaceName": "不安全的插件市场名称：{name}",
  "plugins.pathOutsideCache": "拒绝操作插件市场缓存之外的路径：{path}",
  "plugins.corruptedRegistry": "插件市场注册表已损坏 {file}：{message}",
  "plugins.installLocationAbsolute": "installLocation 必须是绝对路径：{path}",
  "plugins.notAPluginId": "不是有效的插件 id：{id}",
  "plugins.couldNotFetch": "无法获取插件市场：{reason}",
  "plugins.noAttemptMade": "未尝试获取",
  "plugins.npmPackFailed": "npm pack 失败（{pkg}）：{reason}",
  "plugins.npmPackNoArchive": "npm pack 未产出归档：{pkg}",
  "plugins.couldNotUnpack": "无法解包 {archive}：{reason}",
  "plugins.gitMissingGithub": "未安装 git，无法获取 github 插件市场",
  "plugins.gitMissingGit": "未安装 git，无法获取 git 插件市场",
  "plugins.noMarketplace": "未找到名为 {name} 的市场",
  "plugins.marketplaceNotFetched": "市场 {name} 尚未抓取；请重新添加以刷新",
  "plugins.marketplaceHasNoPlugin":
    "市场 {marketplace} 中没有名为 {plugin} 的插件",
  "plugins.sourceMissing": "插件来源 {source} 在市场 {marketplace} 中不存在",
  "plugins.needsGit": "插件 {id} 需要安装 git 并加入 PATH",
  "plugins.subdirMissing": "插件 {id} 声明的子目录 {path} 在仓库中不存在",
  "plugins.unsupportedSource":
    "不支持的插件来源 {source}；支持的形式为相对路径、github:<owner>/<repo>、git:<url>、url:<git-url> 与 npm:<package>",
  "plugins.unsupportedSourceType": "不支持的插件来源类型 {type}",
  "plugins.npmNeedsPackage": "npm 插件来源需要 package",
  "plugins.githubNeedsRepo": "github 插件来源需要 repo",
  "plugins.urlNeedsUrl": "url 插件来源需要 url",
  "plugins.gitSubdirNeedsUrlAndPath": "git-subdir 插件来源需要 url 与 path",
  "plugins.pipUnsupported": "不支持 Python 包插件",
  "plugins.dependencyCycle": "依赖环：{path}",
  "services.apiClientUnavailable": "API 客户端不可用",
  "services.configUnavailable": "配置不可用",
  "services.configUnavailableForMcp": "MCP 服务不可用：配置缺失",
  "mcp.serversFailedToLoad": "MCP 服务器加载失败：\n{errors}",
  "mcp.serverNotConfigured": "配置中未找到服务器 {server}",
  "config.noModels": "所配置的助手中没有模型",
  "config.noChatModels": "所配置的助手中没有具备 chat 角色的模型",
  "config.llmInitFailed": "初始化 LLM 失败。请检查你的配置。",
  "config.hubRemoved": 'Hub 包加载已被移除，无法从 hub 加载 "{slug}"。',
  "config.ruleFileReadFailed": '无法读取规则文件 "{spec}"：{message}',
  "cli.readonlyAutoConflict": "不能同时使用 --readonly 与 --auto。",
  "config.failedToLoadConfig": "加载配置失败",
  "ui.ttyLess":
    '无法在无 TTY 的环境中启动 TUI：交互模式需要终端。\n非交互使用请加 -p 参数：\n  tnt -p "你的提示词"',
  "ui.rawModeRequired":
    '终端不支持交互界面所需的 raw 模式。\n无头模式请加 -p 参数：tnt -p "你的提示词"',
  "ui.remoteTtyLess": "无法在无 TTY 的环境中启动远程 TUI：交互模式需要终端。",
  "ui.remoteRawMode": "终端不支持交互界面所需的 raw 模式。",
  "tools.globNeedsPattern": "Glob 需要一个模式：空模式会列出整棵树。",
  "tools.globNeedsRipgrep":
    "Glob 使用 ripgrep (rg) 列出文件，但它未安装。请改用 List 查看单个目录，或安装 rg。",
  "tools.unknownAgentTypeWithList":
    "未知的智能体类型：{name}。可用智能体：{agents}",
  "tools.unknownAgentType": "未知的智能体类型：{name}",
  "tools.noActiveSession": "未找到活动会话",
  "compaction.summaryEmpty": "压缩摘要为空",
  "compaction.exceedsBudget": "压缩请求超出可用的上下文预算",
  "compaction.noSummarizer":
    "压缩没有摘要器：请传入 options.summarize 来写入摘要。",
  "compaction.noReduction": "压缩未能减少上下文占用",
  "config.failedToLoadConfigWithReason": "加载配置失败：{reason}",
  "config.failedToLoadConfigDetails": "加载配置失败：\\n{details}",
  "config.failedToLoadDefaultAgentBody": "加载默认智能体失败。正文：\\n{body}",
  "config.failedToLoadAssistant": "加载智能体失败。",
  "mcp.toolNotFoundOnServer": "在 {server} 上未找到工具 {name}",
  "mcp.toolNotFound": "未找到工具 {name}",
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
  "cmd.parent": "/back 的别名",
  "cmd.todos": "列出当前会话的待办项",
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
  "status.output": "输出",
  "status.think": "思考",
  "status.image": "Ctrl+V 粘贴图片",
  "status.cost": "费用",
  "status.unpriced": "条未定价",
  "status.prefix": "前缀",
  "status.cacheExtended": "仅追加",
  "status.cacheMoved": "已失效",
  "status.compact": "压缩",
  "status.exit": "ctrl+c 退出",
  "mcp.failed": "MCP 服务器连接失败：{servers}",
  "mcp.failedHint": "输入 /mcp 查看详情。",
  "session.empty": "没有找到历史会话。输入 tnt 开始新会话。",
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
  "plugin.noMarketplace": "没有可用于安装的插件市场。",
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
  "review.failed": "错误：{message}",
  "review.workerNeedsFork":
    "错误：评审工作进程需要由 tnt review 以子进程方式启动。",
  "review.hubUnavailable":
    "\\n{names} 不是本版本可读取的评审来源：hub 评审不可用。\\n  请把 --review-agents 指向文件，例如 .tnt/agents/my-review.md\\n",
  "review.none":
    "\\n未找到评审配置。添加方式：\\n  1. 创建 .tnt/agents/my-review.md 并写入智能体指令\\n  2. 或指向一个文件：tnt review --review-agents .tnt/agents/my-review.md\\n",
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
  "chat.fileFilterFailed": "筛选文件时出错：",
  "chat.timedOut":
    "无头这一轮在 {seconds} 秒后被中断（--request-timeout 或 TNT_HEADLESS_TIMEOUT）",
  "chat.sessionLoadFailed": "加载会话时出错：",
  "chat.fileReadFailed": "读取文件 {path} 时出错：",
  "chat.browserOpenFailed": "无法打开浏览器：",
  "serve.shuttingDown": "\\n正在关闭服务器...",
  "startup.anthropicKey": "使用环境变量中的 ANTHROPIC_API_KEY",
  "cmd.outputStyle": "输出风格",
  "cmd.profile": "工作模式",
  "profile.current": "当前工作模式：{name}",
  "profile.noneSelected": "尚未选择工作模式。",
  "profile.available": "可选工作模式：",
  "profile.desc.default": "常规做事方式",
  "profile.desc.plan": "只调研与出方案，除了文档不改任何文件",
  "profile.desc.debug": "先找到失败原因，再动任何代码",
  "profile.desc.review": "先给发现，按严重度排序",
  "profile.set": "工作模式已设为 {name}。",
  "profile.cleared": "工作模式已清除。",
  "profile.unknown": "没有名为 {name} 的工作模式。",
  "profile.enteredPlanMode": "已进入计划模式；需要改动时请切回 agent 模式。",
  "profile.usage": "用法：/profile <名称> 或 /profile clear",
  "outputStyle.current": "当前输出风格：{name}",
  "outputStyle.none": "尚未选择输出风格。",
  "outputStyle.available": "可用风格：",
  "outputStyle.noneAvailable": "没有已安装的输出风格。",
  "outputStyle.set": "输出风格已设为 {name}。",
  "outputStyle.cleared": "已清除输出风格。",
  "outputStyle.unknown": "没有名为 {name} 的输出风格。",
  "outputStyle.usage":
    "用法：/output-style <名称> | /output-style clear | /output-style save [名称]",
  "outputStyle.fromSettings": "当前输出风格：{name}（来自设置）",
  "outputStyle.saved": "已将默认输出风格设为 {name}（{path}）。",
  "outputStyle.saveNothing": "没有可保存的风格：先选择风格，或传入风格名。",
  "outputStyle.saveFailed": "无法写入 {path}：{message}",
  "cmd.diagnostics": "语言服务器诊断",
  "cmd.index": "代码库索引",
  "index.usage": "用法：/index [status] | /index embed [名称]",
  "index.embedNone":
    "未配置嵌入模型。在 models 中加一条 roles: [embed] 的模型即可——provider 用 transformers.js 可本地运行、无需密钥。",
  "index.embedList": "当前嵌入模型：{current}。可用：",
  "index.embedUnset": "未选择",
  "index.embedUsage": "用法：/index embed <名称>",
  "index.embedSelected": "嵌入模型已设为 {name}，下次检索将用它构建向量索引。",
  "index.embedUnknown": "没有名为 {name} 的嵌入模型配置。",
  "index.started": "索引已在后台开始，/index status 可查看进度。",
  "index.progress": "正在索引……{percent}% - {desc}",
  "index.statusBuilt": "当前工作区已建立代码库索引。",
  "index.statusFullTextOnly":
    "当前工作区已建立代码库索引（仅全文检索）。在 models 中加一条 roles: [embed] 的模型即可启用语义检索——provider 用 transformers.js 可本地运行、无需密钥。",
  "index.statusMissing": "当前工作区还没有代码库索引，运行 /index 构建。",
  "index.disabled":
    "索引未启用：配置中没有声明 codebase 上下文提供者，没有可索引的内容。",
  "index.failed": "索引失败：{message}",
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
  "help.title": "键盘快捷键：",
  "help.navigationTitle": "导航：",
  "help.navigationMove": "在命令/文件建议或历史记录中移动",
  "help.navigationComplete": "补全命令或文件选择",
  "help.navigationSubmit": "提交消息",
  "help.navigationNewLine": "换行",
  "help.navigationContinue": "续行（写在行尾）",
  "help.navigationShellMode": "Shell 模式——直接运行 shell 命令",
  "help.controlsTitle": "控制：",
  "help.controlsClearInput": "清空输入",
  "help.controlsExit": "退出程序",
  "help.controlsClearScreen": "清屏",
  "help.controlsModes": "切换权限模式（agent/plan/auto）",
  "help.controlsCancel": "取消流式输出或关闭建议",
  "help.specialTitle": "特殊字符：",
  "help.specialFiles": "搜索并附加文件作为上下文",
  "help.specialSlash": "打开斜杠命令",
  "help.specialBash": "直接执行 bash 命令",
  "help.commandsTitle": "可用命令：",
  "help.commandsSlashHint": "输入 {slash} 查看可用的斜杠命令",
  "help.commandsBashHint": "输入 {bang} 加命令可直接执行 bash",
  "todos.none": "暂无待办事项。",
  "todos.header": "待办事项（{done}/{total} 已完成）",
  "mcp.title": "MCP 服务器",
  "mcp.serverTitle": "服务器：{name}",
  "mcp.serverRestarted": "服务器“{name}”已重启",
  "mcp.serverStopped": "服务器“{name}”已停止",
  "mcp.actionError": "错误：{message}",
  "mcp.backLabel": "返回",
  "mcp.restartAll": "重启全部服务器",
  "mcp.stopAll": "停止全部服务器",
  "mcp.explore": "浏览 MCP 服务器",
  "mcp.restartOne": "重启服务器",
  "mcp.stopOne": "停止服务器",
  "mcp.statusLabel": "状态：",
  "mcp.statusIdle": "空闲",
  "mcp.statusConnecting": "连接中",
  "mcp.statusConnected": "已连接",
  "mcp.statusError": "错误",
  "mcp.statusWithWarnings": "已连接（有警告）",
  "mcp.toolsCount": "工具 {count}",
  "mcp.promptsCount": "提示词 {count}",
  "mcp.errorLabel": "错误：",
  "mcp.warningsLabel": "警告：",
  "mcp.toolsLabel": "工具：{count}",
  "mcp.promptsLabel": "提示词：{count}",
  "mcp.commandFragment": " • 命令：{command}",
  "mcp.urlFragment": " • URL：{url}",
  "mcp.working": "处理中...",
  "mcp.footerHint": "↑/↓ 移动，Enter 选择，Esc 返回",
  "skills.header": "可用技能：",
  "skills.importUsage":
    "请提供技能 URL 或名称。用法：/import-skill <url-or-name>",
  "session.cleared": "聊天记录已清空",
  "session.goodbye": "再见！",
  "serve.started": "服务器已启动：http://localhost:{port}",
  "serve.bindFailed": "错误：无法绑定 {host}:{port} —— {message}",
  "serve.endpoints": "端点：",
  "serve.endpointList":
    "  GET  /state      - 获取当前智能体状态\n  POST /message    - 发送消息（body: { message: string }）\n  POST /permission - 批准/拒绝工具调用（body: { requestId, approved }）\n  POST /pause      - 暂停当前智能体运行\n  GET  /diff       - 获取相对主分支的 git diff\n  POST /exit       - 优雅关闭服务",
  "serve.inactivity": "\n闲置 {seconds} 秒后服务器将自动关闭",
  "serve.configHeader": "\n配置：",
  "serve.assistantLine": "  助手：{name}",
  "serve.modelLine": "  模型：{provider}/{model}",
  "serve.configFileLine": "  配置文件：{path}",
  "serve.exitRequested": "\n收到退出请求，正在关闭服务器...",
  "serve.processingInitialPrompt": "\n正在处理初始提示词...",
  "serve.skippingInitialPrompt": "已存在会话历史，跳过初始提示词。",
  "serve.inactivityShutdown": "\n已闲置 {seconds} 秒，正在关闭服务器",
  "checks.summary.passed": "{count} 通过",
  "checks.summary.failing": "{count} 失败",
  "checks.summary.pending": "{count} 待处理",
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
  "common.agentConfigReadFailed": "警告：无法读取 agent 配置文件：",
  "common.ruleProcessFailed": "警告：处理规则「{rule}」失败：{message}",
  "common.assistantsFallback": "无法加载用户助手，已回退到默认 agent",
  "common.warningDetail": "警告：{detail}",
  "common.verboseLogging": "已启用详细日志（会话：{session}）",
  "common.logsAt": "日志位置：{path}",
  "common.filterSession": "筛选本次会话：grep '\\[{sessionId}\\]' {path}",
  "common.unknownCommand": "错误：未知命令「{command}」\n",
  "cli.formatRequiresPrint": "错误：--format 只能与 -p/--print 一起使用",
  "cli.silentRequiresPrint": "错误：--silent 只能与 -p/--print 一起使用",
  "cli.outputSchemaRequiresPrint":
    "错误：--output-schema 只能与 -p/--print 一起使用",
  "cli.invalidFormat": '错误：不支持 --format "{value}"。可选值：{expected}',
  "cli.invalidMaxSteps":
    '错误：--max-steps 需要 1 或更大的整数轮数，得到 "{value}"。',
  "cli.invalidRequestTimeout":
    '错误：--request-timeout 需要 0 或更大的整数秒数，得到 "{value}"',
  "cli.conflictingReadonlyAuto": "错误：不能同时使用 --readonly 和 --auto",
  "cli.modeConflictsWithReadonlyAuto":
    "错误：--mode 不能与 --readonly 或 --auto 同时使用",
  "cli.invalidMode": '错误：无效的 --mode "{value}"。可选值：agent, plan, auto',
  "cli.conflictingResumeFork": "错误：不能同时使用 --resume 和 --fork",
  "cli.forkRequiresSessionId":
    "错误：--fork 需要一个会话 ID（例如 --fork abc123）",
  "cli.invalidConfigPath": "错误：--config 必须是有效路径",
  "cli.allowRequiresTool":
    "错误：--allow 需要一个工具名（例如 --allow readFile）",
  "cli.askRequiresTool": "错误：--ask 需要一个工具名（例如 --ask writeFile）",
  "cli.excludeRequiresTool":
    "错误：--exclude 需要一个工具名（例如 --exclude Write）",
  "cli.invalidNumericFlag":
    '错误：--{name} 需要 1 到 {max} 之间的整数，得到 "{value}"。',
  "cli.noModelsFound": "未找到任何模型。",
  "cli.noApiClient": "未找到 LLM API 实例。",
  "cli.headlessNeedsPrompt":
    '无头模式需要一个提示词。用法：tnt -p "你的提示词"\n或者通过管道输入：echo "prompt" | tnt -p\n或者使用 agent 文件：tnt -p --agent my-org/my-agent\n注意：agent 文件必须包含 prompt 字段。',
  "serve.servicesUnavailable": "无法初始化所需服务。",
  "cli.promptRequired":
    "错误：使用 -p/--print 时必须提供提示词，除非使用 --prompt、--agent 或 --resume。",
  "cli.usageExamples": "用法示例：",
  "stream.contextLimitAfterCompaction": "压缩后仍超出上下文限制：{error}",
  "stream.contextLimitCompactionFailed": "超出上下文限制且压缩失败，无法继续。",
  "stream.contextValidationFailed": "上下文长度校验失败：{error}",
  "auth.loginUnavailable": "登录不可用。Hub 认证已移除。",
  "startup.failedToLoadConfigFrom": '无法从 "{path}" 加载配置：{error}',
  "config.invalidAssistantSlug":
    '智能体 slug 格式无效。应为 "owner/package"，实际：{slug}',
  "config.unknownConfigSourceType": "未知的配置来源类型：{type}",
  "config.invalidSavedConfigUri": "无效的已保存配置 URI：{uri}",
  "cli.foundValidationErrors": "发现 {count} 个校验错误。",
  "chat.blockedByPromptHook": "已被 UserPromptSubmit 钩子阻止",
  "cli.unsupportedFormat":
    '错误：tnt {command} 不支持 --format "{value}"。期望：{expected}',
  "common.slashUnknownCommand": "未知命令：{command}",
  "debug.overallStatus": "总体状态：",
  "debug.individualServices": "各服务状态：",
  "debug.introConditions": "欢迎信息条件：",
  "debug.noAuth": "无认证配置",
  "debug.noConfig": "无配置",
  "debug.noModel": "无模型",
  "debug.noMcp": "无 MCP 服务",
  "debug.apiReady": "API 客户端就绪",
  "debug.noApi": "无 API 客户端",
  "debug.resourceError": "资源监控出错",
  "debug.label": "调试：",
  "debug.current": "当前：",
  "debug.peak": "峰值：",
  "debug.average": "平均：",
  "jobs.none": "没有后台任务",
  "jobs.backHint": "按 Esc 返回",
  "jobs.listHint": "按 Esc/b 返回，按 x 取消任务",
  "jobs.status": "状态：",
  "jobs.duration": "耗时：",
  "jobs.command": "命令：",
  "jobs.exitCode": "退出码：",
  "jobs.error": "错误：",
  "jobs.outputTail": "最后 10 行输出：",
  "permission.continue": "继续",
  "permission.continueThisSession": "继续，本次会话内不再询问",
  "permission.continueDontAsk": "继续，且不再询问",
  "permission.tellDifferently": "不继续，并说明应该怎么做",
  "permission.prompt": "是否继续？",
  "edit.none": "没有可编辑的用户消息。",
  "edit.exitHint": "按 Esc 退出",
  "edit.inputHint": "回车提交，Esc 取消，Shift+Enter 换行",
  "edit.prompt": "选择要编辑的消息：",
  "tool.executionFailed": "工具执行失败",
  "goal.label": "目标：",
  "session.you": "你",
  "session.assistant": "助手",
  "selector.loading": "加载中...",
  "quiz.typeAnswer": "输入答案，回车提交",
  "mcp.none": "未配置 MCP 服务器",
  "mcp.hubOpened": "已在浏览器中打开 MCP 服务器中心",
  "tool.willCall": "将调用 {name}",
  "tool.todosCount": "待办 {done}/{total}",
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

// Resolved on use: importing this module must not require the global directory to be
// readable yet (the API transport imports `t` and runs before any settings load).
function settingsPath(): string {
  return path.join(env.continueHome, "settings.json");
}

function readStoredLocale(): Locale | undefined {
  try {
    if (!fs.existsSync(settingsPath())) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    const stored = parsed?.locale;
    return LOCALES.includes(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    const dir = path.dirname(settingsPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath())) {
      existing = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    }
    writeFileAtomically(
      settingsPath(),
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
