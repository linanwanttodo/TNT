/**
 * Section-level reinjection for the system message.
 *
 * The registry builds the prefix as named sections; this module decides, per
 * section, whether the bytes the request keeps sending can stay as they are.
 * Two facts are tracked separately for every section: what the request prefix
 * still carries (never rewritten mid-session, so its bytes never rebill), and
 * what the model was last told for it, and through which channel.
 *
 * The two channels age differently. The prefix is durable by construction -
 * its bytes are never rewritten mid-session, so anything it carries stays
 * visible. An in-history update is not: compaction can eat the message that
 * carried it, and "I once said this" is not something the model can act on.
 * So a section told through the prefix is known until the prefix itself is
 * rewritten, while a section told through an appended update stays known only
 * while that update is still in the retained window.
 */

export interface SectionSnapshot {
  readonly id: string;
  /** FNV-1a over the section text, hex. Equality stands in for equality. */
  readonly hash: string;
  readonly text: string;
}

/**
 * FNV-1a: tiny, dependency-free, and stable across runs - enough to tell
 * "this section's bytes changed" without carrying the text around.
 */
export function hashSectionText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function captureSectionSnapshots(
  sections: readonly { id: string; text: string }[],
): SectionSnapshot[] {
  return sections.map((section) => ({
    id: section.id,
    hash: hashSectionText(section.text),
    text: section.text,
  }));
}

/** What the request prefix keeps sending for this section, never rewritten. */
export interface SectionPrefixBaseline {
  readonly snapshot: SectionSnapshot;
}

/**
 * What the model last received for this section, and how. `via` decides how
 * the fact ages: "prefix" facts live as long as the prefix bytes do, "append"
 * facts only as long as the message that carried them stays in the window.
 */
export interface SectionToldBaseline {
  readonly snapshot: SectionSnapshot;
  readonly via: "prefix" | "append";
  /** The exact delta text that was appended, when via is "append". */
  readonly appendedText?: string;
}

export interface SectionBaseline {
  readonly prefix: SectionPrefixBaseline;
  readonly told: SectionToldBaseline;
}

export interface SectionBaselineState {
  readonly byId: Map<string, SectionBaseline>;
}

export function createSectionBaselines(): SectionBaselineState {
  return { byId: new Map() };
}

/** Idempotent: called after compaction and after history rewrites. */
export function clearSectionBaselines(state: SectionBaselineState): void {
  state.byId.clear();
}

/**
 * How much of an appended update is probed inside the retained window. The
 * head of the delta is enough: it carries the wrapper that names the section.
 */
const RETAINED_PROBE_LENGTH = 200;

function appendStillRetained(
  told: SectionToldBaseline,
  retained: string,
): boolean {
  if (told.via === "prefix") return true;
  const probe = (told.appendedText ?? "")
    .trim()
    .slice(0, RETAINED_PROBE_LENGTH);
  return probe !== "" && retained.includes(probe);
}

/**
 * The environment section is line-shaped, so its delta is the changed lines,
 * with removals named explicitly: silence reads as "still true" to a model,
 * and a stale working directory must be visibly retired.
 */
export function renderSectionLineDiff(
  previous: string,
  current: string,
): string {
  const previousLines = previous.split("\n").filter((line) => line.trim());
  const currentLines = current.split("\n").filter((line) => line.trim());
  const currentSet = new Set(currentLines);
  const previousSet = new Set(previousLines);

  const removed = previousLines.filter((line) => !currentSet.has(line));
  const added = currentLines.filter((line) => !previousSet.has(line));
  if (removed.length === 0 && added.length === 0) return "";

  const parts: string[] = [];
  for (const line of removed) {
    parts.push(`<removed status="unavailable">${line}</removed>`);
  }
  for (const line of added) {
    parts.push(`<added>${line}</added>`);
  }
  return parts.join("\n");
}

const ENVIRONMENT_SECTION_ID = "environment";

function renderSectionDelta(
  id: string,
  previous: string,
  current: string,
): string {
  if (id !== ENVIRONMENT_SECTION_ID) return current;
  const lines = renderSectionLineDiff(previous, current);
  return `\n\nThe environment changed since the snapshot above; removed entries are marked unavailable:\n${lines}`;
}

export interface PlanSectionReinjectionInput {
  /** The sections this request's build produced, in registry order. */
  readonly sections: readonly { id: string; text: string }[];
  readonly baselines: SectionBaselineState;
  /** The history text this request will still show the model. */
  readonly retainedHistory: string;
  /** Updates appended in earlier rounds, still in the window. */
  readonly existingUpdates: readonly string[];
  /** Whether the dialect carries a second system message at all. */
  readonly carriesInHistory: boolean;
}

export interface SectionReinjectionVerdict {
  readonly id: string;
  readonly action: "full" | "unchanged" | "diff";
}

export interface ReinjectionPlan {
  /** What the request sends as its system field for this round. */
  readonly prefixText: string;
  /** Section restatements to append in-history, in section order. */
  readonly appends: readonly string[];
  readonly perSection: readonly SectionReinjectionVerdict[];
}

/**
 * Decide, per section, what this request sends. The prefix text keeps the
 * baseline bytes for every section the model already knows; a changed section
 * becomes an in-history restatement instead. When the dialect cannot carry an
 * in-history system message, a changed section falls back to joining the
 * prefix with the current build, which rewrites it - the update must reach
 * the model somehow.
 */
export function planSectionReinjection(
  input: PlanSectionReinjectionInput,
): ReinjectionPlan {
  const { sections, baselines, retainedHistory, existingUpdates } = input;
  const alreadySent = existingUpdates.join("\n");
  const retained = `${alreadySent}\n${retainedHistory}`;

  const perSection: SectionReinjectionVerdict[] = [];
  const appends: string[] = [];
  let forcedRewrite = false;

  const requestTexts = sections.map((section) => {
    const current: SectionSnapshot = {
      id: section.id,
      hash: hashSectionText(section.text),
      text: section.text,
    };
    const baseline = baselines.byId.get(section.id);

    // Absent: no baseline, or the version the model was told through an
    // appended update has fallen out of the retained window.
    const absent =
      baseline === undefined || !appendStillRetained(baseline.told, retained);

    if (absent) {
      baselines.byId.set(section.id, {
        prefix: { snapshot: current },
        told: { snapshot: current, via: "prefix" },
      });
      perSection.push({ id: section.id, action: "full" });
      return current.text;
    }

    if (baseline.told.snapshot.hash === current.hash) {
      perSection.push({ id: section.id, action: "unchanged" });
      return baseline.prefix.snapshot.text;
    }

    // Known and changed. The prefix keeps its bytes; the delta rides
    // in-history when the dialect can carry it.
    if (!input.carriesInHistory) {
      forcedRewrite = true;
      perSection.push({ id: section.id, action: "full" });
      return current.text;
    }

    const delta = renderSectionDelta(
      section.id,
      baseline.told.snapshot.text,
      current.text,
    );
    appends.push(delta);
    baselines.byId.set(section.id, {
      prefix: baseline.prefix,
      told: { snapshot: current, via: "append", appendedText: delta },
    });
    perSection.push({ id: section.id, action: "diff" });
    return baseline.prefix.snapshot.text;
  });

  // One section the dialect cannot restate rewrites the whole prefix: a
  // half-old prefix would claim sections the appended deltas also restate.
  if (forcedRewrite) {
    baselines.byId.clear();
    for (const section of sections) {
      const snapshot: SectionSnapshot = {
        id: section.id,
        hash: hashSectionText(section.text),
        text: section.text,
      };
      baselines.byId.set(section.id, {
        prefix: { snapshot },
        told: { snapshot, via: "prefix" },
      });
    }
    for (let index = 0; index < perSection.length; index++) {
      perSection[index] = { ...perSection[index], action: "full" };
    }
    appends.length = 0;
    return {
      prefixText: sections.map((section) => section.text).join(""),
      appends: [],
      perSection,
    };
  }

  return {
    prefixText: requestTexts.join(""),
    appends,
    perSection,
  };
}
