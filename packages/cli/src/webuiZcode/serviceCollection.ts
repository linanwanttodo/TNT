import {
  IBotsService,
  IBroadcastService,
  IClientConfigService,
  IClientScenesService,
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

import type {
  ConnectionZcodeServices,
  LocalZcodeServices,
} from "./services/local.js";
import type { TntModelSource } from "./services/modelSelection.js";
import type { LocalProjectCatalog } from "./services/projects.js";
import { stubService } from "./services/stubs.js";
import type { WorkspaceRoots } from "./services/workspaceScope.js";
import type { WorkspaceEngines } from "./workspaceEngines.js";

export interface ZcodeServiceCollectionDeps {
  /** The checkout the UI shell is showing. */
  workspacePath: string;
  /**
   * Allowed roots for file and terminal paths. A workspace added at runtime
   * grows this set without rebuilding the collection.
   */
  workspaceRoots?: WorkspaceRoots;
  /** Test/host seam; defaults to the process-wide bundle. */
  localServices?: LocalZcodeServices;
  /** Test seam; defaults to a freshly created per-connection scope. */
  connectionServices?: ConnectionZcodeServices;
  /** The process-wide workspace engine registry, when the host provides one. */
  workspaceEngines?: WorkspaceEngines;
  /**
   * Reads the models the shell may pick. Injected by WebUiService from the
   * services group, which keeps the service registry out of this module's
   * import graph (services already imports the web UI host).
   */
  modelSelectionSource?: () => Promise<TntModelSource>;
  /** The process-wide local project catalog. Injected by WebUiService from the
   * services group for the same reason as modelSelectionSource: this module
   * must not import the service registry back into the ZCode host. */
  projectCatalog?: LocalProjectCatalog;
  /** Provider settings and credentials backed by TNT's own config, injected
   * from the services group for the same reason as modelSelectionSource. */
  providerSettingsService?: IProviderSettingsService;
  credentialService?: ICredentialService;
  /** Agent-surface adapters backed by TNT's own files, injected by the host. */
  subagentsService?: ISubagentsService;
  skillsService?: ISkillsService;
  commandsService?: ICommandsService;
  hooksService?: IHooksService;
  memoryService?: IMemoryService;
  usageStatsService?: IUsageStatsService;
}

/**
 * A per-connection collection owns the pty/watcher scope behind it, so the
 * transport calls `dispose` when the socket ends.
 */
export interface ZcodeConnectionCollection extends ServiceCollection {
  dispose(): void;
  /** The host's workspace engine registry, when one was supplied. */
  workspaceEngines?: WorkspaceEngines;
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
 * The channels answered by the local bundle plus the connection's own OS
 * resources. Every other descriptor still resolves to a `ZCODE_UNAVAILABLE`
 * stub. Task 11 moves the remaining agent and session channels here.
 */
interface ResolvedZcodeServices {
  local: LocalZcodeServices;
  connection: ConnectionZcodeServices;
  fileService: IFileService;
  modelSelectionService: IModelSelectionService;
  remoteProjectService: IRemoteProjectService;
  projectService: IProjectService;
  taskGroupService: ITaskGroupService;
  providerSettingsService?: IProviderSettingsService;
  credentialService?: ICredentialService;
  subagentsService?: ISubagentsService;
  skillsService?: ISkillsService;
  commandsService?: ICommandsService;
  hooksService?: IHooksService;
  memoryService?: IMemoryService;
  usageStatsService?: IUsageStatsService;
  agentService?: IZCodeAgentService;
  sessionService?: IZCodeSessionService;
}

const ZCODE_LOCAL_SERVICE_ACCESSORS = new Map<
  ServiceDescriptor<unknown>,
  (services: ResolvedZcodeServices) => unknown
>([
  [IFileService, (services) => services.fileService],
  [IGitService, (services) => services.local.gitService],
  [ISettingService, (services) => services.local.settingService],
  [ISystemService, (services) => services.local.systemService],
  [ITerminalService, (services) => services.connection.terminalService],
  [IFileWatcherService, (services) => services.connection.fileWatcherService],
  [IBroadcastService, (services) => services.local.broadcastService],
  [IModelSelectionService, (services) => services.modelSelectionService],
  [IRemoteProjectService, (services) => services.remoteProjectService],
  [IProjectService, (services) => services.projectService],
  [ITaskGroupService, (services) => services.taskGroupService],
  [IProviderSettingsService, (services) => services.providerSettingsService],
  [ICredentialService, (services) => services.credentialService],
  [ISubagentsService, (services) => services.subagentsService],
  [ISkillsService, (services) => services.skillsService],
  [ICommandsService, (services) => services.commandsService],
  [IHooksService, (services) => services.hooksService],
  [IMemoryService, (services) => services.memoryService],
  [IUsageStatsService, (services) => services.usageStatsService],
  [ISettingsSyncService, (services) => services.local.settingsSyncService],
  [IPluginsService, (services) => services.local.pluginsService],
  [
    IPluginManagementService,
    (services) => services.local.pluginManagementService,
  ],
]);

export const ZCODE_LOCAL_SERVICE_DESCRIPTORS: readonly ServiceDescriptor<unknown>[] =
  [...ZCODE_LOCAL_SERVICE_ACCESSORS.keys()];

function rootList(source: WorkspaceRoots): readonly string[] {
  if (typeof source === "function") {
    return source();
  }
  return typeof source === "string" ? [source] : source;
}

/**
 * Builds one connection's channel collection. The local bundle and its node
 * dependency graph are imported here rather than at module load, so a TUI that
 * never opens the web shell does not parse them.
 */
export async function buildZcodeServiceCollection(
  deps: ZcodeServiceCollectionDeps,
): Promise<ZcodeConnectionCollection> {
  const [
    { createConnectionZcodeServices, getLocalZcodeServices },
    { createWorkspaceScopedFileService },
    { createTntModelSelectionService },
    { createTntRemoteProjectService },
    { createTntProjectService },
    { createTntTaskGroupService },
  ] = await Promise.all([
    import("./services/local.js"),
    import("./services/workspaceScope.js"),
    import("./services/modelSelection.js"),
    import("./services/remoteProjects.js"),
    import("./services/projects.js"),
    import("./services/taskGroups.js"),
  ]);

  const local = deps.localServices ?? getLocalZcodeServices();
  // The connection's own workspace stays the primary root (relative paths and
  // a missing terminal cwd resolve against it); the rest are only additions.
  const providedRoots = deps.workspaceRoots;
  const workspaceRoots: WorkspaceRoots = providedRoots
    ? () => [deps.workspacePath, ...rootList(providedRoots)]
    : deps.workspacePath;
  const connection =
    deps.connectionServices ??
    createConnectionZcodeServices({
      workspacePath: deps.workspacePath,
      workspaceRoots,
      settingService: local.settingService,
    });
  const fileService = createWorkspaceScopedFileService(
    local.fileService,
    workspaceRoots,
  );
  const services: ResolvedZcodeServices = {
    local,
    connection,
    fileService,
    modelSelectionService: createTntModelSelectionService(
      deps.modelSelectionSource ?? (async () => ({ models: [] })),
    ),
    remoteProjectService: createTntRemoteProjectService(),
    projectService: createTntProjectService({
      workspacePath: deps.workspacePath,
      // The project picker browses the whole machine: it is how a folder
      // outside the current workspace joins the project list in the first
      // place. The workspace-scoped service would refuse every candidate that
      // is not an ancestor of the current workspace, so the picker could only
      // ever offer directories that already hold the session.
      fileService: local.fileService,
      ...(deps.projectCatalog ? { catalog: deps.projectCatalog } : {}),
      ...(deps.workspaceEngines
        ? { workspaceEngines: deps.workspaceEngines }
        : {}),
    }),
    taskGroupService: createTntTaskGroupService(),
    ...(deps.providerSettingsService
      ? { providerSettingsService: deps.providerSettingsService }
      : {}),
    ...(deps.credentialService
      ? { credentialService: deps.credentialService }
      : {}),
    ...(deps.subagentsService
      ? { subagentsService: deps.subagentsService }
      : {}),
    ...(deps.skillsService ? { skillsService: deps.skillsService } : {}),
    ...(deps.commandsService ? { commandsService: deps.commandsService } : {}),
    ...(deps.hooksService ? { hooksService: deps.hooksService } : {}),
    ...(deps.memoryService ? { memoryService: deps.memoryService } : {}),
    ...(deps.usageStatsService
      ? { usageStatsService: deps.usageStatsService }
      : {}),
  };

  let disposeAgent: (() => void) | null = null;
  if (deps.workspaceEngines) {
    const [{ createZcodeAgentService }, { createZcodeSessionService }] =
      await Promise.all([
        import("./services/agent.js"),
        import("./services/session.js"),
      ]);
    const agent = createZcodeAgentService(deps.workspaceEngines);
    services.agentService = agent.service;
    services.sessionService = createZcodeSessionService(agent.service);
    disposeAgent = () => agent.dispose();
  }

  logger.debug(
    `webui-zcode: building service scope for ${deps.workspacePath} (per-connection terminal and watcher)`,
  );

  const collection = new ServiceCollection() as ZcodeConnectionCollection;
  if (deps.workspaceEngines) {
    collection.workspaceEngines = deps.workspaceEngines;
  }
  for (const descriptor of [
    ...ZCODE_REQUIRED_SERVICE_DESCRIPTORS,
    ...ZCODE_OPTIONAL_SERVICE_DESCRIPTORS,
  ]) {
    const resolveLocal = ZCODE_LOCAL_SERVICE_ACCESSORS.get(descriptor);
    const engineService =
      descriptor === IZCodeAgentService
        ? services.agentService
        : descriptor === IZCodeSessionService
          ? services.sessionService
          : undefined;
    const instance =
      engineService ??
      (resolveLocal ? resolveLocal(services) : undefined) ??
      stubService<unknown>(descriptor.channelName);
    collection.register(descriptor, instance);
  }

  let disposed = false;
  collection.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeAgent?.();
    connection.dispose();
  };
  return collection;
}
