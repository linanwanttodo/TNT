import { TntError, TntErrorReason } from "core/util/errors.js";
import { describe, expect, it } from "vitest";

import { rebaseMultiEdit, rebaseSingleEdit } from "./editRebase.js";

function failure(run: () => unknown): TntError {
  try {
    run();
  } catch (error) {
    if (error instanceof TntError) return error;
    throw error;
  }
  throw new Error("Expected a TntError");
}

describe("approved edit rebase", () => {
  it("replays a single replacement on current contents", () => {
    const result = rebaseSingleEdit({
      currentContent: "header\nold\nfooter",
      baseContent: "old\nfooter",
      plannedContent: "new\nfooter",
      recipe: {
        oldString: "old",
        newString: "new",
        replaceAll: false,
      },
    });

    expect(result).toBe("header\nnew\nfooter");
  });

  it("replays a multi-edit recipe on current contents", () => {
    const result = rebaseMultiEdit({
      currentContent: "header\none\ntwo",
      baseContent: "one\ntwo",
      plannedContent: "1\n2",
      edits: [
        { old_string: "one", new_string: "1" },
        { old_string: "two", new_string: "2" },
      ],
    });

    expect(result).toBe("header\n1\n2");
  });

  it("returns current context when the anchor no longer exists", () => {
    const error = failure(() =>
      rebaseSingleEdit({
        currentContent: "header\nchanged\nfooter",
        baseContent: "old\nfooter",
        plannedContent: "new\nfooter",
        recipe: {
          oldString: "old",
          newString: "new",
          replaceAll: false,
        },
      }),
    );

    expect(error.reason).toBe(TntErrorReason.FindAndReplaceOldStringNotFound);
    expect(error.message).toContain("header");
    expect(error.message).toContain("changed");
    expect(error.message).toContain("Searched for the line");
  });

  it("refuses a stale edit with no replay recipe", () => {
    const error = failure(() =>
      rebaseSingleEdit({
        currentContent: "changed",
        baseContent: "old",
        plannedContent: "new",
      }),
    );

    expect(error.reason).toBe(TntErrorReason.EditToolFileNotRead);
  });
});
