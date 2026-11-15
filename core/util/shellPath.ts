import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// The profile-sourcing snippet is a constant; the only dynamic input is
// $SHELL, which is passed as the file argument of execFile (array form, no
// shell), so it cannot be re-parsed as a command line.
const LOGIN_SNIPPET =
  'for f in ~/.zprofile ~/.zshrc ~/.bash_profile ~/.bashrc; do [ -f "$f" ] && source "$f" 2>/dev/null; done; echo $PATH';

export async function getEnvPathFromUserShell(
  remoteName?: string,
): Promise<string | undefined> {
  const isWindowsHostWithWslRemote =
    process.platform === "win32" && remoteName === "wsl";
  if (process.platform === "win32" && !isWindowsHostWithWslRemote) {
    return undefined;
  }

  const userShell = process.env.SHELL;
  if (!userShell) {
    return undefined;
  }

  try {
    // Source common profile files
    const { stdout } = await execFileAsync(
      userShell,
      ["-l", "-c", LOGIN_SNIPPET],
      {
        encoding: "utf8",
      },
    );

    return stdout.trim();
  } catch (error) {
    return process.env.PATH; // Fallback to current PATH
  }
}
