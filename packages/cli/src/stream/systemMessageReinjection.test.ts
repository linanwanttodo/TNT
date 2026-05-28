import { describe, expect, it } from "vitest";

import {
  clearSectionBaselines,
  createSectionBaselines,
  hashSectionText,
  planSectionReinjection,
  renderSectionLineDiff,
} from "./systemMessageReinjection.js";

const ENVIRONMENT_V1 = `
Here is useful information about the environment you are running in:
<env>
Working directory: /repo
Is directory a git repo: true
Platform: linux
Today's date: 2026-11-06
</env>

As you answer the user's questions, you can use the following context:

<context name="gitStatus">This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.

 M src/a.ts
</context>`;

const ENVIRONMENT_V2 = ENVIRONMENT_V1.replace(
  " M src/a.ts",
  "M src/a.ts\nM src/b.ts",
);

const OUTPUT_STYLE_V1 =
  '\n\n<context name="outputStyle" source="compact">\nBe brief.\n</context>';
const OUTPUT_STYLE_V2 = OUTPUT_STYLE_V1.replace("Be brief.", "Be terse.");

describe("renderSectionLineDiff", () => {
  it("names removed entries as unavailable and keeps additions explicit", () => {
    const diff = renderSectionLineDiff("a\nb\nc", "b\nc\nd");
    expect(diff).toBe(
      '<removed status="unavailable">a</removed>\n<added>d</added>',
    );
  });

  it("returns nothing when the lines are identical", () => {
    expect(renderSectionLineDiff("a\nb", "b\na")).toBe("");
  });
});

describe("planSectionReinjection", () => {
  it("injects everything when no baseline exists", () => {
    const baselines = createSectionBaselines();
    const plan = planSectionReinjection({
      sections: [
        { id: "base", text: "BASE" },
        { id: "environment", text: ENVIRONMENT_V1 },
      ],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    expect(plan.prefixText).toBe(`BASE${ENVIRONMENT_V1}`);
    expect(plan.appends).toEqual([]);
    expect(plan.perSection.map((verdict) => verdict.action)).toEqual([
      "full",
      "full",
    ]);
    // The baseline now records what the prefix carries, so the next round can
    // compare against it.
    expect(baselines.byId.get("environment")?.told.via).toBe("prefix");
  });

  it("omits a section that is unchanged between rounds", () => {
    const baselines = createSectionBaselines();
    const sections = [
      { id: "base", text: "BASE" },
      { id: "environment", text: ENVIRONMENT_V1 },
    ];
    planSectionReinjection({
      sections,
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    const second = planSectionReinjection({
      sections,
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });
    expect(second.prefixText).toBe(`BASE${ENVIRONMENT_V1}`);
    expect(second.appends).toEqual([]);
    expect(second.perSection.map((verdict) => verdict.action)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("keeps the prefix bytes and appends only the environment delta", () => {
    const baselines = createSectionBaselines();
    planSectionReinjection({
      sections: [{ id: "environment", text: ENVIRONMENT_V1 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    const plan = planSectionReinjection({
      sections: [{ id: "environment", text: ENVIRONMENT_V2 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    // The prefix keeps the v1 bytes exactly, so nothing after them rebills.
    expect(plan.prefixText).toBe(ENVIRONMENT_V1);
    expect(plan.appends).toHaveLength(1);
    expect(plan.appends[0]).toContain(
      '<removed status="unavailable"> M src/a.ts</removed>',
    );
    expect(plan.appends[0]).toContain("<added>M src/a.ts</added>");
    expect(plan.appends[0]).toContain("<added>M src/b.ts</added>");
    expect(plan.perSection).toEqual([{ id: "environment", action: "diff" }]);
    // The told side moved to the append channel; the prefix side stays.
    const baseline = baselines.byId.get("environment");
    expect(baseline?.told.via).toBe("append");
    expect(baseline?.told.snapshot.hash).toBe(hashSectionText(ENVIRONMENT_V2));
    expect(baseline?.prefix.snapshot.text).toBe(ENVIRONMENT_V1);
  });

  it("restates a text section whole through the append channel", () => {
    const baselines = createSectionBaselines();
    planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V1 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    const plan = planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V2 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    expect(plan.prefixText).toBe(OUTPUT_STYLE_V1);
    expect(plan.appends).toEqual([OUTPUT_STYLE_V2]);
  });

  it("does not append a delta twice once the model has been told", () => {
    const baselines = createSectionBaselines();
    const history: string[] = [];
    const send = (appends: readonly string[]) => {
      history.push(...appends);
    };

    planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V1 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });
    const changed = planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V2 }],
      baselines,
      retainedHistory: history.join("\n"),
      existingUpdates: history,
      carriesInHistory: true,
    });
    send(changed.appends);

    const third = planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V2 }],
      baselines,
      retainedHistory: history.join("\n"),
      existingUpdates: history,
      carriesInHistory: true,
    });

    expect(third.appends).toEqual([]);
    expect(third.prefixText).toBe(OUTPUT_STYLE_V1);
    expect(third.perSection).toEqual([
      { id: "outputStyle", action: "unchanged" },
    ]);
  });

  it("falls back to a full injection when compaction ate the appended update", () => {
    const baselines = createSectionBaselines();
    planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V1 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });
    planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V2 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    // Compaction: the appended update is gone from the window, so the model
    // can no longer be assumed to know the style changed.
    const plan = planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V2 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });

    expect(plan.prefixText).toBe(OUTPUT_STYLE_V2);
    expect(plan.appends).toEqual([]);
    expect(plan.perSection).toEqual([{ id: "outputStyle", action: "full" }]);
  });

  it("rewrites the whole prefix when the dialect cannot carry appends", () => {
    const baselines = createSectionBaselines();
    planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V1 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: false,
    });

    const plan = planSectionReinjection({
      sections: [{ id: "outputStyle", text: OUTPUT_STYLE_V2 }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: false,
    });

    expect(plan.prefixText).toBe(OUTPUT_STYLE_V2);
    expect(plan.appends).toEqual([]);
    expect(plan.perSection).toEqual([{ id: "outputStyle", action: "full" }]);
  });

  it("clears its baselines idempotently", () => {
    const baselines = createSectionBaselines();
    planSectionReinjection({
      sections: [{ id: "base", text: "BASE" }],
      baselines,
      retainedHistory: "",
      existingUpdates: [],
      carriesInHistory: true,
    });
    clearSectionBaselines(baselines);
    clearSectionBaselines(baselines);
    expect(baselines.byId.size).toBe(0);
  });
});
