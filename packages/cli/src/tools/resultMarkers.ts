/**
 * Markers the tool layer writes into the result text that goes back to the
 * model. They are matched later to decide what to show the user, so they live
 * here rather than as literals copied into both sides: a reworded producer
 * would otherwise change nothing and silently leave the UI labelling the
 * result as something else.
 *
 * These strings are model-facing and stay in English; only the labels derived
 * from them are translated.
 */
export const MARKER_PERMISSION_DENIED = "Permission denied by user";
export const MARKER_FILE_CREATED = "Successfully created file";
export const MARKER_FILE_EDITED = "Successfully edited";
export const MARKER_TASK_LIST = "Task list";
