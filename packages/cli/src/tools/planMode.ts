import {
  enterPlanProfile,
  exitPlanProfile,
} from "../permissions/planProfile.js";

import type { Tool } from "./types.js";

/**
 * Plan mode as something the agent asks for instead of something the user has
 * to remember. The permission side is the point: entering plan mode is safe, so
 * it needs no prompt, while leaving it is what allows changes to the project and
 * the policy asks for that one.
 */

const ENTER_TRIGGERS = `Call this before starting work when any of these is true:
- A feature or behaviour is being added rather than a fault being fixed.
- More than one approach would work and the choice matters.
- The change alters behaviour that already exists, or the architecture around it.
- The work will likely touch more than two or three files.
- The request is unclear enough that finding out what is being asked comes first.
- The user's preferences decide the outcome and they have not said which.`;

export const enterPlanModeTool: Tool = {
  name: "EnterPlanMode",
  displayName: "EnterPlanMode",
  description: `Ask to work in plan mode: investigate, then produce a plan the user approves before any code is written.

${ENTER_TRIGGERS}

Do not call this for a request that is already clear and small - a typo, a one-line fix, a rename, a question about the code, or a task the user explicitly asked to be done now. Those are cheaper to do than to plan.

In plan mode you may read everything and write documentation, but a write to code is refused and shell commands that could modify the project are limited. Write the plan to a documentation file, then call ExitPlanMode to hand it over for approval.`,
  parameters: {
    type: "object",
    properties: {},
  },
  readonly: false,
  isBuiltIn: true,
  run: async (): Promise<string> => {
    enterPlanProfile();
    return "Plan mode is on. Read what you need, write the plan to a documentation file (the decisions behind it and an ordered todo list), then call ExitPlanMode to hand it over for approval. Code cannot be modified while this is on.";
  },
};

export const exitPlanModeTool: Tool = {
  name: "ExitPlanMode",
  displayName: "ExitPlanMode",
  description: `Hand the finished plan over for approval and leave plan mode.

Call this once the plan is written and unambiguous. It does not carry the plan as an argument: the user reads the file you wrote. If part of the request is still unclear, ask about it first and call this only when the plan is ready to be judged.

Do not call this to answer a question or to report research. If no code was going to change, there was nothing to plan and this tool has nothing to approve.`,
  parameters: {
    type: "object",
    properties: {},
  },
  readonly: false,
  isBuiltIn: true,
  run: async (): Promise<string> => {
    exitPlanProfile();
    return "Plan mode is off and changes are allowed again. Once the user responds to the plan, carry it out.";
  },
};
