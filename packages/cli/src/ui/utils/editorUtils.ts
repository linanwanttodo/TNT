import { spawnSync } from "node:child_process";

/**
 * Minimal editor launcher for the ported text buffer: opens a file in the
 * user's $VISUAL/$EDITOR, suspending raw mode for the duration. TNT has no
 * editor registry; the command name is taken from the environment as-is.
 */
export async function openFileInEditor(
  filePath: string,
  stdin?: NodeJS.ReadStream | null,
  setRawMode?: (mode: boolean) => void,
): Promise<void> {
  const editorCommand = process.env["VISUAL"] || process.env["EDITOR"] || "vi";
  const wasRaw = stdin?.isRaw ?? false;
  if (stdin && wasRaw && typeof setRawMode === "function") {
    setRawMode(false);
  }
  try {
    spawnSync(editorCommand, [filePath], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } finally {
    if (stdin && wasRaw && typeof setRawMode === "function") {
      setRawMode(true);
    }
  }
}
