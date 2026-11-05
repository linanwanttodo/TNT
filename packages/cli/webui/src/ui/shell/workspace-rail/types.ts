export type TabId = "files" | "git" | "tasks" | "terminal";

export interface Tab {
  id: TabId;
  label: string;
  glyph: "folder" | "branch" | "robot" | "terminal";
}
