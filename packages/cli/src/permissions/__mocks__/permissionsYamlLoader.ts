import path from "path";

import { vi } from "vitest";

import { env } from "../../config/env.js";

export const permissionsYamlPath = vi.fn(() =>
  path.resolve(path.join(env.continueHome, "permissions.yaml")),
);

export const loadPermissionsYaml = vi.fn<() => any>(() => null);
export const parseToolPattern = vi.fn((pattern: string) => pattern);
export const yamlConfigToPolicies = vi.fn<() => any[]>(() => []);
export const ensurePermissionsYamlExists = vi.fn<() => Promise<void>>(
  async () => {},
);
