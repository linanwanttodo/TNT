import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildRestartArgs,
  captureCliLaunchSpec,
  getCapturedCliLaunchSpec,
  type CliLaunchSpec,
} from "./UpdateService.js";

const ENTRY = "/usr/local/bin/tnt";

describe("buildRestartArgs", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("entry point validation: null and flag-shaped entry points are refused", () => {
    expect(buildRestartArgs(undefined, null)).toBeNull();
    expect(buildRestartArgs(null as unknown as string, null)).toBeNull();
    expect(buildRestartArgs("--inspect", null)).toBeNull();
    expect(buildRestartArgs("-e", null)).toBeNull();
    expect(buildRestartArgs("", null)).toBeNull();
  });

  test("a valid bare entry point restarts without any captured spec", () => {
    expect(buildRestartArgs(ENTRY, null)).toEqual([ENTRY]);
  });

  test("shape is fixed: entry point, subcommand, flag pairs, then -- operands", () => {
    // Flags are emitted in RESTART_FLAGS table order, not options key order -
    // the fixed shape is what the test pins down.
    const spec: CliLaunchSpec = {
      command: null,
      options: {
        print: true,
        resume: true,
        model: ["gpt-4"],
        prompt: ["fix the bug"],
      },
      declaredOptions: ["print", "resume", "model", "prompt"],
      operands: ["hello world"],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "--model",
      "gpt-4",
      "--prompt",
      "fix the bug",
      "--print",
      "--resume",
      "--",
      "hello world",
    ]);
  });

  test("subcommands are re-emitted before the flags", () => {
    const spec: CliLaunchSpec = {
      command: "review",
      options: { format: "json" },
      declaredOptions: ["format"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "review",
      "--format",
      "json",
    ]);
  });

  test("unknown or undeclared flags are dropped", () => {
    const spec: CliLaunchSpec = {
      command: null,
      options: {
        totallyUnknown: true,
        print: true,
        model: ["gpt-4"],
      },
      // declaredOptions deliberately omits `totallyUnknown`
      declaredOptions: ["print", "model"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "--model",
      "gpt-4",
      "--print",
    ]);
  });

  test("values that start with - are refused even when declared", () => {
    const spec: CliLaunchSpec = {
      command: null,
      options: {
        model: ["--debug-flag"],
        config: "/path/to/config.yaml",
        format: "json",
      },
      declaredOptions: ["model", "config", "format"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "--config",
      "/path/to/config.yaml",
      "--format",
      "json",
    ]);
  });

  test("empty-string and non-string values are refused", () => {
    const spec: CliLaunchSpec = {
      command: null,
      options: {
        config: "",
        model: ["valid-model"],
        maxSteps: 42,
      },
      declaredOptions: ["config", "model", "maxSteps"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "--model",
      "valid-model",
      "--max-steps",
      "42",
    ]);
  });

  test("repeatable list options emit one pair per element", () => {
    const spec: CliLaunchSpec = {
      command: null,
      options: {
        allow: ["Bash", "Read"],
        exclude: ["Write", "--hacked"],
      },
      declaredOptions: ["allow", "exclude"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "--allow",
      "Bash",
      "--allow",
      "Read",
      "--exclude",
      "Write",
    ]);
  });

  test("operands go behind a -- separator so a dash-leading operand stays positional", () => {
    const spec: CliLaunchSpec = {
      command: "checks",
      options: {},
      declaredOptions: [],
      operands: ["list", "-rf", "--bad-flag"],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "checks",
      "--",
      "list",
      "-rf",
      "--bad-flag",
    ]);
  });

  test("negatable --no-open is re-emitted when the value is false", () => {
    const spec: CliLaunchSpec = {
      command: "webui",
      options: { open: false },
      declaredOptions: ["open"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([
      ENTRY,
      "webui",
      "--no-open",
    ]);
  });

  test("negatable --no-open is not emitted when the value is true", () => {
    const spec: CliLaunchSpec = {
      command: "webui",
      options: { open: true },
      declaredOptions: ["open"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([ENTRY, "webui"]);
  });

  test("an unsafe subcommand is dropped but the rest still restarts", () => {
    const spec: CliLaunchSpec = {
      command: "--dangerous-subcommand",
      options: { print: true },
      declaredOptions: ["print"],
      operands: [],
    };
    expect(buildRestartArgs(ENTRY, spec)).toEqual([ENTRY, "--print"]);
  });

  test("captureCliLaunchSpec stores and getCapturedCliLaunchSpec returns the spec", () => {
    const spec: CliLaunchSpec = {
      command: null,
      options: {},
      declaredOptions: [],
      operands: [],
    };
    captureCliLaunchSpec(spec);
    expect(getCapturedCliLaunchSpec()).toBe(spec);
  });
});
