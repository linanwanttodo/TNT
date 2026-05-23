import type { UiLanguage } from "../../stores/ui-preferences.js";

export interface ShellCopy {
  newChat: string;
  settings: string;
  projects: string;
  recents: string;
  searchSessions: string;
  noChats: string;
  noMatchingProjects: string;
  noMatchingChats: string;
  showMore: string;
  rename: string;
  delete: string;
  files: string;
  git: string;
  tasks: string;
  terminal: string;
  running: string;
  idle: string;
  loadingFiles: string;
  loadingGit: string;
  notGitRepository: string;
  clean: string;
  clear: string;
  noApprovals: string;
  approvals: string;
  approve: string;
  deny: string;
  runCommand: string;
  backToChat: string;
  tntSettings: string;
  sectionLabels: Record<string, string>;
  sectionDescriptions: Record<string, string>;
  accountSettings: string;
  accountTheme: string;
  accountLanguage: string;
  accountAbout: string;
  themeDark: string;
  themeLight: string;
  themeSystem: string;
  langEnglish: string;
  langChinese: string;
}

const EN: ShellCopy = {
  newChat: "New chat",
  settings: "Settings",
  projects: "Projects",
  recents: "Recents",
  searchSessions: "Search sessions",
  noChats: "No chats",
  noMatchingProjects: "No matching projects",
  noMatchingChats: "No matching chats",
  showMore: "Show more",
  rename: "Rename",
  delete: "Delete",
  files: "Files",
  git: "Git",
  tasks: "Tasks",
  terminal: "Terminal",
  running: "Running",
  idle: "Idle",
  loadingFiles: "Loading files...",
  loadingGit: "Loading git status...",
  notGitRepository: "Not a git repository",
  clean: "Clean",
  clear: "Clear",
  noApprovals: "No approvals waiting",
  approvals: "Approvals",
  approve: "Approve",
  deny: "Deny",
  runCommand: "Run a command",
  backToChat: "Back to chat",
  tntSettings: "TNT settings",
  sectionLabels: {
    general: "General",
    models: "Models",
    appearance: "Appearance",
    plugins: "Plugins",
    skills: "Skills",
    commands: "Commands",
    agents: "Agents",
    mcp: "MCP",
  },
  sectionDescriptions: {
    general: "Workspace, session facts and where settings live.",
    models: "The chat models this session can run on.",
    appearance: "Theme and interface preferences for this browser.",
    plugins:
      "Installed plugins and the contributions currently loaded from each.",
    skills: "Skill packages the agent can load on demand.",
    commands: "Slash commands contributed by plugins.",
    agents: "Subagent roles contributed by plugins.",
    mcp: "MCP servers configured for this process.",
  },
  accountSettings: "Settings",
  accountTheme: "Theme",
  accountLanguage: "Language",
  accountAbout: "About",
  themeDark: "Dark",
  themeLight: "Light",
  themeSystem: "System",
  langEnglish: "English",
  langChinese: "中文",
};

const ZH: ShellCopy = {
  newChat: "新建会话",
  settings: "设置",
  projects: "项目",
  recents: "最近",
  searchSessions: "搜索会话",
  noChats: "暂无会话",
  noMatchingProjects: "没有匹配的项目",
  noMatchingChats: "没有匹配的会话",
  showMore: "显示更多",
  rename: "重命名",
  delete: "删除",
  files: "文件",
  git: "Git",
  tasks: "任务",
  terminal: "终端",
  running: "运行中",
  idle: "空闲",
  loadingFiles: "正在加载文件...",
  loadingGit: "正在加载 Git 状态...",
  notGitRepository: "不是 Git 仓库",
  clean: "无变更",
  clear: "清屏",
  noApprovals: "暂无待审批任务",
  approvals: "待审批",
  approve: "同意",
  deny: "拒绝",
  runCommand: "运行命令",
  backToChat: "返回对话",
  tntSettings: "TNT 设置",
  sectionLabels: {
    general: "通用",
    models: "模型",
    appearance: "外观",
    plugins: "插件",
    skills: "技能",
    commands: "命令",
    agents: "代理",
    mcp: "MCP",
  },
  sectionDescriptions: {
    general: "工作区、会话信息和设置文件位置。",
    models: "当前会话可使用的聊天模型。",
    appearance: "浏览器中的主题和界面偏好。",
    plugins: "已安装的插件，以及当前加载的贡献项。",
    skills: "Agent 可以按需加载的技能包。",
    commands: "插件提供的斜杠命令。",
    agents: "插件提供的子代理角色。",
    mcp: "当前进程配置的 MCP 服务。",
  },
  accountSettings: "设置",
  accountTheme: "主题",
  accountLanguage: "语言",
  accountAbout: "关于",
  themeDark: "深色",
  themeLight: "浅色",
  themeSystem: "跟随系统",
  langEnglish: "English",
  langChinese: "中文",
};

export function shellCopy(language: UiLanguage): ShellCopy {
  return language === "zh" ? ZH : EN;
}

export function sectionText(
  copy: ShellCopy,
  id: string,
): { label: string; description: string } {
  return {
    label: copy.sectionLabels[id] ?? id,
    description: copy.sectionDescriptions[id] ?? "",
  };
}
