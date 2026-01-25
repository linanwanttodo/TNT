import path from "path";
import { fileURLToPath } from "url";

/** A server may answer with a file URI or an opaque scheme; show both readably. */
export function describeLspUri(uri: string | undefined): string {
  if (!uri) {
    return "?";
  }
  if (!uri.startsWith("file://")) {
    return uri;
  }
  try {
    return path.relative(process.cwd(), fileURLToPath(uri)) || ".";
  } catch {
    return uri;
  }
}
