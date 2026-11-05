import {
  useUiPreferences,
  type UiLanguage,
} from "../../stores/ui-preferences.js";
import css from "./ChatViewTabs.module.css";

export type ChatViewId = "chat" | "trajectory" | "context" | "squad";

const LABELS: Record<ChatViewId, Record<UiLanguage, string>> = {
  chat: { en: "Chat", zh: "对话" },
  trajectory: { en: "Trajectory", zh: "轨迹" },
  context: { en: "Context", zh: "上下文" },
  squad: { en: "Agents", zh: "代理" },
};

export function ChatViewTabs({
  active,
  onChange,
}: {
  active: ChatViewId;
  onChange: (view: ChatViewId) => void;
}) {
  const language = useUiPreferences((state) => state.language);
  const tabs: ChatViewId[] = ["chat", "trajectory", "context", "squad"];
  return (
    <nav className={css.tabs} aria-label="View">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={css.tab}
          data-active={active === tab}
          onClick={() => onChange(tab)}
        >
          {LABELS[tab][language]}
        </button>
      ))}
    </nav>
  );
}
