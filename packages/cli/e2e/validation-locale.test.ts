import fs from "fs";
import path from "path";

import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "../test-utils/cli-helpers.js";

/**
 * The dictionary guards prove both locales carry every key; nothing proved the CLI
 * reads the Chinese side when the user chose it, and the flag errors translated in
 * `b0dc73029` keep their English text byte-identical, so an English assertion cannot
 * tell the two apart. This boots the built CLI with a stored `zh-CN` locale and
 * asserts the error the user reads.
 *
 * The first version stored `"zh"`: LOCALES is ["en", "zh-CN"], so the CLI rejected the
 * code and correctly fell back - the fixture was wrong, not the product. The second
 * version was right about the locale and still read English, which is how the second
 * copy of this message in `config/flagProcessor.ts` was found.
 */
describe("E2E: validation errors follow the stored locale", () => {
  let context: any;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  it("prints the Chinese --mode error when the stored locale is zh-CN", async () => {
    const globalDir = path.join(context.testDir, ".tnt");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ locale: "zh-CN" }),
    );

    const result = await runCLI(context, {
      args: ["--mode", "bogus", "-p", "hi"],
      env: { CONTINUE_GLOBAL_DIR: globalDir },
      timeout: 30000,
    });

    expect(result.exitCode).not.toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("无效的 --mode");
    expect(output).toContain("bogus");
  }, 60000);
});
