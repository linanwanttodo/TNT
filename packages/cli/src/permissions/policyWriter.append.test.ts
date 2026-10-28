import fs from "fs";
import os from "os";
import path from "path";

import { loadSettings, settingsPath } from "../config/settings.js";

import { addPolicyRule } from "./policyWriter.js";

describe("addPolicyRule", () => {
  const previousHome = process.env.TNT_GLOBAL_DIR;

  beforeEach(() => {
    process.env.TNT_GLOBAL_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-policy-"),
    );
  });

  afterAll(() => {
    if (previousHome === undefined) {
      delete process.env.TNT_GLOBAL_DIR;
    } else {
      process.env.TNT_GLOBAL_DIR = previousHome;
    }
  });

  it("appends the rule to settings.json", async () => {
    await addPolicyRule("Bash(ls*)");

    expect(loadSettings().permissions?.allow).toEqual(["Bash(ls*)"]);
    const written = JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    expect(written.permissions.allow).toEqual(["Bash(ls*)"]);
  });

  it("does not add a rule that is already there", async () => {
    await addPolicyRule("Bash(ls*)");
    await addPolicyRule("Bash(ls*)");

    expect(loadSettings().permissions?.allow).toEqual(["Bash(ls*)"]);
  });

  it("keeps every rule when two writers run at once", async () => {
    await Promise.all([
      addPolicyRule("Bash(ls*)"),
      addPolicyRule("Bash(pwd*)"),
    ]);

    expect(loadSettings().permissions?.allow?.sort()).toEqual([
      "Bash(ls*)",
      "Bash(pwd*)",
    ]);
  });

  it("keeps the settings it did not touch", async () => {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        permissions: { ask: ["Write"] },
        env: { TNT_LOG_LEVEL: "debug" },
      }),
      "utf-8",
    );

    await addPolicyRule("Bash(ls*)");

    const settings = loadSettings();
    expect(settings.permissions?.ask).toEqual(["Write"]);
    expect(settings.permissions?.allow).toEqual(["Bash(ls*)"]);
    expect(settings.env).toEqual({ TNT_LOG_LEVEL: "debug" });
  });
});
