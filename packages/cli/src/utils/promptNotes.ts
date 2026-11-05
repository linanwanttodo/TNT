/**
 * Harness notes and the user's words have to stay separable in a stored
 * transcript. Everything a turn is served with but the user did not type -
 * what a SessionStart or UserPromptSubmit hook wrote, the files that moved
 * since they were read, the budget a model was given - is prepended to their
 * message, and a session replayed later shows the whole of it. Marking each
 * note as the harness's own keeps the promise on both sides: the model still
 * reads everything, and whatever displays the transcript can say which words
 * were the user's.
 */

/** Opens a block of harness notes; matches the marker the changed-files note uses. */
const REMINDER_OPEN = "<system-reminder>";
/** Closes it. */
const REMINDER_CLOSE = "</system-reminder>";

/** True when the note already carries its own marker, so it is not wrapped twice. */
function isMarked(note: string): boolean {
  return note.trimStart().startsWith(REMINDER_OPEN);
}

/**
 * The prompt a turn is served with: every harness note in its own marked block,
 * then the user's text, unmarked and last.
 * @param userText - what the user actually wrote.
 * @param notes - harness context, in the order it should reach the model.
 * @returns the served prompt.
 */
export function composeServedPrompt(userText: string, notes: string[]): string {
  const marked = notes
    .map((note) => (isMarked(note) ? note : unwrapHookJson(note.trim())))
    .filter((note) => note.trim() !== "")
    .map((note) =>
      isMarked(note)
        ? note
        : `${REMINDER_OPEN}\n${note.trimEnd()}\n${REMINDER_CLOSE}`,
    );
  if (marked.length === 0) return userText;
  return `${marked.join("\n\n")}\n\n${userText}`;
}

/**
 * The two halves of a served prompt, for anything that shows a stored message
 * and has to say what the user typed.
 * @param text - a persisted user message.
 * @returns the user's words, and the harness notes that led with them.
 */
export function splitServedPrompt(text: string): {
  userText: string;
  notes: string[];
} {
  const notes: string[] = [];
  const pattern = /<system-reminder>([\s\S]*?)<\/system-reminder>\s*/g;
  const rest = text.replace(pattern, (_all, body: string) => {
    notes.push(unwrapHookJson(body.trim()));
    return "";
  });
  const userText = rest.trim();
  // A message that was nothing but markers still happened, and an empty bubble
  // explains less than showing what arrived.
  return {
    userText: userText === "" && notes.length > 0 ? text : userText,
    notes,
  };
}

/**
 * A hook that answered with a JSON envelope but skipped the event wrapper
 * leaves the whole envelope as its note. The note is the context it carries,
 * not the braces: peel `additionalContext` out so the transcript never shows
 * the harness's own JSON as though it were prose.
 * @param note - the note body as it was stored.
 * @returns the readable context, or the note untouched when it is not JSON.
 */
function unwrapHookJson(note: string): string {
  if (!note.startsWith("{") || !note.endsWith("}")) return note;
  try {
    const parsed = JSON.parse(note) as {
      additionalContext?: unknown;
      hookSpecificOutput?: { additionalContext?: unknown };
    };
    const context =
      typeof parsed.additionalContext === "string"
        ? parsed.additionalContext
        : typeof parsed.hookSpecificOutput?.additionalContext === "string"
          ? parsed.hookSpecificOutput.additionalContext
          : undefined;
    return context ?? note;
  } catch {
    return note;
  }
}
