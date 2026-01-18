/**
 * The stream engine's helpers, grouped by the job they do:
 *
 * - `permissionFlow.ts` decides whether a call may run (policy, hooks, auto
 *   mode, the user prompt).
 * - `chunkProcessing.ts` folds stream deltas into content and tool calls.
 * - `usageTelemetry.ts` turns provider usage into cost and telemetry.
 * - `toolExecution.ts` preprocesses a batch, gates its concurrency, runs it and
 *   turns each outcome into a tool message.
 *
 * This file stays as the import surface the engine and its tests already use;
 * the implementations moved out so each can be read and tested on its own.
 */
export {
  checkToolPermissionApproval,
  handlePermissionDenied,
  requestUserPermission,
} from "./permissionFlow.js";
export type { ToolResultWithStatus } from "./permissionFlow.js";
export {
  processChunkContent,
  processToolCallDelta,
  trackFirstTokenTime,
} from "./chunkProcessing.js";
export {
  cacheTokensFrom,
  recordRoundAccounting,
  recordStreamTelemetry,
} from "./usageTelemetry.js";
export {
  executeStreamedToolCalls,
  preprocessStreamedToolCalls,
} from "./toolExecution.js";
export { dispatchApprovedCall, noteToolUpdate } from "./toolDispatch.js";
