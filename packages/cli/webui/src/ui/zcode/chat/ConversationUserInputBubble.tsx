import { ConversationUserInputBody } from "./ConversationUserInputBody.tsx";

/**
 * ZCode ConversationUserInputBubble with TNT's data shape. The original's
 * plugin, mention and attachment subsystems are deliberately not recreated;
 * this component keeps the same outer class structure and delegates long
 * user text to the verbatim collapsible body above.
 */
export function ConversationUserInputBubble({
  text,
  rowId,
}: {
  text: string;
  rowId: string | number;
}) {
  if (!text.trim()) return null;
  return (
    <div
      data-v4-user-input-bubble="true"
      className="rounded-tr-xs border-border bg-surface text-ui-base text-foreground @min-[624px]/conversation:max-w-xl flex max-w-full flex-col gap-2 rounded-xl border px-4 py-3"
    >
      <ConversationUserInputBody contentText={text} rowId={rowId}>
        {text}
      </ConversationUserInputBody>
    </div>
  );
}
