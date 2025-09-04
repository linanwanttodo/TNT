import { describe, expect, it, vi } from "vitest";

vi.unmock("./systemMessage.js");
vi.mock("../services/ServiceContainer.js", () => ({
  serviceContainer: {
    get: vi.fn().mockResolvedValue({ config: { rules: [] } }),
    set: vi.fn(),
  },
}));
vi.mock("../config/hubLoader.js", () => ({
  processRule: vi
    .fn()
    .mockImplementation((spec: string) => Promise.resolve(spec)),
}));

const { constructSystemMessage, formatGitStatus } = await import(
  "./systemMessage.js"
);

const entry = (index: number, width = 0): string =>
  ` M src/module-${index}.ts${"x".repeat(width)}`;

describe("the git status block", () => {
  it("reports a clean tree and a small one unchanged", () => {
    expect(formatGitStatus("")).toBe("Working tree clean");
    expect(formatGitStatus("   \n\n")).toBe("Working tree clean");

    const two = `${entry(1)}\n${entry(2)}`;
    expect(formatGitStatus(two)).toBe(two);
  });

  it("stops at the entry limit and names what it dropped", () => {
    const text = formatGitStatus(
      Array.from({ length: 250 }, (_, i) => entry(i)).join("\n"),
    );

    expect(
      text.split("\n").filter((line) => line.startsWith(" M")),
    ).toHaveLength(200);
    expect(text).toContain("50 of 250 entries are not shown");
    expect(text).toContain("Run git status for the whole picture");
  });

  it("stops at the character limit too", () => {
    const text = formatGitStatus(
      [entry(1, 3900), entry(2, 3900), entry(3, 3900)].join("\n"),
    );

    expect(text).toContain("src/module-1.ts");
    expect(text).not.toContain("src/module-3.ts");
    expect(text).toContain("entries are not shown");
  });

  it("tells the model the block is a snapshot that will not update", async () => {
    const message = await constructSystemMessage("agent", [], undefined);

    expect(message).toContain('<context name="gitStatus">');
    expect(message).toContain(
      "a snapshot in time, and will not update during the conversation",
    );
  });
});
