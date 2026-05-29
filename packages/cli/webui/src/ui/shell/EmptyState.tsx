/**
 * What the canvas shows before a conversation starts: the wordmark, a
 * greeting, and a row of suggestion cards, each with its own icon and the
 * prompt it fills. A card click hands the text to the composer.
 */
import { useState, type CSSProperties } from "react";

import { ShellIcon, type ShellGlyph } from "./icons.tsx";
import css from "./EmptyState.module.css";

/** One suggestion card: icon, label, and the text picking it fills. */
export interface EmptySuggestion {
  glyph: ShellGlyph;
  label: string;
  /** The prompt the composer receives when the card is picked. */
  prompt?: string | undefined;
}

/** Props the empty state renders from. */
export interface EmptyStateProps {
  /** Label of the legacy suggestion pill; still honored when it is the only one. */
  label: string;
  /** Called when the legacy suggestion is picked. */
  onPick?: (() => void) | undefined;
  /** The workspace name the greeting addresses. */
  workspace?: string | undefined;
  /** The suggestion cards, icon first. */
  suggestions?: EmptySuggestion[] | undefined;
  /** Fill the composer with a card's prompt. */
  onSuggest?: ((prompt: string) => void) | undefined;
}

/**
 * The empty state.
 * @param props - the greeting inputs and the suggestion cards.
 * @returns the empty state element.
 */
export function EmptyState({
  label,
  onPick,
  workspace,
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggest,
}: EmptyStateProps) {
  const [picked, setPicked] = useState<string | null>(null);

  const pick = (suggestion: EmptySuggestion) => {
    setPicked(suggestion.label);
    if (suggestion.prompt && onSuggest) {
      onSuggest(suggestion.prompt);
      return;
    }
    onPick?.();
  };

  const greeting = workspace
    ? `What are we building in ${workspace}?`
    : "What are we building?";

  return (
    <div className={css.emptyState}>
      <div className={css.stack}>
        <img src="/tnt-logo.svg" alt="" className={css.mark} />
        <h1 className={css.greeting}>{greeting}</h1>
        {picked ? (
          <div className={css.picked}>{picked}</div>
        ) : (
          <div className={css.cards}>
            {(suggestions.length > 0
              ? suggestions
              : [{ glyph: "lightning" as const, label }]
            ).map((suggestion, index) => (
              <button
                key={suggestion.label}
                type="button"
                className={`${css.card} zcode-draft-prompt-waterfall`}
                style={
                  {
                    "--zcode-draft-prompt-waterfall-delay": `${index * 80}ms`,
                  } as CSSProperties
                }
                onClick={() => pick(suggestion)}
              >
                <ShellIcon
                  glyph={suggestion.glyph}
                  size={14}
                  className={css.cardIcon}
                />
                <span className={css.cardLabel}>{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The cards a plain install shows; each fills the composer with a starter. */
const DEFAULT_SUGGESTIONS: EmptySuggestion[] = [
  {
    glyph: "terminal",
    label: "Explain this codebase",
    prompt: "Explain this codebase: its layout, entry points and how it runs.",
  },
  {
    glyph: "code-brackets",
    label: "Review recent changes",
    prompt: "Review my recent changes and flag anything that looks wrong.",
  },
  {
    glyph: "lightning",
    label: "Turn on auto mode",
    prompt: "",
  },
];
