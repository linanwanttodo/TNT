import { exec, spawn } from "child_process";
import { promisify } from "util";

import { GlobalContext } from "core/util/GlobalContext.js";

import { logger } from "src/utils/logger.js";

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
          alreadyAutoUpdated: Boolean(process.env.CONTINUE_CLI_AUTO_UPDATED),
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
      // The restart re-executes this CLI with the arguments the user started
      // it with. They come from the process's own argv - the trust boundary
      // the OS already enforces. The spawn is hardened regardless:
      // - the entry point is validated as a script path, so nothing the Node
      //   executable would parse as its own option can reach the child (Node
      //   only reads options before the script path, never after it);
      // - empty arguments are dropped so the child argv stays well-formed;
      // - the array form without `shell` never routes through a shell, so no
      //   argument is ever re-parsed as command syntax.
      const entryPoint = process.argv[1];
      if (!entryPoint || entryPoint.startsWith("-")) {
        logger.debug("Skipping CLI restart: no script entry point in argv");
        return;
      }
      const restartArgs = [
        entryPoint,
        ...process.argv
          .slice(2)
          .filter((arg) => typeof arg === "string" && arg.length > 0),
      ];
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
          CONTINUE_CLI_AUTO_UPDATED: "true",
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
