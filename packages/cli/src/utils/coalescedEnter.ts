/**
 * One stdin read can carry more than one key. Terminals do not promise that a
 * typed Enter arrives in its own read: an IME commit, a fast keystroke burst,
 * and a high-latency link all deliver the text and the Enter together. Some
 * terminals send Enter as a bare "\n", which Ink's key object reports as
 * neither a return nor a newline key.
 *
 * A chunk whose only line break is the trailing one is typed text followed by
 * Enter; callers submit the body. A chunk with more breaks is a paste and is
 * left alone, and callers check paste mode before calling this.
 */
export interface CoalescedEnter {
  /** The typed text before the trailing line break. */
  body: string;
}

export function splitTrailingEnter(input: string): CoalescedEnter | null {
  const match = /\r\n|\r|\n$/.exec(input);
  if (!match) {
    return null;
  }
  const body = input.slice(0, match.index);
  if (body.includes("\r") || body.includes("\n")) {
    return null;
  }
  return { body };
}
