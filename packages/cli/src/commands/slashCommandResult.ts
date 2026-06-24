import type { SlashCommandResult } from "../ui/commands/types.js";

/**
 * What a surface without pickers can do with a dispatched slash command.
 *
 * The terminal opens screens for the selector flags; headless runs and the
 * web UI's message route have nowhere to put them, so they are reported
 * instead of being dropped on the floor.
 */
export type SlashOutcome =
  | { kind: "prompt"; prompt: string }
  | { kind: "print"; output: string }
  | { kind: "compact" }
  | { kind: "clear" }
  | { kind: "exit" }
  | { kind: "unsupported" };

/**
 * Classify a result by the one thing the surface must do next, in the order a
 * result that sets several fields resolves by. `newInput` outranks `output`
 * because a prompt source (a skill, a plugin command) hands over text to send,
 * not text to display.
 */
export function classifySlashResult(result: SlashCommandResult): SlashOutcome {
  if (result.exit) {
    return { kind: "exit" };
  }
  if (result.clear) {
    return { kind: "clear" };
  }
  if (result.compact) {
    return { kind: "compact" };
  }
  if (result.newInput !== undefined && result.newInput !== "") {
    return { kind: "prompt", prompt: result.newInput };
  }
  if (result.diffContent !== undefined) {
    return { kind: "print", output: result.diffContent };
  }
  if (result.output !== undefined && result.output !== "") {
    return { kind: "print", output: result.output };
  }
  return { kind: "unsupported" };
}
