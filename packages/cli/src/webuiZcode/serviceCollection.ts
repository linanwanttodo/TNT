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
  getLocalZcodeServices,
  type LocalZcodeServices,
} from "./services/local.js";
import { stubService } from "./services/stubs.js";

export interface ZcodeServiceCollectionDeps {
  /** The checkout the UI shell is showing. */
  workspacePath: string;
  /** Test/host seam; defaults to the process-wide bundle. */
  localServices?: LocalZcodeServices;
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

/**
 * The channels answered by the process-wide local bundle. Every other
 * descriptor still resolves to a `ZCODE_UNAVAILABLE` stub. Tasks 10-11 move
 * the remaining agent, session and plugin channels here.
 */
const ZCODE_LOCAL_SERVICE_ACCESSORS = new Map<
  ServiceDescriptor<unknown>,
  (local: LocalZcodeServices) => unknown
>([
  [IFileService, (local) => local.fileService],
  [IGitService, (local) => local.gitService],
  [ISettingService, (local) => local.settingService],
  [ISystemService, (local) => local.systemService],
  [ITerminalService, (local) => local.terminalService],
  [IFileWatcherService, (local) => local.fileWatcherService],
  [IBroadcastService, (local) => local.broadcastService],
]);

export const ZCODE_LOCAL_SERVICE_DESCRIPTORS: readonly ServiceDescriptor<unknown>[] =
  [...ZCODE_LOCAL_SERVICE_ACCESSORS.keys()];

export function buildZcodeServiceCollection(
  deps: ZcodeServiceCollectionDeps,
): ServiceCollection {
  const local = deps.localServices ?? getLocalZcodeServices();
  logger.debug(
    `webui-zcode: building service scope for ${deps.workspacePath} (local instances shared process-wide)`,
  );

  const collection = new ServiceCollection();
  for (const descriptor of [
    ...ZCODE_REQUIRED_SERVICE_DESCRIPTORS,
    ...ZCODE_OPTIONAL_SERVICE_DESCRIPTORS,
  ]) {
    const resolveLocal = ZCODE_LOCAL_SERVICE_ACCESSORS.get(descriptor);
    const instance = resolveLocal
      ? resolveLocal(local)
      : stubService<unknown>(descriptor.channelName);
    collection.register(descriptor, instance);
  }
  return collection;
}
