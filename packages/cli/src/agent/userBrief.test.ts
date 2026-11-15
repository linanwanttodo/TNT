import type { ChatHistoryItem } from "core/index.js";
import { convertToUnifiedHistory } from "core/util/messageConversion.js";
import { describe, expect, it } from "vitest";

import {
  buildUserBrief,
  findLastUserText,
  isUserBriefContent,
  planUserBrief,
  renderUserBriefMessage,
  USER_BRIEF_OPEN,
  withUserBrief,
} from "./userBrief.js";

function briefOf(text: string) {
  const brief = buildUserBrief(text);
  expect(brief).not.toBeNull();
  return brief!;
}

describe("buildUserBrief", () => {
  it("reads a bug report into goal, constraints, acceptance and references", () => {
    const brief = briefOf(
      [
        "TypeError: Cannot read properties of null in src/parser.ts",
        "The loader crashes when config.json is missing.",
        "It must fall back to defaults and must not throw.",
        "Run `npm test` and ensure the parser tests pass.",
      ].join("\n"),
    );

    expect(brief.objective).toBe(
      "The loader crashes when config.json is missing.",
    );
    expect(brief.constraints).toContain(
      "It must fall back to defaults and must not throw.",
    );
    expect(brief.acceptance).toContain(
      "Run `npm test` and ensure the parser tests pass.",
    );
    expect(brief.references.paths).toContain("src/parser.ts");
    expect(brief.references.paths).toContain("config.json");
    expect(brief.references.commands).toContain("npm test");
    expect(brief.references.errors.join(" ")).toContain("TypeError");
    expect(brief.language).toBe("en");

    // The wire form names every section the extraction actually found.
    expect(brief.text).toContain("Objective: ");
    expect(brief.text).toContain("Constraints:");
    expect(brief.text).toContain("Acceptance:");
    expect(brief.text).toContain("References:");
    expect(brief.text).toContain("Language: en");
  });

  it("reads a feature request without inventing constraints", () => {
    const brief = briefOf(
      [
        "Add a /brief toggle that persists in settings.",
        "It must work without an extra model call and must not change the system prompt.",
        "Existing tests should pass and `npm run lint` should stay green.",
      ].join("\n"),
    );

    expect(brief.objective).toBe(
      "Add a /brief toggle that persists in settings.",
    );
    expect(brief.constraints).toContain(
      "It must work without an extra model call and must not change the system prompt.",
    );
    expect(brief.acceptance).toContain(
      "Existing tests should pass and `npm run lint` should stay green.",
    );
    expect(brief.references.commands).toContain("npm run lint");
    expect(brief.references.paths).toEqual([]);
  });

  it("returns null for a short continuation", () => {
    expect(buildUserBrief("continue")).toBeNull();
    expect(buildUserBrief("please continue")).toBeNull();
    expect(buildUserBrief("好的")).toBeNull();
    expect(buildUserBrief("")).toBeNull();
  });

  it("returns null for slash commands and when disabled", () => {
    expect(buildUserBrief("/brief on")).toBeNull();
    expect(
      buildUserBrief(
        "Fix the loader crash in src/parser.ts and make the tests pass.",
        { enabled: false },
      ),
    ).toBeNull();
  });

  it("detects Chinese and keeps the original sentences", () => {
    const brief = briefOf(
      "修复登录页在密码为空时报错的问题。必须保留现有的接口，不要修改 src/login.ts 之外的代码。运行 npm test 验证。",
    );

    expect(brief.objective).toBe("修复登录页在密码为空时报错的问题。");
    expect(brief.constraints.join(" ")).toContain("必须保留现有的接口");
    expect(brief.constraints.join(" ")).toContain("不要修改");
    expect(brief.acceptance.join(" ")).toContain("运行 npm test 验证");
    expect(brief.references.paths).toContain("src/login.ts");
    expect(brief.references.commands).toContain("npm test");
    expect(brief.language).toBe("zh");
  });

  it("extracts explicit paths and commands", () => {
    const brief = briefOf(
      "Update packages/cli/src/agent/userBrief.ts and run `npm run lint` in packages/cli.",
    );

    expect(brief.references.paths).toContain(
      "packages/cli/src/agent/userBrief.ts",
    );
    expect(brief.references.paths).toContain("packages/cli");
    expect(brief.references.commands).toContain("npm run lint");
  });

  it("does not hallucinate constraints or acceptance from prose", () => {
    const brief = briefOf(
      "Add a dark mode toggle to the settings screen. Put it next to the theme picker.",
    );

    expect(brief.objective).toBe(
      "Add a dark mode toggle to the settings screen.",
    );
    expect(brief.constraints).toEqual([]);
    expect(brief.acceptance).toEqual([]);
  });

  it("renders a wrapped user-role context message", () => {
    const brief = briefOf(
      "Fix the loader crash in src/parser.ts and make the tests pass.",
    );
    const message = renderUserBriefMessage(brief);

    expect(message.startsWith(USER_BRIEF_OPEN)).toBe(true);
    expect(message.endsWith("</user-brief>")).toBe(true);
    expect(isUserBriefContent(message)).toBe(true);
  });
});

describe("placement in the turn history", () => {
  const userText =
    "Fix the loader crash in src/parser.ts. It must fall back to defaults and `npm test` must pass.";

  function baseHistory(): ChatHistoryItem[] {
    return convertToUnifiedHistory([
      { role: "user", content: "Earlier request about the docs." },
      { role: "assistant", content: "Done." },
      { role: "user", content: userText },
    ]);
  }

  it("inserts the brief immediately before the current user message", () => {
    const base = baseHistory();
    const result = withUserBrief(base, { enabled: true });

    expect(result.item).toBeDefined();
    expect(result.history).toHaveLength(base.length + 1);
    // Everything before the user message keeps its order; the user message
    // moves one slot to make room for the brief.
    expect(result.history.slice(0, 2)).toEqual(base.slice(0, 2));
    expect(result.history[2]).toBe(result.item);
    expect(result.history[3]).toBe(base[2]);
    expect(
      isUserBriefContent(result.history[2].message.content as string),
    ).toBe(true);
  });

  it("returns the history untouched when the toggle is off", () => {
    const base = baseHistory();
    const result = withUserBrief(base, { enabled: false });

    expect(result.item).toBeUndefined();
    expect(result.history).toBe(base);
    expect(planUserBrief(base, { enabled: false })).toBeNull();
  });

  it("does not brief a resumed history that ends on an assistant turn", () => {
    const history = convertToUnifiedHistory([
      { role: "user", content: userText },
      { role: "assistant", content: "Finished." },
    ]);

    expect(planUserBrief(history)).toBeNull();
  });

  it("does not repeat a brief already in front of the same message", () => {
    const once = withUserBrief(baseHistory()).history;

    expect(planUserBrief(once)).toBeNull();
  });

  it("finds the real user text after a brief was inserted", () => {
    const history = withUserBrief(baseHistory()).history;

    expect(findLastUserText(history)).toBe(userText);
  });
});
