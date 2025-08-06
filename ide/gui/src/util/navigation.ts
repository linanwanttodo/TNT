// Valid config tab names
export type ConfigTab =
  | "models"
  | "rules"
  | "tools"
  | "configs"
  | "indexing"
  | "usage"
  | "rtk"
  | "mcp"
  | "skills"
  | "settings"
  | "help";

// TODO: Move all the routes here
export const ROUTES = {
  HOME: "/",
  HOME_INDEX: "/index.html",
  CONFIG: "/config",
  THEME: "/theme",
  // EXAMPLE_ROUTE_WITH_PARAMS: (params: ParamsType) => `/route/${params}`,
};

// Helper function to build config URLs with tabs
export const buildConfigRoute = (tab?: ConfigTab): string => {
  return tab ? `${ROUTES.CONFIG}?tab=${tab}` : ROUTES.CONFIG;
};

// Typed config route builders for common tabs
export const CONFIG_ROUTES = {
  MODELS: buildConfigRoute("models"),
  RULES: buildConfigRoute("rules"),
  TOOLS: buildConfigRoute("tools"),
  CONFIGS: buildConfigRoute("configs"),
  INDEXING: buildConfigRoute("indexing"),
  USAGE: buildConfigRoute("usage"),
  RTK: buildConfigRoute("rtk"),
  MCP: buildConfigRoute("mcp"),
  SKILLS: buildConfigRoute("skills"),
  SETTINGS: buildConfigRoute("settings"),
  HELP: buildConfigRoute("help"),
} as const;
