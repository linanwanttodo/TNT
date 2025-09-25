import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";

dotenv.config();

export const env = {
  apiBase: process.env.TNT_API_BASE ?? process.env.CONTINUE_API_BASE ?? "",
  // A getter rather than a frozen string: CONTINUE_GLOBAL_DIR is set by tests
  // and by embedding callers, and a home directory captured at import time
  // silently ignores every assignment made after that point.
  get continueHome(): string {
    return process.env.CONTINUE_GLOBAL_DIR || path.join(os.homedir(), ".tnt");
  },
};
