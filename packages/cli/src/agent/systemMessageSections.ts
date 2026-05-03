import type { SystemMessageSection } from "./systemMessage.js";

/**
 * The prefix is a composition of announced sections; these utilities cut it
 * back into its parts and name what moved between two builds. They touch no
 * service and read no settings, so they live apart from the construction in
 * systemMessage.ts - which stays under its line limit by exporting here.
 */

/**
 * Each part of the prefix announces itself, and the report reads the prefix back
 * by those announcements instead of keeping a second list of what is where. The
 * drift guard is `systemMessage.sections.test.ts`, which rebuilds the prefix and
 * checks that the split recovers every part.
 */
export const SYSTEM_SECTION_MARKERS: readonly {
  name: string;
  marker: string;
}[] = [
  { name: "planMode", marker: '<context name="planMode">' },
  { name: "promptProfile", marker: '<context name="profile">' },
  { name: "headless", marker: "IMPORTANT: You are running in headless mode" },
  {
    name: "jsonOutput",
    marker: "IMPORTANT: You are operating in JSON output mode",
  },
  { name: "outputStyle", marker: '<context name="outputStyle"' },
  { name: "userRules", marker: '<context name="userRules">' },
  {
    name: "environment",
    marker:
      "Here is useful information about the environment you are running in:",
  },
];

/** The prefix cut back into its parts, keyed by section name. */
export function splitSystemMessageBySections(
  text: string,
): Record<string, string> {
  const found = SYSTEM_SECTION_MARKERS.map((entry) => ({
    ...entry,
    at: text.indexOf(entry.marker),
  }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);

  const parts: Record<string, string> = {
    base: found.length > 0 ? text.slice(0, found[0].at) : text,
  };
  found.forEach((entry, index) => {
    const end = index + 1 < found.length ? found[index + 1].at : text.length;
    parts[entry.name] = text.slice(entry.at, end);
  });
  return parts;
}

/**
 * Names the parts that differ between two builds of the prefix, in document
 * order. `prefixState` can only say that the system message moved; this is what
 * tells a user which of their own files moved, which is the part they can act
 * on. An empty string means the two texts are the same.
 */
export function describeSystemMessageTextChange(
  previous: string,
  current: string,
): string {
  if (previous === current) {
    return "";
  }

  const before = splitSystemMessageBySections(previous);
  const after = splitSystemMessageBySections(current);
  const names = Object.keys(after);
  const moved: string[] = [];

  for (const name of names) {
    const was = before[name];
    if (was === undefined) {
      moved.push(`${name} added`);
    } else if (was.trim() !== after[name].trim()) {
      moved.push(`${name} rewritten`);
    }
  }
  for (const name of Object.keys(before)) {
    if (!names.includes(name)) {
      moved.push(`${name} dropped`);
    }
  }

  return moved.join("; ");
}

export function joinSystemMessageSections(
  sections: readonly SystemMessageSection[],
): string {
  return sections.map((section) => section.text).join("");
}

/**
 * Names the parts that moved between two builds of the prefix, in the order the
 * new build has them. This is the whole point of sectioning the system message:
 * "systemMessage changed" tells a user nothing, "userRules rewritten" tells them
 * which file to stop editing mid-run.
 */
export function describeSystemMessageChange(
  previous: readonly SystemMessageSection[],
  next: readonly SystemMessageSection[],
): string {
  const before = new Map(previous.map((section) => [section.name, section]));
  const after = new Set(next.map((section) => section.name));

  const moved: string[] = [];
  for (const section of next) {
    const was = before.get(section.name);
    if (was === undefined) {
      moved.push(`${section.name} added`);
    } else if (was.text !== section.text) {
      moved.push(`${section.name} rewritten`);
    }
    before.delete(section.name);
  }
  for (const [name] of before) {
    if (!after.has(name)) {
      moved.push(`${name} dropped`);
    }
  }

  return moved.join("; ");
}
