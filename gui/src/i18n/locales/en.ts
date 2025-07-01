export const en = {
  "sidebar.back": "Back",
  "sidebar.models": "Models",
  "sidebar.rules": "Rules",
  "sidebar.tools": "Tools",
  "sidebar.configs": "Configs",
  "sidebar.indexing": "Indexing",
  "sidebar.settings": "Settings",
  "sidebar.help": "Help",

  "config.screenTooSmall.title": "Screen width too small",
  "config.screenTooSmall.desc":
    "To view settings, please expand the sidebar by dragging the left/right border",

  "settings.title": "User Settings",
  "settings.section.chat": "Chat",
  "settings.showSessionTabs": "Show Session Tabs",
  "settings.showSessionTabs.desc":
    "Displays tabs above the chat as an alternative way to organize and access your sessions.",
  "settings.wrapCodeblocks": "Wrap Codeblocks",
  "settings.wrapCodeblocks.desc":
    "Wraps long lines in code blocks instead of showing horizontal scroll.",
  "settings.showChatScrollbar": "Show Chat Scrollbar",
  "settings.showChatScrollbar.desc": "Enables a scrollbar in the chat window.",
  "settings.ttsOutput": "Text-to-Speech Output",
  "settings.ttsOutput.desc": "Reads LLM responses aloud with TTS.",
  "settings.enableSessionTitles": "Enable Session Titles",
  "settings.enableSessionTitles.desc":
    "Generates summary titles for each chat session after the first message, using the current Chat model.",
  "settings.formatMarkdown": "Format Markdown",
  "settings.formatMarkdown.desc": "If off, shows responses as raw text.",
  "settings.section.appearance": "Appearance",
  "settings.fontSize": "Font Size",
  "settings.fontSize.desc": "Specifies base font size for UI elements.",
  "settings.language": "Language",
  "settings.language.desc":
    "Interface display language. Auto follows the system language.",
  "settings.section.autocomplete": "Autocomplete",
  "settings.multilineAutocompletions": "Multiline Autocompletions",
  "settings.multilineAutocompletions.desc":
    "Controls multiline completions for autocomplete.",
  "settings.auto": "Auto",
  "settings.always": "Always",
  "settings.never": "Never",
  "settings.autocompleteTimeout": "Autocomplete Timeout (ms)",
  "settings.autocompleteTimeout.desc":
    "Maximum time in milliseconds for autocomplete request/retrieval.",
  "settings.autocompleteDebounce": "Autocomplete Debounce (ms)",
  "settings.autocompleteDebounce.desc":
    "Minimum time in milliseconds to trigger an autocomplete request after a change.",
  "settings.disableAutocompleteInFiles": "Disable autocomplete in files",
  "settings.disableAutocompleteInFiles.desc":
    "List of comma-separated glob pattern to disable autocomplete in matching files.",
  "settings.section.experimental": "Experimental",
  "settings.showExperimentalSettings": "Show Experimental Settings",
  "settings.addCurrentFileByDefault": "Add Current File by Default",
  "settings.addCurrentFileByDefault.desc":
    " the currently open file is added as context in every new conversation.",
  "settings.enableExperimentalTools": "Enable experimental tools",
  "settings.enableExperimentalTools.desc":
    " enables access to experimental tools that are still in development.",
  "settings.onlyUseSystemMessageTools": "Only use system message tools",
  "settings.onlyUseSystemMessageTools.desc":
    " Continue will not attempt to use native tool calling and will only use system message tools.",
  "settings.codebaseToolCallingOnly": "@Codebase: use tool calling only",
  "settings.codebaseToolCallingOnly.desc":
    " @codebase context provider will only use tool calling for code retrieval.",
  "settings.streamAfterToolRejection": "Stream after tool rejection",
  "settings.streamAfterToolRejection.desc":
    " streaming will continue after the tool call is rejected.",

  "language.auto": "Auto",
  "language.en": "English",
  "language.zh-CN": "简体中文",

  "addChatModel.title": "Add Chat model",
  "addChatModel.displayName": "Display name",
  "addChatModel.displayName.placeholder": "My model",
  "addChatModel.provider": "Provider",
  "addChatModel.provider.hint":
    "Use OpenAI with a custom API Base for any OpenAI-compatible endpoint.",
  "addChatModel.searchProviders": "Search providers...",
  "addChatModel.modelId": "Model ID",
  "addChatModel.modelId.placeholder": "e.g. gpt-4o, claude-4-sonnet, my-model",
  "addChatModel.fetchModelList": "Fetch model list",
  "addChatModel.fetching": "Fetching...",
  "addChatModel.fetchError":
    "Failed to fetch models. Check your API key and base.",
  "addChatModel.selectModelsToAdd": "Select models to add",
  "addChatModel.apiBase": "API Base (optional)",
  "addChatModel.apiBase.placeholder": "https://api.example.com/v1",
  "addChatModel.apiKey": "API Key (optional)",
  "addChatModel.apiKey.placeholder": "Enter your API key",
  "addChatModel.contextLength": "Context length (optional)",
  "addChatModel.maxOutputTokens": "Max output tokens (optional)",
  "addChatModel.capabilities": "Capabilities",
  "addChatModel.toolUse": "Tool use",
  "addChatModel.imageInput": "Image input",
  "addChatModel.connect": "Connect",
  "addChatModel.willUpdateConfig": "This will update your",
  "addChatModel.configFile": "config file",

  "chat.roleMessage": "{role} Message",
  "chat.thinking": "Thinking",
};

export type TranslationKey = keyof typeof en;
