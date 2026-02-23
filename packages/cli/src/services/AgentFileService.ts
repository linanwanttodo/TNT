import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  AgentFile,
  parseAgentFile,
  parseAgentFileRules,
  parseAgentFileTools,
} from "@tnt/config-yaml";

import { getErrorString } from "src/utils/error.js";

import { agentFileProcessor, loadPackageFromHub } from "../config/hubLoader.js";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { serviceContainer } from "./ServiceContainer.js";
import { AgentFileServiceState } from "./types.js";

export const EMPTY_AGENT_FILE_STATE: AgentFileServiceState = {
  agentFile: null,
  slug: null,
  parsedRules: null,
  parsedTools: null,
  agentFileModel: null,
};
/**
 * Service for managing the state of one agent file: the markdown file is read from
 * disk, and the model, rules and tools it names are recorded for the services that
 * resolve them against the assistant configuration.
 */
export class AgentFileService
  extends BaseService<AgentFileServiceState>
  implements ServiceWithDependencies
{
  constructor() {
    super("AgentFileService", {
      ...EMPTY_AGENT_FILE_STATE,
    });
  }

  getDependencies(): string[] {
    // The agent file is read from disk and its model is a name the assistant
    // configuration resolves, so nothing here waits on the API client.
    return [];
  }

  async getAgentFile(agentPath: string): Promise<AgentFile> {
    try {
      const isMarkdownPath =
        agentPath.endsWith(".md") || agentPath.endsWith(".markdown");

      const parts = agentPath.split("/");
      const looksLikeHubSlug =
        parts.length === 2 && parts[0] && parts[1] && !parts.includes(".");

      if (looksLikeHubSlug) {
        try {
          return await loadPackageFromHub(agentPath, agentFileProcessor);
        } catch (hubError) {
          // Hub loading failed - only fall back to file if it's a markdown path
          if (!isMarkdownPath) {
            // Not a markdown path, so re-throw the hub error
            throw hubError;
          }
          // It's a markdown path, fall through to try loading as file
        }
      }

      // Only load from file path for markdown files
      if (!isMarkdownPath) {
        throw new Error(t("services.agentNotMarkdown", { path: agentPath }));
      }

      const resolvedPath = agentPath.startsWith("file:/")
        ? fileURLToPath(agentPath)
        : path.resolve(agentPath);
      const content = fs.readFileSync(resolvedPath, "utf-8");
      return parseAgentFile(content);
    } catch (e) {
      throw new Error(
        t("services.agentLoadFailed", {
          path: agentPath,
          message: getErrorString(e),
        }),
      );
    }
  }

  /**
   * Initialize the agent file service with a hub slug
   */
  async doInitialize(
    agentFilePath: string | undefined,
  ): Promise<AgentFileServiceState> {
    if (!agentFilePath) {
      return {
        ...EMPTY_AGENT_FILE_STATE,
      };
    }

    try {
      const agentFile = await this.getAgentFile(agentFilePath);

      // Set the basic agent file state
      this.setState({
        agentFile,
        slug: agentFilePath,
      });

      if (agentFile.model) {
        // The agent file only names a model; the assistant configuration defines it,
        // and ModelService matches this name against the models it actually loaded.
        // Fetching a model package here was a hub call, and the hub is gone.
        this.setState({
          agentFileModel: { name: agentFile.model },
        });
      }

      if (agentFile.rules) {
        this.setState({
          parsedRules: parseAgentFileRules(agentFile.rules),
        });
      }

      if (agentFile.tools) {
        this.setState({
          parsedTools: parseAgentFileTools(agentFile.tools),
        });
      }

      return this.getState();
    } catch (error: any) {
      logger.error("Failed to initialize AgentFileService:", error);
      throw error;
    }
  }

  protected override setState(newState: Partial<AgentFileServiceState>): void {
    super.setState(newState);
    serviceContainer.set("update", this.currentState);
  }
}
