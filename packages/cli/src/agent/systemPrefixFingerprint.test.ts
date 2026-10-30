import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

// A suite-wide mock of this module answers with one fixed string, so a guard that
// imported it plainly would freeze the stub and call the prefix protected. The
// section helpers are what is under test here, so the real module is loaded.
vi.unmock("./systemMessage.js");
const { buildSystemMessageSections } = await import("./systemMessage.js");

// Rules come from disk and the service container; neither may decide what the
// shared spine is, and a machine's own rules must not be able to break this file.
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

/**
 * The parts of the system message that are the same for every session are billed
 * as the cached prefix, and today only the clauses that `behaviourClauses.test.ts`
 * quotes by hand are protected: reword any other sentence and the suite stays
 * green while every new session pays a cold start. This guard freezes the whole
 * static spine instead, in the four shapes a run can ask for.
 *
 * Only the sections the builder itself marks non-volatile are digested. That set
 * is what makes the digest machine-independent - the plugin-forced output style,
 * a selected profile, the plan text and the user's own rules all vary between
 * sessions and machines, and none of them may enter here.
 *
 * The digests and the character count are also required to appear in
 * `ARCHITECTURE-tnt.md`, which this file reads as text: an intentional prefix
 * change cannot be committed without a line saying so.
 */
const FROZEN_SPINE = [
  { label: "tui", names: "base", chars: 5269, digest: "61314b4e4101cd8e" },
  {
    label: "tui-json",
    names: "base,jsonOutput",
    chars: 5685,
    digest: "d0ff19d5735947fb",
  },
  {
    label: "headless",
    names: "base,headless",
    chars: 5813,
    digest: "5d61ed68eb37c938",
  },
  {
    label: "headless-json",
    names: "base,headless,jsonOutput",
    chars: 6229,
    digest: "5411da0d13528c3e",
  },
];

const ARCHITECTURE_DOC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../ARCHITECTURE-tnt.md",
);

async function staticSpine(label: string, headless: boolean, format?: "json") {
  const sections = await buildSystemMessageSections(
    "default",
    [],
    format,
    headless,
  );
  const statics = sections.filter((section) => !section.volatile);
  const text = statics.map((section) => section.text).join("");

  return {
    label,
    names: statics.map((section) => section.name).join(","),
    chars: text.length,
    digest: createHash("sha256").update(text).digest("hex").slice(0, 16),
  };
}

async function currentSpine() {
  return [
    await staticSpine("tui", false),
    await staticSpine("tui-json", false, "json"),
    await staticSpine("headless", true),
    await staticSpine("headless-json", true, "json"),
  ];
}

describe("the static system-message spine as billed prefix", () => {
  it("has not moved in any of the four shapes a run can ask for", async () => {
    // Red here means the billed prompt changed. Move the digests, the counts and
    // the architecture-doc sentence together, and say what the change costs.
    expect(await currentSpine()).toEqual(FROZEN_SPINE);
  });

  it("keeps every digested shape in the architecture doc", async () => {
    const doc = readFileSync(ARCHITECTURE_DOC, "utf-8");

    for (const shape of await currentSpine()) {
      expect(doc).toContain(shape.digest);
    }
    expect(doc).toContain(`${FROZEN_SPINE[0].chars} characters`);
  });

  it("digests only what every session shares", async () => {
    const shapes = await currentSpine();

    // The volatile set is what protects this from becoming a machine fingerprint:
    // plan text, profiles, plugin output styles and the user's rules all move.
    for (const shape of shapes) {
      for (const name of shape.names.split(",").filter(Boolean)) {
        expect(["base", "headless", "jsonOutput"]).toContain(name);
      }
    }
    expect(new Set(shapes.map((shape) => shape.names)).size).toBe(4);
    // The floor that proves the real spine is being read: a stub of a hundred
    // characters, or a module that stopped emitting `base`, must not pass here.
    expect(shapes[0].chars).toBeGreaterThan(4000);
    expect(shapes[0].names.split(",")).toContain("base");
  });

  it("says the same thing for plan and auto as for agent", async () => {
    // The mode axis must not touch the static spine: `auto` adds no section and
    // `plan` adds only the volatile plan text, so the billed prefix is identical.
    const agent = await staticSpine("tui", false);
    for (const mode of ["plan", "bypassPermissions"] as const) {
      const sections = await buildSystemMessageSections(
        mode,
        [],
        undefined,
        false,
      );
      const text = sections
        .filter((section) => !section.volatile)
        .map((section) => section.text)
        .join("");

      expect(text.length).toBe(agent.chars);
      expect(text).toBe(
        (await buildSystemMessageSections("default", [], undefined, false))
          .filter((section) => !section.volatile)
          .map((section) => section.text)
          .join(""),
      );
    }
  });
});
