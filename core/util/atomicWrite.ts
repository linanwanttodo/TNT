import fs from "fs";

/**
 * Writes a file in one step: a reader sees either the previous contents or the
 * new ones, never a half-written file.
 *
 * The files this is used for are the ones the CLI cannot recover from being
 * truncated: a session is the only copy of a conversation, the global context
 * holds settings that are read back at startup, and the config file decides
 * which model the CLI will use. A plain write interrupted by a crash or a full
 * disk leaves a file that fails to parse, and the readers that skip what they
 * cannot parse do so without saying anything.
 */
export function writeFileAtomically(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, contents);
  fs.renameSync(temporaryPath, filePath);
}
