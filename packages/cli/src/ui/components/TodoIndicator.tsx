import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { readTodoState } from "../../tools/todo.js";

const MAX_VISIBLE = 5;

interface TodoIndicatorProps {
  /** Number of todo rows to show before collapsing into a counter. */
  maxRows?: number;
}

/**
 * Compact list of what is still left, rendered directly above the composer.
 * Only unfinished rows are drawn, at most maxRows of them; the rest travel as a
 * counter on the header so a long list cannot push the composer upward.
 */
const TodoIndicator: React.FC<TodoIndicatorProps> = ({
  maxRows = MAX_VISIBLE,
}) => {
  const { todos } = readTodoState();
  const unfinished = todos.filter((todo) => !todo.done);

  if (unfinished.length === 0) {
    return null;
  }

  const done = todos.length - unfinished.length;
  const visible = unfinished.slice(0, Math.max(1, maxRows));
  const hidden = unfinished.length - visible.length;
  const count = t("tool.todosCount", { done, total: todos.length });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray" dimColor>
          {hidden > 0 ? `${count} · +${hidden}` : count}
        </Text>
      </Box>
      {visible.map((todo) => (
        <Box key={todo.id}>
          <Text color="gray">○ </Text>
          <Text>{todo.text}</Text>
        </Box>
      ))}
    </Box>
  );
};

export { TodoIndicator };
