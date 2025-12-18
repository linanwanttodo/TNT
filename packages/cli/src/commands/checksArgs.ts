export type ChecksAction = "list" | "accept" | "reject";

export interface ChecksArguments {
  action: ChecksAction;
  prUrl: string | undefined;
}

/**
 * `tnt checks` takes an optional action followed by an optional PR URL, and an action has to
 * be one of the three the command implements - `list` included, because the switch handles it
 * but no input used to reach it. Anything else in the first slot is a PR URL.
 */
export function classifyChecksArgument(
  actionOrUrl: string | undefined,
  prUrlArg: string | undefined,
): ChecksArguments {
  if (
    actionOrUrl === "list" ||
    actionOrUrl === "accept" ||
    actionOrUrl === "reject"
  ) {
    return { action: actionOrUrl, prUrl: prUrlArg };
  }
  if (actionOrUrl) {
    return { action: "list", prUrl: actionOrUrl };
  }
  return { action: "list", prUrl: prUrlArg };
}
