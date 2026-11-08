import {
  IBotsService,
  IBroadcastService,
  IClientConfigService,
  IClientScenesService,
  ICodingPlanSubscriptionService,
  ICommandsService,
  IConversationShareService,
  ICredentialService,
  IFeedbackService,
  IFileService,
  IFileWatcherService,
  IGitCheckpointService,
  IGitService,
  IHooksService,
  IHighspeedCardService,
  IMcpSyncService,
  IMemoryService,
  IModelSelectionService,
  IOAuthService,
  IOffPeakTaskService,
  IOutputStyleService,
  IPluginManagementService,
  IPluginsService,
  IPluginSyncService,
  IPromptAttachmentTransferService,
  IProviderSettingsService,
  ISettingService,
  ISettingsSyncService,
  ISkillSyncService,
  ISkillsService,
  ISourceServerWorkspaceService,
  ISubagentsService,
  ISystemService,
  ITerminalService,
  IUsageStatsService,
  IUserConfigSyncService,
  IZCodeAgentService,
  IZCodeSessionService,
  IZCodeTaskService,
  ServiceCollection,
  type ServiceDescriptor,
} from "@zcode/services";

import { logger } from "../utils/logger.js";

import { stubService } from "./services/stubs.js";

export interface ZcodeServiceCollectionDeps {
  /** The checkout the UI shell is showing; later tasks hand it to real services. */
  workspacePath: string;
}

/**
 * Every service `IServiceAccessor` declares as required. Tasks 9-11 replace
 * these entries with real implementations; until then the host answers all of
 * them so the shell can paint and show its per-service unavailable state
 * instead of hanging on a channel that never registered.
 */
export const ZCODE_REQUIRED_SERVICE_DESCRIPTORS: readonly ServiceDescriptor<unknown>[] =
  [
    IFileService,
    IGitService,
    IGitCheckpointService,
    ISettingService,
    ISystemService,
    ITerminalService,
    IBroadcastService,
    ICredentialService,
    IZCodeTaskService,
    IZCodeAgentService,
    IZCodeSessionService,
    IConversationShareService,
    IBotsService,
    IFileWatcherService,
    IOAuthService,
    IProviderSettingsService,
    IModelSelectionService,
    ISourceServerWorkspaceService,
    IUsageStatsService,
    ICodingPlanSubscriptionService,
    IClientConfigService,
    IClientScenesService,
    IOffPeakTaskService,
    IHighspeedCardService,
    ISkillsService,
    ISkillSyncService,
    IMcpSyncService,
    IPluginSyncService,
    ISettingsSyncService,
    IUserConfigSyncService,
    IPluginsService,
    IPluginManagementService,
    ISubagentsService,
    ICommandsService,
    IHooksService,
    IMemoryService,
    IOutputStyleService,
    IFeedbackService,
    IPromptAttachmentTransferService,
  ];

export function buildZcodeServiceCollection(
  deps: ZcodeServiceCollectionDeps,
): ServiceCollection {
  logger.debug(
    `webui-zcode: building stub service scope for ${deps.workspacePath}`,
  );

  const collection = new ServiceCollection();
  for (const descriptor of ZCODE_REQUIRED_SERVICE_DESCRIPTORS) {
    collection.register(
      descriptor,
      stubService<unknown>(descriptor.channelName),
    );
  }
  return collection;
}
