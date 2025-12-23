import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readSelectedModelName,
  writeSelectedModelName,
} from "./modelSelection.js";

describe("config.yaml model selection", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnt-model-selection-"));
    file = path.join(dir, "config.yaml");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads the top-level model key", () => {
    fs.writeFileSync(
      file,
      "name: Test\nmodels:\n  - name: fast\nmodel: fast\n",
      "utf-8",
    );

    expect(readSelectedModelName(file)).toBe("fast");
  });

  it("returns null when the file or the key is missing", () => {
    expect(readSelectedModelName(file)).toBeNull();

    fs.writeFileSync(file, "name: Test\n", "utf-8");
    expect(readSelectedModelName(file)).toBeNull();
  });

  it("returns null for a malformed file instead of throwing", () => {
    fs.writeFileSync(file, "models: [unclosed\n", "utf-8");

    expect(readSelectedModelName(file)).toBeNull();
  });

  it("writes the selection and keeps comments and other keys", () => {
    fs.writeFileSync(
      file,
      [
        "# my models",
        "name: Test",
        "models:",
        "  - name: fast",
        "    provider: openai",
        "  - name: deep",
        "    provider: anthropic",
        "rules:",
        "  - be brief",
        "",
      ].join("\n"),
      "utf-8",
    );

    writeSelectedModelName("deep", file);

    const text = fs.readFileSync(file, "utf-8");
    expect(text).toContain("# my models");
    expect(text).toContain("model: deep");
    expect(text).toContain("rules:");
    expect(readSelectedModelName(file)).toBe("deep");
  });

  it("replaces an existing selection rather than appending a second one", () => {
    fs.writeFileSync(
      file,
      "name: Test\nmodels:\n  - name: fast\n  - name: deep\nmodel: fast\n",
      "utf-8",
    );

    writeSelectedModelName("deep", file);

    const text = fs.readFileSync(file, "utf-8");
    expect(text.match(/^model:/gm)).toHaveLength(1);
    expect(readSelectedModelName(file)).toBe("deep");
  });

  it("refuses a name that the file does not define", () => {
    fs.writeFileSync(file, "name: Test\nmodels:\n  - name: fast\n", "utf-8");

    expect(() => writeSelectedModelName("missing", file)).toThrow(
      /missing.*config\.yaml/s,
    );
    expect(fs.readFileSync(file, "utf-8")).not.toContain("model:");
  });

  it("refuses to invent a file", () => {
    expect(() => writeSelectedModelName("fast", file)).toThrow(
      /does not exist/,
    );
    expect(fs.existsSync(file)).toBe(false);
  });
});
