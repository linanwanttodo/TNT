import {
  IBotsService,
  IBroadcastService,
  IClientConfigService,
  IClientScenesService,
  ICloudContentService,
  ICodingPlanSubscriptionService,
  ICommandsService,
  IConversationShareService,
  ICredentialService,
  ICuaPermissionService,
  IDeviceSyncStateService,
  IFeedbackService,
  IFileService,
  IFileWatcherService,
  IGenUiService,
  IGitCheckpointService,
  IGitService,
  IHooksService,
  IHighspeedCardService,
  IMarketingTouchService,
  IMcpSyncService,
  IMediaPreviewService,
  IMemoryService,
  IModelSelectionService,
  IOAuthService,
  IOffPeakTaskService,
  IOnboardingRecordService,
  IOutputStyleService,
  IPluginManagementService,
  IPluginUiAppToolsService,
  IPluginUiBridgeService,
  IPluginUiSamplingService,
  IPluginsService,
  IPluginSyncService,
  IPromptAttachmentTransferService,
  IProjectService,
  IProviderProvisioningStatusService,
  IProviderSettingsService,
  IRemoteProjectService,
  ISettingService,
  ISettingsSyncService,
  ISkillSyncService,
  ISkillsService,
  ISourceServerManagementService,
  ISourceServerWorkspaceService,
  ISubagentsService,
  ISystemService,
  ITaskGroupService,
  ITerminalService,
  IUsageStatsService,
  IUserConfigSyncService,
  IWindowControllerService,
  IZCodeAgentService,
  IZCodeSessionService,
  IZCodeTaskService,
  ServiceCollection,
  type IServiceAccessor,
  type ServiceDescriptor,
} from "@zcode/services";

import { logger } from "../utils/logger.js";

import {
  stubBroadcastService,
  stubService,
  stubSettingService,
} from "./services/stubs.js";

export interface ZcodeServiceCollectionDeps {
  /** The checkout the UI shell is showing; later tasks hand it to real services. */
  workspacePath: string;
}

type OptionalAccessorKey = {
  [K in keyof IServiceAccessor]-?: undefined extends IServiceAccessor[K]
    ? K
    : never;
}[keyof IServiceAccessor];

type RequiredAccessorKey = Exclude<keyof IServiceAccessor, OptionalAccessorKey>;

/**
 * Optional accessor members that are themselves a single service channel.
 * `windowProjectDirectory` is a container grouping three descriptors rather
 * than a channel of its own, so it is not registered here.
 */
type OptionalServiceAccessorKey = Exclude<
  OptionalAccessorKey,
  "windowProjectDirectory"
>;

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

/**
 * Every optional accessor member backed by a descriptor `@zcode/services`
 * exports as a value. These channels exist so a mounted hook calling one gets
 * an immediate `ZCODE_UNAVAILABLE` rejection instead of waiting out the
 * ChannelServer's 1000 ms unknown-channel timeout on first paint.
 *
 * The Record pins coverage the same way the required one does: a new optional
 * descriptor member fails `tsc` until it is registered here.
 */
const ZCODE_OPTIONAL_SERVICE_DESCRIPTORS_BY_KEY = {
  taskGroupService: ITaskGroupService,
  projectService: IProjectService,
  remoteProjectService: IRemoteProjectService,
  mediaPreviewService: IMediaPreviewService,
  cloudContentService: ICloudContentService,
  marketingTouchService: IMarketingTouchService,
  onboardingRecordService: IOnboardingRecordService,
  windowControllerService: IWindowControllerService,
  cuaPermissionService: ICuaPermissionService,
  sourceServerManagementService: ISourceServerManagementService,
  deviceSyncStateService: IDeviceSyncStateService,
  providerProvisioningStatusService: IProviderProvisioningStatusService,
  genUiService: IGenUiService,
  pluginUiBridgeService: IPluginUiBridgeService,
  pluginUiSamplingService: IPluginUiSamplingService,
  pluginUiAppToolsService: IPluginUiAppToolsService,
} satisfies Record<OptionalServiceAccessorKey, ServiceDescriptor<unknown>>;

export const ZCODE_OPTIONAL_SERVICE_DESCRIPTORS: readonly ServiceDescriptor<unknown>[] =
  Object.values(ZCODE_OPTIONAL_SERVICE_DESCRIPTORS_BY_KEY);

export function buildZcodeServiceCollection(
  deps: ZcodeServiceCollectionDeps,
): ServiceCollection {
  logger.debug(
    `webui-zcode: building stub service scope for ${deps.workspacePath}`,
  );

  const collection = new ServiceCollection();
  for (const descriptor of [
    ...ZCODE_REQUIRED_SERVICE_DESCRIPTORS,
    ...ZCODE_OPTIONAL_SERVICE_DESCRIPTORS,
  ]) {
    // Two required services have first-paint callers that attach no
    // rejection handler, so they answer their read paths instead of
    // rejecting like the rest of the stubs.
    const instance =
      descriptor === ISettingService
        ? stubSettingService()
        : descriptor === IBroadcastService
          ? stubBroadcastService()
          : stubService<unknown>(descriptor.channelName);
    collection.register(descriptor, instance);
  }
  return collection;
}
