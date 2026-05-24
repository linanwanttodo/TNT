import { useEffect, useRef, useState } from "react";
import {
  IconChevronDownOutlineRegular,
  IconGlobeOutlineRegular,
  IconInfoOutlineRegular,
  IconLinkOutlineRegular,
  IconSettingsOutlineRegular,
} from "../primitives/icons/index.tsx";

import {
  useUiPreferences,
  type ThemeChoice,
} from "../../stores/ui-preferences.js";
import { ShellIcon } from "./icons.tsx";
import { shellCopy } from "./ui-copy.js";
import css from "./AccountMenu.module.css";

export interface AccountMenuProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const ABOUT_URL = "https://linanwanttodo.github.io/TNT/";

/**
 * The bottom account menu: settings, theme, language and about. The two
 * preference rows expose their options inline instead of leaving a dead
 * chevron; About opens the published TNT site.
 */
export function AccountMenu({
  open,
  onClose,
  onOpenSettings,
}: AccountMenuProps) {
  const theme = useUiPreferences((state) => state.theme);
  const language = useUiPreferences((state) => state.language);
  const setTheme = useUiPreferences((state) => state.setTheme);
  const setLanguage = useUiPreferences((state) => state.setLanguage);
  const copy = shellCopy(language);
  const [submenu, setSubmenu] = useState<"theme" | "language" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSubmenu(null);
      return;
    }
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (submenu !== null) {
        setSubmenu(null);
      } else {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, submenu]);

  if (!open) return null;

  const themeLabel =
    theme === "dark"
      ? copy.themeDark
      : theme === "light"
        ? copy.themeLight
        : copy.themeSystem;
  const languageLabel = language === "zh" ? copy.langChinese : copy.langEnglish;
  const themes: Array<{ value: ThemeChoice; label: string }> = [
    { value: "dark", label: copy.themeDark },
    { value: "light", label: copy.themeLight },
    { value: "system", label: copy.themeSystem },
  ];

  return (
    <div className={css.menu} role="menu" ref={menuRef}>
      <div className={css.header}>TNT</div>
      <div className={css.divider} />

      <button
        type="button"
        role="menuitem"
        className={css.item}
        onClick={() => {
          onOpenSettings();
          onClose();
        }}
      >
        <IconSettingsOutlineRegular size={15} className={css.icon} />
        <span>{copy.accountSettings}</span>
        <span className={css.shortcut}>Ctrl+,</span>
      </button>

      <div className={css.divider} />

      <div style={{ position: "relative" }}>
        <button
          type="button"
          role="menuitem"
          className={css.item}
          aria-expanded={submenu === "theme"}
          onClick={() =>
            setSubmenu((current) => (current === "theme" ? null : "theme"))
          }
        >
          <img src="/tnt-logo.svg" alt="" className={css.icon} />
          <span>{copy.accountTheme}</span>
          <span className={css.value}>{themeLabel}</span>
          <IconChevronDownOutlineRegular size={13} className={css.chevron} />
        </button>
        {submenu === "theme" ? (
          <div className={css.submenu}>
            {themes.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === option.value}
                className={css.subItem}
                data-active={theme === option.value}
                onClick={() => {
                  setTheme(option.value);
                  setSubmenu(null);
                }}
              >
                <span className={css.subDot} />
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          role="menuitem"
          className={css.item}
          aria-expanded={submenu === "language"}
          onClick={() =>
            setSubmenu((current) =>
              current === "language" ? null : "language",
            )
          }
        >
          <IconGlobeOutlineRegular size={15} className={css.icon} />
          <span>{copy.accountLanguage}</span>
          <span className={css.value}>{languageLabel}</span>
          <IconChevronDownOutlineRegular size={13} className={css.chevron} />
        </button>
        {submenu === "language" ? (
          <div className={css.submenu}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={language === "en"}
              className={css.subItem}
              data-active={language === "en"}
              onClick={() => {
                setLanguage("en");
                setSubmenu(null);
              }}
            >
              <span className={css.subDot} />
              {copy.langEnglish}
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={language === "zh"}
              className={css.subItem}
              data-active={language === "zh"}
              onClick={() => {
                setLanguage("zh");
                setSubmenu(null);
              }}
            >
              <span className={css.subDot} />
              {copy.langChinese}
            </button>
          </div>
        ) : null}
      </div>

      <div className={css.divider} />

      <button
        type="button"
        role="menuitem"
        className={css.item}
        onClick={() => {
          window.open(ABOUT_URL, "_blank", "noopener,noreferrer");
          onClose();
        }}
      >
        <IconInfoOutlineRegular size={15} className={css.icon} />
        <span>{copy.accountAbout}</span>
        <IconLinkOutlineRegular size={13} className={css.external} />
      </button>
    </div>
  );
}
