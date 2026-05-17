import {
  useUiPreferences,
  type ThemeChoice,
} from "../../../../stores/ui-preferences.js";
import { shellCopy } from "../../ui-copy.ts";
import { SettingsGroup } from "../shared.tsx";
import css from "../SettingsPage.module.css";

export function AppearanceSection() {
  const theme = useUiPreferences((state) => state.theme);
  const language = useUiPreferences((state) => state.language);
  const setTheme = useUiPreferences((state) => state.setTheme);
  const copy = shellCopy(language);
  const options: Array<{
    value: ThemeChoice;
    label: string;
    description: string;
  }> = [
    {
      value: "dark",
      label: copy.themeDark,
      description: "Always use the dark theme.",
    },
    {
      value: "light",
      label: copy.themeLight,
      description: "Always use the light theme.",
    },
    {
      value: "system",
      label: copy.themeSystem,
      description: "Follow the operating system preference.",
    },
  ];
  return (
    <SettingsGroup title="Theme">
      <div className={css.themeChoices}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={css.themeChoice}
            data-active={theme === option.value}
            onClick={() => setTheme(option.value)}
          >
            <span className={css.themeLabel}>{option.label}</span>
            <span className={css.themeDescription}>{option.description}</span>
          </button>
        ))}
      </div>
    </SettingsGroup>
  );
}
