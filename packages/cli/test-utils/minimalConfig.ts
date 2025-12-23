import fs from "fs";
import path from "path";

import { env } from "../src/config/env.js";

/**
 * A complete config.yaml for tests that initialize services without exercising
 * config loading. The per-worker CONTINUE_GLOBAL_DIR is isolated, so this writes
 * into that worker's temp home and never the real one.
 */
export const MINIMAL_CONFIG = `name: Test
version: 1.0.0
schema: v1
models:
  - name: test-model
    provider: openai
    model: gpt-4
    apiKey: test-key
`;

export function writeMinimalConfig(): void {
  fs.mkdirSync(env.continueHome, { recursive: true });
  fs.writeFileSync(path.join(env.continueHome, "config.yaml"), MINIMAL_CONFIG);
}
