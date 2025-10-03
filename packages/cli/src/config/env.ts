import dotenv from "dotenv";

import { globalDir } from "./globalDir.js";

dotenv.config();

export const env = {
  apiBase: process.env.TNT_API_BASE ?? process.env.CONTINUE_API_BASE ?? "",
  // A getter rather than a frozen string: the global directory is set by tests
  // and by embedding callers, and a home captured at import time silently
  // ignores every assignment made after that point.
  get continueHome(): string {
    return globalDir();
  },
};
