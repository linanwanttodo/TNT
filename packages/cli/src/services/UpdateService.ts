import { exec, spawn } from "child_process";
import { promisify } from "util";

import { GlobalContext } from "core/util/GlobalContext.js";

import { logger } from "../utils/logger.js";

import {
  compareVersions,
  getLatestVersion,
  getVersion,
} from "../startup/version.js";

import { BaseService } from "./BaseService.js";
import { serviceContainer } from "./ServiceContainer.js";
import { UpdateServiceState, UpdateStatus } from "./types.js";
const execAsync = promisify(exec);

/**
 * A dev build must not ask npm whether it is out of date: the published version is always
 * "newer" than `0.0.0-dev`, and with auto-update on that comparison would try to replace
 * the checkout the build came from. `unknown` still checks, because there is nothing to
 * compare and the comparison comes out as "same".
 */
export function shouldCheckForUpdates(currentVersion: string): boolean {
  return !/-dev\b/.test(currentVersion);
}

export interface AutoUpdateDecision {
  autoUpdate: boolean;
  isUpdateAvailable: boolean;
  status: string;
  alreadyAutoUpdated: boolean;
}

/**
 * The first line of npm output that means the install failed. npm writes warnings and a
 * debugger banner to stderr on success, so those are not failures; everything else is.
 */
export function firstFatalStderrLine(stderr: string): string | null {
  for (const line of stderr.split("\n")) {
    const lower = line.toLowerCase().trim();
    if (!lower || lower.includes("debugger") || lower.includes("npm warn")) {
      continue;
    }
    return line;
  }
  return null;
}

/** Every gate that guards a self-replacing install, in one testable place. */
export function shouldAutoUpdate(decision: AutoUpdateDecision): boolean {
  return (
    decision.autoUpdate &&
    decision.isUpdateAvailable &&
    decision.status !== "updating" &&
    !decision.alreadyAutoUpdated
  );
}

/**
 * The parsed invocation a post-update restart has to reproduce.
 *
 * It is captured from commander's parse result in a `preAction` hook (see
 * `runCli` in `src/index.ts`), never from raw `process.argv`: by the time the
 * hook runs, commander has matched every token against the declared flags and
 * errored on anything unknown, so this spec can only hold parsed values for
 * options the CLI actually defines. Kept in module state rather than
 * `GlobalContext`, which persists to disk - this is process-lifetime data.
 */
export interface CliLaunchSpec {
  /** Subcommand name, or null when the root command ran. */
  command: string | null;
  /** Parsed option values keyed by commander attribute name. */
  options: Record<string, unknown>;
  /**
   * Attribute names of the options declared on the command that ran. A flag
   * is only re-emitted when the command declares it: anything else placed
   * after the subcommand name would be rejected as an unknown option by the
   * restarted CLI, which would turn an update into a broken launch.
   */
  declaredOptions: string[];
  /** Positional arguments (the prompt, or the checks operands). */
  operands: string[];
}

let capturedLaunchSpec: CliLaunchSpec | null = null;

export function captureCliLaunchSpec(spec: CliLaunchSpec): void {
  capturedLaunchSpec = spec;
}

export function getCapturedCliLaunchSpec(): CliLaunchSpec | null {
  return capturedLaunchSpec;
}

type RestartFlagKind = "flag" | "value" | "list";

interface RestartFlagSpec {
  /** The exact spelling the restarted CLI parses. */
  spelling: string;
  /**
   * flag: no value. value: one scalar. list: repeatable, one pair per element.
   */
  kind: RestartFlagKind;
  /** Negatable booleans (commander's `--no-x`) emit on false instead of true. */
  emitWhenFalse?: boolean;
}

/**
 * The one place that decides which parsed flags survive a restart.
 *
 * `process.argv.slice(2)` never reaches an argument position. Every flag is
 * rebuilt from this table against commander-parsed values, which is what
 * gives the child argv a fixed shape:
 *
 * - a flag name can only come from this table, so a value can never be
 *   re-interpreted as a flag (option injection). Flag values that start with
 *   "-" are refused; operands go behind a `--` separator, which commander
 *   treats as end-of-options;
 * - a flag is emitted only when the command that ran declares it, so the
 *   restarted parse accepts the rebuilt argv;
 * - anything outside the table, or a value that fails validation, is dropped
 *   with a debug log. That is deliberate: losing an unusual flag on restart
 *   is recoverable (the user re-runs the command), while an argv assembled
 *   from unvalidated tokens is not.
 */
const RESTART_FLAGS: Record<string, RestartFlagSpec> = {
  // Common options (src/config/sharedOptions.ts) - declared on the root
  // command, so they are only re-emitted for root restarts.
  config: { spelling: "--config", kind: "value" },
  org: { spelling: "--org", kind: "value" },
  readonly: { spelling: "--readonly", kind: "flag" },
  auto: { spelling: "--auto", kind: "flag" },
  permissionMode: { spelling: "--permission-mode", kind: "value" },
  dangerouslySkipPermissions: {
    spelling: "--dangerously-skip-permissions",
    kind: "flag",
  },
  mode: { spelling: "--mode", kind: "value" },
  trustProject: { spelling: "--trust-project", kind: "flag" },
  verbose: { spelling: "--verbose", kind: "flag" },
  betaStatusTool: { spelling: "--beta-status-tool", kind: "flag" },
  rule: { spelling: "--rule", kind: "list" },
  mcp: { spelling: "--mcp", kind: "list" },
  model: { spelling: "--model", kind: "list" },
  prompt: { spelling: "--prompt", kind: "list" },
  allow: { spelling: "--allow", kind: "list" },
  ask: { spelling: "--ask", kind: "list" },
  exclude: { spelling: "--exclude", kind: "list" },
  agent: { spelling: "--agent", kind: "value" },
  // Root-only options (src/index.ts).
  print: { spelling: "--print", kind: "flag" },
  format: { spelling: "--format", kind: "value" },
  silent: { spelling: "--silent", kind: "flag" },
  outputSchema: { spelling: "--output-schema", kind: "value" },
  requestTimeout: { spelling: "--request-timeout", kind: "value" },
  resume: { spelling: "--resume", kind: "flag" },
  fork: { spelling: "--fork", kind: "value" },
  maxSteps: { spelling: "--max-steps", kind: "value" },
  betaSubagentTool: { spelling: "--beta-subagent-tool", kind: "flag" },
  acp: { spelling: "--acp", kind: "flag" },
  // Internal ACP worker flags (hidden from help).
  acpWorker: { spelling: "--acp-worker", kind: "flag" },
  sessionId: { spelling: "--session-id", kind: "value" },
  sessionCwd: { spelling: "--session-cwd", kind: "value" },
  // Subcommand options.
  json: { spelling: "--json", kind: "flag" },
  timeout: { spelling: "--timeout", kind: "value" },
  port: { spelling: "--port", kind: "value" },
  host: { spelling: "--host", kind: "value" },
  id: { spelling: "--id", kind: "value" },
  betaUploadArtifactTool: {
    spelling: "--beta-upload-artifact-tool",
    kind: "flag",
  },
  resumeSession: { spelling: "--resume-session", kind: "flag" },
  // webui's `--no-open` is a negatable option: commander reports it as
  // attribute `open` with value false when the user wrote `--no-open`.
  open: { spelling: "--no-open", kind: "flag", emitWhenFalse: true },
  base: { spelling: "--base", kind: "value" },
  uncommitted: { spelling: "--uncommitted", kind: "flag" },
  commit: { spelling: "--commit", kind: "value" },
  range: { spelling: "--range", kind: "value" },
  fix: { spelling: "--fix", kind: "flag" },
  patch: { spelling: "--patch", kind: "flag" },
  failFast: { spelling: "--fail-fast", kind: "flag" },
  reviewAgents: { spelling: "--review-agents", kind: "list" },
  reviewModel: { spelling: "--review-model", kind: "value" },
};

/**
 * Values are data for the child process (the spawn is array-form without a
 * shell), so the one thing to keep out of a value position is text that the
 * restarted commander would parse as a flag or flag terminator: empty
 * strings and anything leading with "-". Negative numbers are rejected the
 * same way; none of the declared numeric flags take them.
 */
function isSafeFlagValue(value: string): boolean {
  return value.length > 0 && !value.startsWith("-");
}

function safeScalar(value: unknown): string | null {
  if (typeof value === "string") {
    return isSafeFlagValue(value) ? value : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = String(value);
    return isSafeFlagValue(text) ? text : null;
  }
  return null;
}

/**
 * Rebuild the restart argv in a fixed shape: entry point, optional
 * subcommand, whitelisted flag/value pairs, then operands behind `--`.
 * Returns null when there is no safe entry point (caller skips the restart).
 */
export function buildRestartArgs(
  entryPoint: string | undefined,
  spec: CliLaunchSpec | null,
): string[] | null {
  if (!entryPoint || !isSafeFlagValue(entryPoint)) {
    logger.debug("Skipping CLI restart: no script entry point in argv");
    return null;
  }

  const args: string[] = [entryPoint];

  // No captured spec means parse never reached a preAction hook (the worker
  // path exits before parsing). The restart then runs bare: restarting
  // without arguments is recoverable, an argv built from unvalidated tokens
  // is not.
  if (!spec) {
    return args;
  }

  if (spec.command === null) {
    // Root restart: nothing to re-emit.
  } else if (
    typeof spec.command === "string" &&
    isSafeFlagValue(spec.command)
  ) {
    args.push(spec.command);
  } else {
    logger.debug(
      `Dropping restart subcommand: ${JSON.stringify(spec.command)}`,
    );
  }

  for (const [attribute, flagSpec] of Object.entries(RESTART_FLAGS)) {
    // Only flags the executed command declares are re-emitted; see
    // CliLaunchSpec.declaredOptions for why anything else would break parse.
    if (!spec.declaredOptions.includes(attribute)) {
      continue;
    }
    const value = spec.options[attribute];
    if (value === undefined || value === null) {
      continue;
    }

    if (flagSpec.kind === "flag") {
      const emit = flagSpec.emitWhenFalse ? value === false : value === true;
      if (emit) {
        args.push(flagSpec.spelling);
      }
      continue;
    }

    const candidates = flagSpec.kind === "list" ? value : [value];
    if (!Array.isArray(candidates)) {
      logger.debug(
        `Dropping flag ${flagSpec.spelling}: unexpected shape ${typeof value}`,
      );
      continue;
    }
    for (const candidate of candidates) {
      const safe = safeScalar(candidate);
      if (safe === null) {
        logger.debug(
          `Dropping flag ${flagSpec.spelling} value: ${JSON.stringify(candidate)}`,
        );
        continue;
      }
      args.push(flagSpec.spelling, safe);
    }
  }

  const operands = Array.isArray(spec.operands)
    ? spec.operands.filter(
        (operand): operand is string =>
          typeof operand === "string" && operand.length > 0,
      )
    : [];
  if (operands.length > 0) {
    // End-of-options separator: an operand that starts with "-" stays a
    // positional argument for the restarted parse.
    args.push("--", ...operands);
  }

  return args;
}

const INSTALLER_BASE =
  "https://raw.githubusercontent.com/linanwanttodo/TNT/main/packages/cli/scripts";

/**
 * The installer that replaces the running copy on this platform. Windows has
 * neither bash nor the tarball symlink the Unix installer wires, so it runs
 * the PowerShell installer instead.
 */
export function installerCommand(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm ${INSTALLER_BASE}/install.ps1 | iex"`;
  }
  return `curl -fsSL ${INSTALLER_BASE}/install.sh | bash`;
}

/**
 * Service for checking and performing CLI updates
 */
export class UpdateService extends BaseService<UpdateServiceState> {
  constructor() {
    super("update", {
      autoUpdate: true,
      isAutoUpdate: true,
      status: UpdateStatus.IDLE,
      // The installed version is known without a network round trip; showing
      // it immediately keeps the status row from advertising a pending check
      // for however long DNS and TLS take.
      message: `TNT v${getVersion()}`,
      error: null,
      isUpdateAvailable: false,
      latestVersion: null,
      currentVersion: getVersion(),
    });
  }

  /**
   * Initialize the update service
   */
  async doInitialize(headless?: boolean) {
    // Don't automatically check in tests/headless
    if (!headless && process.env.NODE_ENV !== "test") {
      void this.checkAndAutoUpdate();
    }

    return this.currentState;
  }

  private async checkAndAutoUpdate() {
    // First get auto update setting from global context
    const globalContext = new GlobalContext();
    const autoUpdate = globalContext.get("autoUpdateCli") ?? true;
    this.setState({
      autoUpdate,
    });

    try {
      // Skip checking for updates in dev.
      if (!shouldCheckForUpdates(this.currentState.currentVersion)) {
        this.setState({
          status: UpdateStatus.IDLE,
          message: `TNT`,
        });
        return; // Uncomment to test auto-update behavior in dev
      }

      // Check for updates
      this.setState({
        status: UpdateStatus.CHECKING,
        message: `TNT v${this.currentState.currentVersion}`,
      });

      const latestVersion = await getLatestVersion();
      this.setState({
        latestVersion,
      });

      if (!latestVersion) {
        this.setState({
          status: UpdateStatus.IDLE,
          message: "TNT",
          isUpdateAvailable: false,
        });
        return;
      }

      const comparison = compareVersions(
        this.currentState.currentVersion,
        latestVersion,
      );
      const isUpdateAvailable = comparison === "older";
      this.setState({
        isUpdateAvailable,
      });

      // If update is available, automatically update
      if (
        shouldAutoUpdate({
          autoUpdate,
          isUpdateAvailable,
          status: this.currentState.status,
          // Already auto updated once, preventing sequential auto-update.
          alreadyAutoUpdated: Boolean(process.env.TNT_AUTO_UPDATED),
        })
      ) {
        await this.performUpdate(true);
      } else {
        this.setState({
          status: UpdateStatus.IDLE,
          message: isUpdateAvailable
            ? `Update available: v${latestVersion}`
            : `TNT v${this.currentState.currentVersion}`,
          isUpdateAvailable,
          latestVersion,
        });
      }
    } catch (error: any) {
      logger.error("Error checking for updates:", error);
      this.setState({
        status: UpdateStatus.ERROR,
        message: `TNT v${this.currentState.currentVersion}`,
        error,
      });
    }
  }

  public async setAutoUpdate(value: boolean) {
    const globalContext = new GlobalContext();
    globalContext.update("autoUpdateCli", value);
    this.setState({
      autoUpdate: value,
    });
  }

  // TODO this is a hack because our service state update code is broken
  // Currently all things that need update use serviceContainer.set manually
  // Rather than actually using the stateChanged event
  setState(newState: Partial<UpdateServiceState>): void {
    super.setState(newState);
    serviceContainer.set("update", this.currentState);
  }

  async performUpdate(isAutoUpdate?: boolean) {
    if (this.currentState.status === "updating") {
      return;
    }

    try {
      this.setState({
        isAutoUpdate,
        status: UpdateStatus.UPDATING,
        message: `${isAutoUpdate ? "Auto-updating" : "Updating"} to v${this.currentState.latestVersion}`,
      });

      // The CLI is distributed through GitHub Releases; the installer
      // downloads and replaces the local copy, then restartCLI relaunched the
      // process. No npm involved.
      // The installer command is a compile-time constant (see installerCommand):
      // the URL is the constant INSTALLER_BASE and no user, config or model
      // data reaches the string. The shell is required by the pipeline itself
      // (`curl | bash` / `irm | iex`), not used to interpolate any input.
      const installer = await execAsync(installerCommand(), {
        timeout: 300000,
      });
      logger.debug("Update output:", {
        stdout: installer.stdout,
        stderr: installer.stderr,
      });
      const fatal = firstFatalStderrLine(installer.stderr);
      if (fatal) {
        this.setState({
          status: UpdateStatus.ERROR,
          message: `Error updating to v${this.currentState.latestVersion}`,
          error: new Error(installer.stderr),
        });
        return;
      }

      this.setState({
        status: UpdateStatus.UPDATED,
        message: `Updated to v${this.currentState.latestVersion}`,
        isUpdateAvailable: false,
      });
      this.restartCLI();
    } catch (error: any) {
      logger.error("Error updating CLI:", error);
      this.setState({
        status: UpdateStatus.ERROR,
        message: "Update failed",
        error,
      });
      setTimeout(() => {
        this.setState({
          status: UpdateStatus.IDLE,
          message: `/update to v${this.currentState.latestVersion}`,
        });
      }, 4000);
    }
  }

  private restartCLI(): void {
    try {
      // The restart re-executes this CLI with the invocation the user started
      // it with, rebuilt from the commander-parsed launch spec (see
      // buildRestartArgs) rather than from raw process.argv:
      // - the entry point is validated as a script path, so nothing the Node
      //   executable would parse as its own option can reach the child (Node
      //   only reads options before the script path, never after it);
      // - flag names come from the RESTART_FLAGS table only, and every value
      //   passes the non-flag check, so no token can be injected as an option;
      // - the array form without `shell` never routes through a shell, so no
      //   argument is ever re-parsed as command syntax.
      const restartArgs = buildRestartArgs(
        process.argv[1],
        getCapturedCliLaunchSpec(),
      );
      if (!restartArgs) {
        return;
      }
      const nodeExecutable = process.execPath;

      logger.debug(
        `Preparing for CLI restart with: ${nodeExecutable} ${restartArgs.join(
          " ",
        )}`,
      );

      // Halt/clean up parent tnt process
      try {
        // Remove all input listeners
        global.clearTimeout = () => {};
        global.clearInterval = () => {};
        process.stdin.removeAllListeners();
        process.stdin.pause();
        // console.clear(); // Don't want to clear things that were in console before tnt started
      } catch (e) {
        logger.debug("Error cleaning up terminal:", e);
      }

      // Spawn a new detached tnt process
      const child = spawn(nodeExecutable, restartArgs, {
        detached: true,
        stdio: "inherit",
        env: {
          ...process.env,
          TNT_AUTO_UPDATED: "true",
        },
      });

      // I did not find a way on existing to avoid a bug where next process has input glitches without leaving parent in place
      // So instead of existing, parent will exit when child exits
      // process.exit(0);
      child.on("exit", (code) => {
        process.exit(code);
      });
      child.unref();
    } catch (error) {
      logger.error("Failed to restart CLI:", error);
    }
  }
}
