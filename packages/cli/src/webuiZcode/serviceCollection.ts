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
  type IServiceAccessor,
  type ServiceDescriptor,
} from "@zcode/services";

import { logger } from "../utils/logger.js";

import { stubService } from "./services/stubs.js";

export interface ZcodeServiceCollectionDeps {
  /** The checkout the UI shell is showing; later tasks hand it to real services. */
  workspacePath: string;
}

type OptionalAccessorKey = {
  [K in keyof IServiceAccessor]: undefined extends IServiceAccessor[K]
    ? K
    : never;
}[keyof IServiceAccessor];

type RequiredAccessorKey = Exclude<keyof IServiceAccessor, OptionalAccessorKey>;

/**
 * Every service `IServiceAccessor` declares as required. Tasks 9-11 replace
 * these entries with real implementations; until then the host answers all of
 * them so the shell can paint and show its per-service unavailable state
 * instead of hanging on a channel that never registered.
 *
 * A Record rather than an array: `satisfies` pins the coverage, so adding a
 * required member to `IServiceAccessor` fails `tsc` until it is registered.
 */
const ZCODE_REQUIRED_SERVICE_DESCRIPTORS_BY_KEY = {
  fileService: IFileService,
  gitService: IGitService,
  gitCheckpointService: IGitCheckpointService,
  settingService: ISettingService,
  systemService: ISystemService,
  terminalService: ITerminalService,
  broadcastService: IBroadcastService,
  credentialService: ICredentialService,
  zcodeTaskService: IZCodeTaskService,
  zcodeAgentService: IZCodeAgentService,
  zcodeSessionService: IZCodeSessionService,
  conversationShareService: IConversationShareService,
  botsService: IBotsService,
  fileWatcherService: IFileWatcherService,
  oauthService: IOAuthService,
  providerSettingsService: IProviderSettingsService,
  modelSelectionService: IModelSelectionService,
  sourceServerWorkspaceService: ISourceServerWorkspaceService,
  usageStatsService: IUsageStatsService,
  codingPlanSubscriptionService: ICodingPlanSubscriptionService,
  clientConfigService: IClientConfigService,
  clientScenesService: IClientScenesService,
  offPeakTaskService: IOffPeakTaskService,
  highspeedCardService: IHighspeedCardService,
  skillsService: ISkillsService,
  skillSyncService: ISkillSyncService,
  mcpSyncService: IMcpSyncService,
  pluginSyncService: IPluginSyncService,
  settingsSyncService: ISettingsSyncService,
  userConfigSyncService: IUserConfigSyncService,
  pluginsService: IPluginsService,
  pluginManagementService: IPluginManagementService,
  subagentsService: ISubagentsService,
  commandsService: ICommandsService,
  hooksService: IHooksService,
  memoryService: IMemoryService,
  outputStyleService: IOutputStyleService,
  feedbackService: IFeedbackService,
  promptAttachmentTransferService: IPromptAttachmentTransferService,
} satisfies Record<RequiredAccessorKey, ServiceDescriptor<unknown>>;

export const ZCODE_REQUIRED_SERVICE_DESCRIPTORS: readonly ServiceDescriptor<unknown>[] =
  Object.values(ZCODE_REQUIRED_SERVICE_DESCRIPTORS_BY_KEY);

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
