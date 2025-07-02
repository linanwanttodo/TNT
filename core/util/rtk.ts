import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RtkGainDay {
  date: string;
  commands: number;
  input: number;
  saved: number;
  pct: number;
}

export interface RtkGainView {
  installed: boolean;
  version?: string;
  latest?: string;
  summary?: {
    commands: number;
    input: number;
    saved: number;
    pct: number;
  };
  days?: RtkGainDay[];
  // What the user can run to install or upgrade rtk, when we know a way
  installCommand?: string;
  upgradeCommand?: string;
  // Set when an upgrade ran but the version did not change: the package
  // manager channel does not carry the newest release yet
  upgradeNote?: string;
  error?: string;
}

interface RtkGainJson {
  summary?: {
    total_commands?: number;
    total_input?: number;
    total_saved?: number;
    avg_savings_pct?: number;
  };
  daily?: {
    date?: string;
    commands?: number;
    input_tokens?: number;
    saved_tokens?: number;
    savings_pct?: number;
  }[];
}

// rtk's own installer places the binary in ~/.local/bin and supports
// RTK_INSTALL_DIR, mirroring the upstream install flow.
const RTK_INSTALL_SCRIPT =
  "https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh";
const RTK_RELEASES_API =
  "https://api.github.com/repos/rtk-ai/rtk/releases/latest";

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const UPGRADE_TIMEOUT_MS = 10 * 60_000;

let cachedPath: string | undefined;

function candidateDirs(): string[] {
  const home = os.homedir();
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
  ];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      dirs.unshift(path.join(localAppData, "Microsoft", "WinGet", "Links"));
    }
  }
  return dirs;
}

// Locates the rtk binary. rtk may be installed but not on the PATH this
// process gets, so the known install locations are checked as a fallback.
export async function resolveRtkPath(): Promise<string | undefined> {
  if (cachedPath !== undefined) {
    return cachedPath || undefined;
  }
  const name = process.platform === "win32" ? "rtk.exe" : "rtk";
  try {
    const { stdout } = await execFileAsync("which", [name]).catch(() =>
      execFileAsync("where", [name]).catch(() => ({ stdout: "" })),
    );
    const found = stdout.trim().split("\n")[0]?.trim();
    if (found) {
      cachedPath = found;
      return found;
    }
  } catch {
    // fall through to known locations
  }
  for (const dir of candidateDirs()) {
    const candidate = path.join(dir, name);
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5000 });
      cachedPath = candidate;
      return candidate;
    } catch {
      // not here
    }
  }
  cachedPath = "";
  return undefined;
}

function invalidatePathCache() {
  cachedPath = undefined;
}

async function runRtk(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const { stdout } = await execFileAsync(bin, args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

// The command that installs rtk on this machine: Homebrew when present,
// otherwise rtk's own install script through curl. Mirrors the upstream
// package manager detection.
export async function rtkInstallerCommand(): Promise<string | undefined> {
  if (process.platform === "win32") {
    return "winget install --id rtk-ai.rtk --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity";
  }
  try {
    await execFileAsync("brew", ["--version"], { timeout: 5000 });
    return "brew install rtk";
  } catch {
    // no brew
  }
  try {
    await execFileAsync("curl", ["--version"], { timeout: 5000 });
    return `curl -fsSL ${RTK_INSTALL_SCRIPT} | sh`;
  } catch {
    return undefined;
  }
}

// Detects how the rtk at bin was installed and returns the matching upgrade
// command, so upgrades go through the same channel that installed it.
export async function rtkUpgraderCommand(
  bin: string,
): Promise<string | undefined> {
  if (process.platform === "win32") {
    return "winget upgrade --id rtk-ai.rtk --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity";
  }
  const home = os.homedir();
  const brewPrefixes = [
    "/opt/homebrew",
    "/usr/local",
    path.join(home, ".linuxbrew"),
  ];
  if (brewPrefixes.some((p) => bin.startsWith(p))) {
    try {
      await execFileAsync("brew", ["--version"], { timeout: 5000 });
      return "brew upgrade rtk";
    } catch {
      // brew gone, fall through
    }
  }
  if (bin.startsWith(path.join(home, ".cargo"))) {
    return "cargo install --git https://github.com/rtk-ai/rtk --force";
  }
  // The script installer keeps rtk in ~/.local/bin
  if (bin.startsWith(path.join(home, ".local", "bin"))) {
    return `curl -fsSL ${RTK_INSTALL_SCRIPT} | sh`;
  }
  return rtkInstallerCommand();
}

// Runs an installer/upgrader command through the shell. Installers ask
// nothing and may take minutes; output is not surfaced unless it fails.
async function runInstallerCommand(
  command: string,
  timeoutMs: number,
): Promise<void> {
  const useShell = command.includes("|") || command.includes(" ");
  const [bin, ...rest] = command.split(" ");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(useShell ? command : bin, useShell ? [] : rest, {
      shell: useShell,
      env: {
        ...process.env,
        NONINTERACTIVE: "1",
        HOMEBREW_NO_AUTO_UPDATE: "1",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("installer timed out"));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`installer exited with code ${code}`));
      }
    });
  });
}

// The newest rtk release, cached: a successful read is good for six hours,
// a failure for fifteen minutes, so the settings page does not hammer the
// releases API.
let latestCache: { version: string; readAt: number } | null = null;
let latestFailedAt = 0;

async function rtkLatestVersion(): Promise<string | undefined> {
  const now = Date.now();
  if (latestCache && now - latestCache.readAt < 6 * 3600_000) {
    return latestCache.version;
  }
  if (latestFailedAt && now - latestFailedAt < 15 * 60_000) {
    return undefined;
  }
  try {
    const res = await fetch(RTK_RELEASES_API, {
      headers: { "User-Agent": "continue-ide-extension" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`releases API returned ${res.status}`);
    }
    const json = (await res.json()) as { tag_name?: string };
    const version = json.tag_name?.replace(/^v/, "");
    if (version) {
      latestCache = { version, readAt: now };
      return version;
    }
    return undefined;
  } catch {
    latestFailedAt = now;
    return undefined;
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}

// Builds the view from a resolved binary: version, latest release, gain
// history, and the commands the user can run themselves.
async function buildView(bin: string): Promise<RtkGainView> {
  const view: RtkGainView = { installed: true };

  try {
    const out = await runRtk(bin, ["--version"], 5000);
    view.version = out.trim().replace(/^rtk\s*/i, "") || undefined;
  } catch {
    // version unknown
  }

  const [latest, installer, upgrader] = await Promise.all([
    rtkLatestVersion(),
    rtkInstallerCommand(),
    rtkUpgraderCommand(bin),
  ]);
  view.latest = latest;
  if (latest && view.version && isNewer(latest, view.version)) {
    view.upgradeCommand = upgrader ?? installer;
  }

  return view;
}

async function withGain(view: RtkGainView, bin: string): Promise<RtkGainView> {
  try {
    const gainOut = await runRtk(
      bin,
      ["gain", "--daily", "--format", "json"],
      15000,
    );
    const start = gainOut.indexOf("{");
    const end = gainOut.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(gainOut.slice(start, end + 1)) as RtkGainJson;
      if (parsed.summary) {
        view.summary = {
          commands: parsed.summary.total_commands ?? 0,
          input: parsed.summary.total_input ?? 0,
          saved: parsed.summary.total_saved ?? 0,
          pct: parsed.summary.avg_savings_pct ?? 0,
        };
      }
      if (parsed.daily?.length) {
        view.days = parsed.daily.map((d) => ({
          date: d.date ?? "",
          commands: d.commands ?? 0,
          input: d.input_tokens ?? 0,
          saved: d.saved_tokens ?? 0,
          pct: d.savings_pct ?? 0,
        }));
      }
    }
  } catch (e) {
    view.error = (e as Error).message;
  }
  return view;
}

// Says whether rtk is installed, what it saved, and how to install or
// upgrade it. Installation and upgrades run only when the user asks.
export async function readRtkGain(): Promise<RtkGainView> {
  const bin = await resolveRtkPath();
  if (!bin) {
    const installCommand = await rtkInstallerCommand();
    return { installed: false, installCommand };
  }
  const view = await buildView(bin);
  return withGain(view, bin);
}

// Installs rtk the way this machine prefers. A no-op when it is already
// present; the returned view reflects the state after the run.
export async function installRtk(): Promise<RtkGainView> {
  const existing = await resolveRtkPath();
  if (existing) {
    return readRtkGain();
  }
  const command = await rtkInstallerCommand();
  if (!command) {
    return {
      installed: false,
      error: "no supported installer on this machine",
    };
  }
  try {
    await runInstallerCommand(command, INSTALL_TIMEOUT_MS);
  } catch (e) {
    invalidatePathCache();
    return {
      installed: false,
      installCommand: command,
      error: (e as Error).message,
    };
  }
  invalidatePathCache();
  return readRtkGain();
}

// Brings rtk to its latest release through the channel that installed it.
export async function upgradeRtk(): Promise<RtkGainView> {
  const bin = await resolveRtkPath();
  if (!bin) {
    return { installed: false, error: "rtk is not installed" };
  }
  const command = await rtkUpgraderCommand(bin);
  if (!command) {
    return {
      installed: true,
      error:
        "cannot tell how rtk was installed; update it the way you installed it",
    };
  }
  const before = await readRtkGain();
  try {
    await runInstallerCommand(command, UPGRADE_TIMEOUT_MS);
  } catch (e) {
    return { ...before, error: (e as Error).message };
  }
  invalidatePathCache();
  const after = await readRtkGain();
  if (
    after.version &&
    before.version &&
    after.version === before.version &&
    before.latest &&
    isNewer(before.latest, after.version)
  ) {
    after.upgradeNote =
      "the package manager does not carry the newest rtk release yet";
  }
  return after;
}

// Rewrites a shell command through rtk when it knows a more compact
// equivalent. Returns null when rtk is missing, fails, or has no rewrite
// for the command, in which case the caller runs the command unchanged.
export async function rewriteCommandWithRtk(
  command: string,
): Promise<string | null> {
  try {
    const bin = await resolveRtkPath();
    if (!bin) {
      return null;
    }
    const stdout = await runRtk(bin, ["rewrite", command], 5000);
    const rewritten = stdout.trim();
    return rewritten.length > 0 ? rewritten : null;
  } catch {
    return null;
  }
}
