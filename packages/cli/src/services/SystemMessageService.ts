import { isPromptProfile } from "../agent/promptProfiles.js";
import {
  buildSystemMessageSections,
  describeSystemMessageChange,
  joinSystemMessageSections,
  SystemMessageSection,
} from "../agent/systemMessage.js";
import type { OutputFormat } from "../config/outputFormat.js";
import { PermissionMode } from "../permissions/types.js";
import { getSessionPromptProfile } from "../session/index.js";
import { logger } from "../utils/logger.js";

import { BaseService } from "./BaseService.js";
import { SERVICE_NAMES } from "./types.js";

export interface SystemMessageServiceState {
  additionalRules?: string[];
  format?: OutputFormat;
  headless?: boolean;
}

/**
 * Service for managing dynamic system message construction
 * Provides fresh system messages that reflect current mode and configuration
 */
export class SystemMessageService extends BaseService<SystemMessageServiceState> {
  private lastSections: readonly SystemMessageSection[] = [];
  private lastChange = "";

  constructor() {
    super("SystemMessageService", {});
  }

  /**
   * Initialize the service
   */
  async doInitialize(args: {
    additionalRules?: string[];
    format?: OutputFormat;
    headless?: boolean;
  }): Promise<SystemMessageServiceState> {
    this.setState({
      additionalRules: args.additionalRules,
      format: args.format,
      headless: args.headless,
    });

    logger.debug("SystemMessageService initialized", {
      hasAdditionalRules: !!args.additionalRules?.length,
      format: args.format,
      headless: args.headless,
    });

    return this.currentState;
  }

  /**
   * Get a fresh system message with current mode and configuration
   */
  public async getSystemMessage(currentMode: PermissionMode): Promise<string> {
    const { additionalRules, format, headless } = this.currentState;

    const storedProfile = getSessionPromptProfile();
    const sections = await buildSystemMessageSections(
      currentMode,
      additionalRules,
      format,
      headless,
      // A profile name that no longer exists falls back to the default rather
      // than breaking every request.
      storedProfile && isPromptProfile(storedProfile)
        ? storedProfile
        : undefined,
    );
    const systemMessage = joinSystemMessageSections(sections);

    // Recorded here rather than at the request site because this is the only
    // place both the previous and the new build exist.
    // The first build of a session is not a move: there is no cached prefix
    // before it to rebill.
    this.lastChange =
      this.lastSections.length === 0
        ? ""
        : describeSystemMessageChange(this.lastSections, sections);
    this.lastSections = sections;

    logger.debug("Generated fresh system message", {
      mode: currentMode,
      messageLength: systemMessage.length,
    });

    return systemMessage;
  }

  /**
   * The parts of the prefix that changed at the last build, or "" when nothing
   * did. A rewritten prefix re-bills every cached token after the point it
   * changed, and the only useful thing to tell a user is which part moved.
   */
  public describeLastSystemMessageChange(): string {
    return this.lastChange;
  }

  getDependencies(): string[] {
    return [SERVICE_NAMES.TOOL_PERMISSIONS];
  }

  /**
   * Update configuration that affects system message
   */
  public updateConfig(config: Partial<SystemMessageServiceState>): void {
    this.setState({
      ...this.currentState,
      ...config,
    });

    logger.debug("SystemMessageService config updated", config);
  }
}
