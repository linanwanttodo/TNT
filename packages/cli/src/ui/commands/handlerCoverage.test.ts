import { describe, expect, it } from "vitest";

import { BUILTIN_SLASH_COMMANDS } from "./builtins.js";
import { createCommandHandlers } from "./handlers/index.js";

/**
 * The command list shown to the user and the map the dispatcher consults are
 * built in two places, so they can disagree in two different ways. A built-in
 * with no handler is the bad one: the name is advertised and typing it does
 * nothing. A handler with no built-in is a command that works but never appears
 * in help, which is worth a name rather than silence.
 *
 * Both sets are read from the running modules, not from the sources, so this
 * reports what dispatch actually does.
 */
const builtinNames = BUILTIN_SLASH_COMMANDS.map((command) => command.name);
const handlerNames = Object.keys(createCommandHandlers());

describe("the slash commands the dispatcher can actually run", () => {
  it("handles every command the built-in list advertises", () => {
    const unhandled = builtinNames.filter(
      (name) => !handlerNames.includes(name),
    );

    expect(unhandled).toEqual([]);
  });

  it("keeps a working command undocumented on purpose, not by drift", () => {
    // back's alias, the profile switch and the todo list: dispatched, absent
    // from the advertised set, and each one is a deliberate choice.
    const undocumented = ["parent", "profile", "todos"].sort();

    const extra = handlerNames.filter((name) => !builtinNames.includes(name));

    expect(extra.sort()).toEqual(undocumented);
  });

  it("reads the two sets it is comparing", () => {
    expect(builtinNames.length).toBeGreaterThan(20);
    expect(handlerNames.length).toBeGreaterThan(20);
  });
});
