import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";

interface ExtractionLimits {
  maxBytes?: number;
  maxEntries?: number;
}

export async function safeExtractTarball(
  archive: string,
  destination: string,
  limits: ExtractionLimits = {},
): Promise<void> {
  const stat = fs.lstatSync(archive);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
    throw new Error(
      "Archive exceeds the compressed size limit or is not a regular file",
    );
  }
  const maxBytes = limits.maxBytes ?? 256 * 1024 * 1024;
  const maxEntries = limits.maxEntries ?? 10_000;
  const makeFilter = () => {
    let bytes = 0;
    let count = 0;
    let error: Error | undefined;
    return {
      getError: () => error,
      filter: (name: string, raw: fs.Stats | tar.ReadEntry): boolean => {
        if (error) return false;
        const entry = raw as tar.ReadEntry;
        const parts = name.split("/");
        if (
          name.includes("\\") ||
          path.posix.isAbsolute(name) ||
          /^[A-Za-z]:/.test(name) ||
          parts.includes("..") ||
          parts[0] !== "package"
        ) {
          error = new Error(
            `Archive entry outside the package directory: ${name}`,
          );
        } else if (
          !["File", "OldFile", "Directory"].includes(entry.type) ||
          entry.linkpath
        ) {
          error = new Error(`Unsupported archive entry type or link: ${name}`);
        } else if (++count > maxEntries) {
          error = new Error("Archive exceeds the entry limit");
        } else if (
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          (bytes += entry.size) > maxBytes
        ) {
          error = new Error("Archive exceeds the uncompressed size limit");
        }
        return !error;
      },
    };
  };
  const preflight = makeFilter();
  await tar.t({ file: archive, strict: true, filter: preflight.filter });
  if (preflight.getError()) throw preflight.getError();

  const absolute = path.resolve(destination);
  let current = path.parse(absolute).root;
  for (const segment of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("Archive destination contains a symbolic link");
    }
  }
  fs.mkdirSync(absolute, { recursive: true });
  const extraction = makeFilter();
  await tar.x({
    file: archive,
    cwd: absolute,
    strict: true,
    preservePaths: false,
    filter: extraction.filter,
  });
  if (extraction.getError()) throw extraction.getError();
}
