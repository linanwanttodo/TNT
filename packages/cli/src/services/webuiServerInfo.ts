import type { Session } from "core/index.js";
import type { Express, Request, Response } from "express";

import type { ServerState } from "../commands/serve.helpers.js";

export interface WebUiServerInfoContext {
  state: ServerState;
  resolveSession(): Session;
}

/**
 * The roots a browser may browse: the session's workspace directory and the
 * process cwd, de-duplicated, with trailing separators stripped.
 */
function resolveWorkspaceEntries(
  workspaceDirectory: string | undefined,
): Array<{ path: string; name: string }> {
  const paths = new Set(
    [workspaceDirectory, process.cwd()]
      .filter((root): root is string => Boolean(root))
      .map((root) => root.replace(/[/\\]+$/, "")),
  );
  return [...paths].map((path) => ({
    path,
    name: path.split("/").pop() ?? path,
  }));
}

/**
 * The vendored ZCode web entry fetches this before it connects to /ws to
 * learn which workspace to open first.
 */
export function registerWebUiServerInfoRoute(
  app: Express,
  ctx: WebUiServerInfoContext,
): void {
  app.get("/api/server-info", (_req: Request, res: Response) => {
    ctx.state.lastActivity = Date.now();
    const session = ctx.resolveSession();
    res.json({
      workspaces: resolveWorkspaceEntries(session.workspaceDirectory),
    });
  });
}
