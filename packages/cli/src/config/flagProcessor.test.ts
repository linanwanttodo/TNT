import {
  convertLegacyModeFlags,
  buildPermissionOverrides,
  processCommandFlags,
} from "./flagProcessor.js";

describe("convertLegacyModeFlags", () => {
  test("should return 'plan' when readonly is true", () => {
    expect(convertLegacyModeFlags(true, false)).toBe("plan");
  });

  test("should return 'auto' when auto is true", () => {
    expect(convertLegacyModeFlags(false, true)).toBe("bypassPermissions");
  });

  test("should return undefined when both flags are false", () => {
    expect(convertLegacyModeFlags(false, false)).toBeUndefined();
  });

  test("should return undefined when no flags provided", () => {
    expect(convertLegacyModeFlags()).toBeUndefined();
  });

  test("should throw error when both readonly and auto are true", () => {
    expect(() => convertLegacyModeFlags(true, true)).toThrow(
      "Cannot use both --readonly and --auto flags together",
    );
  });

  test("should return the requested mode", () => {
    expect(convertLegacyModeFlags(false, false, "agent")).toBe("default");
    expect(convertLegacyModeFlags(false, false, "plan")).toBe("plan");
    expect(convertLegacyModeFlags(false, false, "auto")).toBe(
      "bypassPermissions",
    );
  });

  test("should reject an unknown mode", () => {
    expect(() => convertLegacyModeFlags(false, false, "yolo")).toThrow(
      'Invalid --mode "yolo"',
    );
  });

  test("should reject --mode combined with legacy flags", () => {
    expect(() => convertLegacyModeFlags(true, false, "plan")).toThrow(
      "Cannot use --mode together with --readonly or --auto",
    );
  });
});

describe("buildPermissionOverrides", () => {
  test("should build permission overrides with all parameters", () => {
    const result = buildPermissionOverrides(
      ["readFile"],
      ["writeFile"],
      ["runTerminalCommand"],
      "plan",
    );

    expect(result).toMatchObject({
      allow: ["readFile"],
      ask: ["writeFile"],
      exclude: ["runTerminalCommand"],
      mode: "plan",
    });
  });

  test("should handle undefined parameters", () => {
    const result = buildPermissionOverrides();

    expect(result).toMatchObject({
      allow: undefined,
      ask: undefined,
      exclude: undefined,
      mode: undefined,
    });
  });

  test("should handle partial parameters", () => {
    const result = buildPermissionOverrides(["readFile"], undefined, ["Write"]);

    expect(result).toMatchObject({
      allow: ["readFile"],
      ask: undefined,
      exclude: ["Write"],
      mode: undefined,
    });
  });
});

describe("processCommandFlags", () => {
  test("should process readonly flag correctly", () => {
    const result = processCommandFlags({
      readonly: true,
      allow: ["readFile"],
      exclude: ["Write"],
    });

    expect(result).toMatchObject({
      mode: "plan",
      permissionOverrides: {
        allow: ["readFile"],
        ask: undefined,
        exclude: ["Write"],
        mode: "plan",
      },
    });
  });

  test("should process auto flag correctly", () => {
    const result = processCommandFlags({
      auto: true,
      ask: ["writeFile"],
    });

    expect(result).toMatchObject({
      mode: "bypassPermissions",
      permissionOverrides: {
        allow: undefined,
        ask: ["writeFile"],
        exclude: undefined,
        mode: "bypassPermissions",
      },
    });
  });

  test("should handle no mode flags", () => {
    const result = processCommandFlags({
      allow: ["readFile", "searchCode"],
    });

    expect(result).toMatchObject({
      mode: undefined,
      permissionOverrides: {
        allow: ["readFile", "searchCode"],
        ask: undefined,
        exclude: undefined,
        mode: undefined,
      },
    });
  });

  test("should throw error for conflicting flags", () => {
    expect(() =>
      processCommandFlags({
        readonly: true,
        auto: true,
      }),
    ).toThrow("Cannot use both --readonly and --auto flags together");
  });

  test("should process the mode flag", () => {
    const result = processCommandFlags({ mode: "agent" });

    expect(result).toMatchObject({
      mode: "default",
      permissionOverrides: {
        allow: undefined,
        ask: undefined,
        exclude: undefined,
        mode: "default",
      },
    });
  });

  test("should handle empty options", () => {
    const result = processCommandFlags({});

    expect(result).toMatchObject({
      mode: undefined,
      permissionOverrides: {
        allow: undefined,
        ask: undefined,
        exclude: undefined,
        mode: undefined,
      },
    });
  });
});
