import { AssistantUnrolled, ModelConfig } from "@tnt/config-yaml";
import { BaseLlmApi } from "@tnt/openai-adapters";
import type { Session } from "core/index.js";

import { QuestionRequestedEvent } from "../../services/QuizService.js";
import { ToolCallPreview } from "../../tools/types.js";

export interface UseChatProps {
  assistant?: AssistantUnrolled;
  model?: ModelConfig;
  llmApi?: BaseLlmApi;
  initialPrompt?: string;
  resume?: boolean;
  fork?: string;
  additionalRules?: string[];
  additionalPrompts?: string[];
  onShowConfigSelector: () => void;
  onShowMCPSelector: () => void;
  onShowUpdateSelector: () => void;
  onShowModelSelector?: () => void;
  onShowSessionSelector?: () => void;
  onShowSubagentsSelector?: () => void;
  onLoadSession?: (sessionId: string) => void | Promise<void>;
  onShowJobsSelector?: () => void;
  onShowExportSelector?: () => void;
  onReload?: () => Promise<void>;
  onClear?: () => void;
  onRefreshStatic?: () => void;
  // Remote mode props
  isRemoteMode?: boolean;
  remoteUrl?: string;
  /**
   * True while a delegated transcript is open. Slash commands still work so
   * the user can leave it, but new turns are refused.
   */
  isReadOnlySession?: boolean;
  onShowDiff?: (diffContent: string) => void;
  onShowStatusMessage?: (message: string) => void;
}

export interface AttachedFile {
  path: string;
  content: string;
}

export interface ActivePermissionRequest {
  toolName: string;
  toolArgs: any;
  requestId: string;
  toolCallPreview?: ToolCallPreview[];
  hasDynamicEvaluation?: boolean;
}

export type ActiveQuizQuestion = QuestionRequestedEvent;

export interface RemoteServerState {
  session: Session;
  isProcessing: boolean;
  messageQueueLength: number;
  pendingPermission?: {
    toolName: string;
    toolArgs: any;
    requestId: string;
    toolCallPreview?: any[];
  };
}

export type { SlashCommandResult } from "../../slash/types.js";
