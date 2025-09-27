import { services } from "../services/index.js";
import { setSessionPromptProfile } from "../session/index.js";

/**
 * Plan is the one profile with a permission twin, so the two axes move together
 * here rather than in each caller: a plan that could still write code is not the
 * plan the user asked for.
 *
 * This lives outside the profile text module on purpose: that module is read
 * while the system message is assembled, and pulling the service container into
 * that path would put it in a cycle with the message service itself.
 */
export function enterPlanProfile(): void {
  setSessionPromptProfile("plan");
  try {
    services.toolPermissions.switchMode("plan");
  } catch {
    // A missing permission service must not cost the user the profile.
  }
}

/** Leave plan: changes are allowed again and the profile goes back to default. */
export function exitPlanProfile(): void {
  try {
    services.toolPermissions.switchMode("agent");
  } catch {
    // A missing permission service must not strand the session in plan mode.
  }
  setSessionPromptProfile(undefined);
}
