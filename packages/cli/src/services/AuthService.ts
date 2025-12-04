import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";

import { BaseService } from "./BaseService.js";
import { AuthServiceState } from "./types.js";

/**
 * Service for managing authentication state.
 * Hub/WorkOS auth has been removed - this is a minimal stub that always
 * reports unauthenticated.
 */
export class AuthService extends BaseService<AuthServiceState> {
  constructor() {
    super("AuthService", {
      authConfig: null,
      isAuthenticated: false,
    });
  }

  async doInitialize(): Promise<AuthServiceState> {
    const state: AuthServiceState = {
      authConfig: null,
      isAuthenticated: false,
    };

    logger.debug("AuthService initialized (no auth)");
    return state;
  }

  async login(): Promise<AuthServiceState> {
    throw new Error(t("auth.loginUnavailable"));
  }

  async logout(): Promise<AuthServiceState> {
    logger.debug("Logout (no-op)");
    return this.getState();
  }

  async ensureOrganization(
    _isHeadless: boolean = false,
    _cliOrganizationSlug?: string,
  ): Promise<AuthServiceState> {
    return this.getState();
  }

  async switchOrganization(
    _organizationId: string | null,
  ): Promise<AuthServiceState> {
    return this.getState();
  }

  async getAvailableOrganizations(): Promise<null> {
    return null;
  }

  async hasMultipleOrganizations(): Promise<boolean> {
    return false;
  }

  async refresh(): Promise<AuthServiceState> {
    return this.reload();
  }
}
