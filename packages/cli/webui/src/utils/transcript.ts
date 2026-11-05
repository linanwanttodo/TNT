/**
 * Separating the user's words from what the harness added to their message.
 *
 * A turn is served with the notes a SessionStart or UserPromptSubmit hook
 * wrote, the files that moved, the budget the model was given - each in a
 * `<system-reminder>` block in front of what the user typed, and the whole of
 * it stored as that user message. A transcript that shows a stored message
 * must say which words were the person's.
 */

const REMINDER = /<system-reminder>([\s\S]*?)<\/system-reminder>\s*/g;

/**
 * A hook that answered with a JSON envelope but skipped the event wrapper
 * leaves the whole envelope as its note. The note is the context it carries,
 * not the braces: peel `additionalContext` out so the transcript never shows
 * the harness's own JSON as though it were prose.
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

/**
 * The two halves of a stored user message.
 * @param text - the message as the session stored it.
 * @returns what the user typed, and the notes the harness led with.
 */
export function splitServedPrompt(text: string): {
  userText: string;
  notes: string[];
} {
  const notes: string[] = [];
  const userText = text
    .replace(REMINDER, (_all, body: string) => {
      notes.push(unwrapHookJson(body.trim()));
      return "";
    })
    .trim();
  // A message that was nothing but markers still happened; showing the raw
  // block explains more than an empty bubble would.
  return {
    userText: userText === "" && notes.length > 0 ? text : userText,
    notes,
  };
}
