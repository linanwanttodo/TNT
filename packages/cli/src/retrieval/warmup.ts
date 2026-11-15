import { ConfigHandler } from "core/config/ConfigHandler.js";
import type { IContextProvider } from "core/index.js";
import { LLMLogger } from "core/llm/logger.js";
import FileSystemIde from "core/util/filesystem.js";
import { localPathToUri } from "core/util/pathToUri.js";

import { canonicalPath } from "../utils/canonicalPath.js";
import { logger } from "../utils/logger.js";

/**
 * Whether the config this workspace loads selects the codebase provider.
 *
 * The indexer writes into the global directory for whatever workspace it is
 * pointed at, so a session that never configured codebase context gets nothing
 * written on its behalf: the walk is only paid for by a session that asked for
 * it.
 */
export async function selectsCodebaseProvider(
  workspaceDir: string,
): Promise<boolean> {
  const workspace = localPathToUri(canonicalPath(workspaceDir));
  const configHandler = new ConfigHandler(
    new FileSystemIde(workspace, "cli"),
    new LLMLogger(),
  );
  const { config } = await configHandler.loadConfig();
  return (config?.contextProviders ?? []).some(
    (provider: IContextProvider) => provider.description.title === "codebase",
  );
}

/**
 * Starts the codebase index when the session opens, instead of inside the first
 * turn that asks a question about the code.
 *
 * `startIndexing` is the same background build `/index` runs: it returns before
 * the walk lands, a search that arrives during it joins the run, and a second
 * call joins rather than doubling. `TNT_WARM_RETRIEVAL=0` turns it off; the
 * config check above is what keeps a repository someone opened to ask one
 * question from growing an index.
 *
 * Returns whether a build was started, so the caller (and a test) can tell a
 * skipped warm-up from a running one.
 */
export async function warmRetrieval(
  workspaceDir: string = process.cwd(),
): Promise<boolean> {
  if (process.env.TNT_WARM_RETRIEVAL === "0") {
    return false;
  }
  try {
    if (!(await selectsCodebaseProvider(workspaceDir))) {
      return false;
    }
  } catch (error) {
    logger.debug(
      "Retrieval warm-up skipped: no config to read",
      error as Error,
    );
    return false;
  }

  const { getRetrievalService } = await import("./service.js");
  getRetrievalService(workspaceDir).startIndexing();
  return true;
}
