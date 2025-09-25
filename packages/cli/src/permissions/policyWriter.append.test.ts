import fs from "fs";
import os from "os";
import path from "path";

import {
  loadPermissionsYaml,
  permissionsYamlPath,
} from "./permissionsYamlLoader.js";
import { addPolicyToYaml } from "./policyWriter.js";

describe("addPolicyToYaml", () => {
  const previousHome = process.env.CONTINUE_GLOBAL_DIR;

  beforeEach(() => {
    process.env.CONTINUE_GLOBAL_DIR = fs.mkdtempSync(
      path.join(os.tmpdir(), "tnt-policy-"),
    );
  });

  afterAll(() => {
    if (previousHome === undefined) {
      delete process.env.CONTINUE_GLOBAL_DIR;
    } else {
      process.env.CONTINUE_GLOBAL_DIR = previousHome;
    }
  });

  it("appends the rule to a file the loader can read back", async () => {
    await addPolicyToYaml("Bash(ls*)");

    const config = loadPermissionsYaml();
    expect(config?.allow).toEqual(["Bash(ls*)"]);
    expect(fs.readFileSync(permissionsYamlPath(), "utf-8")).toContain(
      "# TNT Permissions Configuration",
    );
  });

  it("does not add a rule that is already there", async () => {
    await addPolicyToYaml("Bash(ls*)");
    await addPolicyToYaml("Bash(ls*)");

    expect(loadPermissionsYaml()?.allow).toEqual(["Bash(ls*)"]);
  });

  it("keeps every rule when two writers run at once", async () => {
    await Promise.all([
      addPolicyToYaml("Bash(ls*)"),
      addPolicyToYaml("Bash(pwd*)"),
    ]);

    expect(loadPermissionsYaml()?.allow?.sort()).toEqual([
      "Bash(ls*)",
      "Bash(pwd*)",
    ]);
  });

  it("keeps the keys it did not touch", async () => {
    fs.writeFileSync(
      permissionsYamlPath(),
      "ask:\n  - Write\nexclude: []\n",
      "utf-8",
    );

    await addPolicyToYaml("Bash(ls*)");

    const config = loadPermissionsYaml();
    expect(config?.ask).toEqual(["Write"]);
    expect(config?.allow).toEqual(["Bash(ls*)"]);
  });
});
