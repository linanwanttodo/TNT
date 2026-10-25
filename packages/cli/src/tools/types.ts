import type { ToolPolicy } from "@tnt/terminal-security";

// JSON Schema compatible parameter definition
export interface ParameterSchema {
  type: string;
  description: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, ParameterSchema>;
  items?: {
    type: string;
    properties?: Record<string, ParameterSchema>;
    required?: string[];
  };
}

export interface ToolParametersSchema {
  type: "object";
  required?: string[];
  properties: Record<string, ParameterSchema>;
}

export interface ToolCallPreview {
  type: "text" | "diff" | "checklist";
  content: string;
  color?: string;
  paddingLeft?: number;
}

export interface PreprocessToolCallResult {
  preview?: ToolCallPreview[];
  args: Record<string, any>;
  context?: { toolCallId: string };
}

export interface ToolRunContext {
  toolCallId: string;
  /**
   * Number of tool calls being executed in parallel.
   * Tools should divide their output limits by this number to avoid context overflow.
   */
  parallelToolCallCount: number;
}

/** A bitmap a tool wants the model to see, encoded for a data URL. */
export interface ToolImage {
  mimeType: string;
  /** Base64 payload, without the data-URL prefix. */
  data: string;
}

/**
 * Most tools answer with text. A tool whose result is only useful when looked
 * at - a desktop screenshot - adds images, which the host publishes as an
 * observation the model can see.
 */
export interface ToolResult {
  content: string;
  images?: ToolImage[];
}

export type ToolRunResult = string | ToolResult;

export interface Tool {
  name: string;
  displayName: string;
  description: string;
  parameters: ToolParametersSchema;
  preprocess?: (args: any) => Promise<PreprocessToolCallResult>;
  run: (args: any, context?: ToolRunContext) => Promise<ToolRunResult>;
  readonly?: boolean; // Indicates if the tool is readonly
  isBuiltIn: boolean;
  evaluateToolCallPolicy?: (
    basePolicy: ToolPolicy,
    parsedArgs: Record<string, unknown>,
  ) => ToolPolicy;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  argumentsStr: string;
  startNotified: boolean;
  extra_content?: Record<string, unknown>;
}

export interface PreprocessedToolCall extends ToolCall {
  tool: Tool;
  preprocessResult?: PreprocessToolCallResult;
}
