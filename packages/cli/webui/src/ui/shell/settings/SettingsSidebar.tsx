import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { ShellIcon } from "../icons.tsx";
import { sectionText, shellCopy } from "../ui-copy.ts";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./types.ts";
import css from "./SettingsSidebar.module.css";

export interface SettingsSidebarProps {
  activeSection: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  onBack: () => void;
}

/**
 * The Settings page's own left rail. Opening Settings replaces the chat
 * sidebar instead of nesting a second navigation inside the content area.
 */
export function SettingsSidebar({
  activeSection,
  onSelectSection,
  onBack,
}: SettingsSidebarProps) {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);

  return (
    <aside className={css.sidebar}>
      <header className={css.header}>
        <button
          type="button"
          className={css.back}
          aria-label={copy.backToChat}
          onClick={onBack}
        >
          <ShellIcon glyph="arrow-left" size={14} />
        </button>
        <span className={css.title}>{copy.settings}</span>
      </header>

      <nav className={css.nav} aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((section) => {
          const text = sectionText(copy, section.id);
          return (
            <button
              key={section.id}
              type="button"
              className={css.navRow}
              data-active={section.id === activeSection}
              aria-current={section.id === activeSection ? "page" : undefined}
              onClick={() => onSelectSection(section.id)}
            >
              <ShellIcon glyph={section.glyph} size={14} />
              <span>{text.label}</span>
            </button>
          );
        })}
      </nav>

      <div className={css.footer}>
        <span className={css.footerLabel}>{copy.tntSettings}</span>
      </div>
    </aside>
  );
}
