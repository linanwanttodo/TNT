import { useUiPreferences } from "../../../stores/ui-preferences.js";
import { shellCopy } from "../ui-copy.js";
import type { Tab } from "./types.js";

export function useTabs(): Tab[] {
  const language = useUiPreferences((state) => state.language);
  const copy = shellCopy(language);
  return [
    { id: "files", label: copy.files, glyph: "folder" },
    { id: "git", label: copy.git, glyph: "branch" },
    { id: "tasks", label: copy.tasks, glyph: "robot" },
    { id: "terminal", label: copy.terminal, glyph: "terminal" },
  ];
}
