import {
  ToCoreFromWebviewProtocol,
  ToWebviewFromCoreProtocol,
} from "./coreWebview.js";

// Message types to pass through from webview to core
// Note: If updating these values, mirror the change in the editor bridge that
// consumes this list, or its dispatch will drift.
export const WEBVIEW_TO_CORE_PASS_THROUGH: (keyof ToCoreFromWebviewProtocol)[] =
  [
    "ping",
    "abort",
    "history/list",
    "history/delete",
    "history/load",
    "history/save",
    "history/clear",
    "devdata/log",
    "config/addModel",
    "config/newPromptFile",
    "config/newAssistantFile",
    "config/ideSettingsUpdate",
    "config/addLocalWorkspaceBlock",
    "config/addGlobalRule",
    "config/deleteRule",
    "config/getSerializedProfileInfo",
    "config/deleteModel",
    "config/refreshProfiles",
    "config/openProfile",
    "config/updateSharedConfig",
    "config/updateSelectedModel",
    "mcp/reloadServer",
    "mcp/getPrompt",
    "mcp/startAuthentication",
    "mcp/removeAuthentication",
    "mcp/setServerEnabled",
    "context/getContextItems",
    "context/getSymbolsForFiles",
    "context/loadSubmenuItems",
    "context/addDocs",
    "context/removeDocs",
    "context/indexDocs",
    "tts/kill",
    "llm/complete",
    "llm/streamChat",
    "llm/listModels",
    "llm/compileChat",
    "streamDiffLines",
    "chatDescriber/describe",
    "conversation/compact",
    "stats/getTokensPerDay",
    "stats/getTokensPerModel",
    "rtk/getGain",
    "rtk/install",
    "rtk/upgrade",
    "skills/list",
    "skills/openFile",
    // Codebase
    "index/setPaused",
    "index/forceReIndex",
    "index/indexingProgressBarInitialized",
    // Docs, etc.
    "indexing/reindex",
    "indexing/abort",
    "indexing/setPaused",
    "docs/initStatuses",
    "docs/getDetails",
    "docs/getIndexedPages",
    //
    "onboarding/complete",
    "didChangeSelectedProfile",
    "tools/call",
    "tools/evaluatePolicy",
    "tools/preprocessArgs",
    "isItemTooBig",
    "process/markAsBackgrounded",
    "process/isBackgrounded",
    "process/killTerminalProcess",
    "models/fetch",
  ];

// Message types to pass through from core to webview
// Note: If updating these values, mirror the change in the editor bridge that
// consumes this list, or its dispatch will drift.
export const CORE_TO_WEBVIEW_PASS_THROUGH: (keyof ToWebviewFromCoreProtocol)[] =
  [
    "configUpdate",
    "indexProgress", // Codebase
    "indexing/statusUpdate", // Docs, etc.
    "addContextItem",
    "refreshSubmenuItems",
    "isContinueInputFocused",
    "setTTSActive",
    "getWebviewHistoryLength",
    "getCurrentSessionId",
    "sessionUpdate",
    "didCloseFiles",
    "toolCallPartialOutput",
  ];
