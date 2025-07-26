import { Text } from "ink";
import React from "react";

import { getSessionGoal } from "../../session.js";

const MAX_VISIBLE_CHARS = 80;
const ELLIPSIS = "...";

/**
 * Single line above the composer showing the session goal. Long goals are
 * truncated in the middle so the leading intent stays readable in a narrow
 * terminal.
 */
export function truncateGoal(goal: string, maxChars = MAX_VISIBLE_CHARS) {
  const collapsed = goal.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  const budget = Math.max(1, maxChars - ELLIPSIS.length);
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${collapsed.slice(0, head)}${ELLIPSIS}${collapsed.slice(
    collapsed.length - tail,
  )}`;
}

const GoalIndicator: React.FC = () => {
  const goal = getSessionGoal();

  if (!goal) {
    return null;
  }

  return (
    <Text wrap="truncate-end">
      <Text color="blue" bold>
        {"Goal: "}
      </Text>
      <Text color="gray" dimColor>
        {truncateGoal(goal)}
      </Text>
    </Text>
  );
};

export { GoalIndicator };
