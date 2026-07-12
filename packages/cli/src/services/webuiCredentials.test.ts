import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebUiCredentialService } from "./webuiCredentials.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-webui-credentials-"));
  file = path.join(dir, "webui-credentials.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createWebUiCredentialService", () => {
  it("round-trips a key through one owner-only file", async () => {
    const service = createWebUiCredentialService(file);

    await service.save("oauth:zai:access_token", "token-1");

    expect(await service.load("oauth:zai:access_token")).toBe("token-1");
    expect(await service.load("missing")).toBeNull();
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }

    await service.delete("oauth:zai:access_token");
    expect(await service.load("oauth:zai:access_token")).toBeNull();
  });

  it("keeps other keys when one is deleted", async () => {
    const service = createWebUiCredentialService(file);

    await service.save("a", "1");
    await service.save("b", "2");
    await service.delete("a");

    expect(await service.load("b")).toBe("2");
  });

  it("treats a corrupt store as empty instead of failing the page", async () => {
    fs.writeFileSync(file, "{not json");

    const service = createWebUiCredentialService(file);

    expect(await service.load("a")).toBeNull();
    await service.save("a", "1");
    expect(await service.load("a")).toBe("1");
  });

  it("rejects an empty key", async () => {
    const service = createWebUiCredentialService(file);

    await expect(service.save("  ", "1")).rejects.toThrow(/key/);
  });
});
