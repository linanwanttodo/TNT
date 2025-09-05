import { generatePolicyRule } from "./policyWriter.js";

describe("policyWriter", () => {
  describe("generatePolicyRule", () => {
    it("should return display name for regular tools", () => {
      expect(generatePolicyRule("Read", { file_path: "/test" })).toBe("Read");
      expect(
        generatePolicyRule("Write", { file_path: "/test", content: "test" }),
      ).toBe("Write");
      expect(generatePolicyRule("List", { path: "/test" })).toBe("List");
      expect(generatePolicyRule("Search", { pattern: "test" })).toBe("Search");
      expect(generatePolicyRule("Grep", { pattern: "test" })).toBe("Grep"); // Unknown tool, passes through
    });

    it("should generate command-specific patterns for Bash tool", () => {
      expect(generatePolicyRule("Bash", { command: "ls -la" })).toBe(
        "Bash(ls*)",
      );
      expect(generatePolicyRule("Bash", { command: "git status" })).toBe(
        "Bash(git*)",
      );
      expect(generatePolicyRule("Bash", { command: "npm install" })).toBe(
        "Bash(npm*)",
      );
    });

    it("writes the whole line for a chain, not a prefix over it", () => {
      // Bash(ls*) used to be the result here, which granted every ls-shaped
      // command forever on the strength of one approval that also ran echo.
      expect(
        generatePolicyRule("Bash", { command: "ls -la && echo test" }),
      ).toBe("Bash(ls -la && echo test)");
      expect(
        generatePolicyRule("Bash", {
          command: "find . -name '*.ts' | head -10",
        }),
      ).toBe("Bash(find . -name '*.ts' | head -10)");
      expect(
        generatePolicyRule("Bash", { command: "  grep -r test .  " }),
      ).toBe("Bash(grep*)");
    });

    it("writes the exact line when the command can do more than its name says", () => {
      // Bash(git*) here would grant git reset and git push on the strength of an
      // approval for one push, so the rule is the line the user read.
      expect(
        generatePolicyRule("Bash", { command: "git push origin main" }),
      ).toBe("Bash(git push origin main)");
      expect(generatePolicyRule("Bash", { command: "rm -rf build" })).toBe(
        "Bash(rm -rf build)",
      );
      expect(generatePolicyRule("Bash", { command: "npm publish" })).toBe(
        "Bash(npm publish)",
      );
      // An ordinary command still gets the reusable shape.
      expect(generatePolicyRule("Bash", { command: "git status" })).toBe(
        "Bash(git*)",
      );
    });

    it("should fallback to display name for bash tools without command", () => {
      expect(generatePolicyRule("Bash", {})).toBe("Bash");
      expect(generatePolicyRule("Bash", { command: "" })).toBe("Bash");
      expect(generatePolicyRule("Bash", { command: "   " })).toBe("Bash");
    });

    it("should use exact tool names without normalization", () => {
      expect(generatePolicyRule("bash", { command: "ls" })).toBe("bash");
      expect(generatePolicyRule("BASH", { command: "pwd" })).toBe("BASH");
      expect(generatePolicyRule("read", { file_path: "/test" })).toBe("read");
      expect(
        generatePolicyRule("write", { file_path: "/test", content: "test" }),
      ).toBe("write");
    });
  });
});
