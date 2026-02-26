import { getApiClient } from "../config/index.js";
import { logger } from "../utils/logger.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { ApiClientServiceState } from "./types.js";

/**
 * Service for managing API client state
 * Provides access to the Continue SDK API client
 */
export class ApiClientService
  extends BaseService<ApiClientServiceState>
  implements ServiceWithDependencies
{
  constructor() {
    super("ApiClientService", {
      apiClient: null,
    });
  }

  /**
   * Declare dependencies on other services
   */
  getDependencies(): string[] {
    return [];
  }

  /**
   * Initialize the API client service
   */
  async doInitialize(): Promise<ApiClientServiceState> {
    const apiClient = getApiClient(undefined);

    return {
      apiClient,
    };
  }

  /**
   * Rebuild the API client
   */
  async update(): Promise<ApiClientServiceState> {
    logger.debug("Updating ApiClientService");

    try {
      const apiClient = getApiClient(undefined);

      this.setState({
        apiClient,
      });

      logger.debug("ApiClientService updated successfully");
      return this.getState();
    } catch (error: any) {
      logger.error("Failed to update ApiClientService:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Override isReady to check for API client
   */
  override isReady(): boolean {
    return super.isReady() && this.currentState.apiClient !== null;
  }
}
