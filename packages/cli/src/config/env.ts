import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";

dotenv.config();

export const env = {
  apiBase: process.env.TNT_API_BASE ?? process.env.CONTINUE_API_BASE ?? "",
  continueHome:
    process.env.CONTINUE_GLOBAL_DIR || path.join(os.homedir(), ".tnt"),
};
