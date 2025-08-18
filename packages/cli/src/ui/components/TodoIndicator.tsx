import { Box, Text } from "ink";
import React from "react";

import { readTodoState } from "../../tools/todo.js";
import { t } from "../../i18n/index.js";

const MAX_VISIBLE = 5;

interface TodoIndicatorProps {
  /** Number of todo rows to show before collapsing into a counter. */
  maxRows?: number;
}

/**
 * Compact todo list rendered directly above the composer. Shows at most
 * maxRows entries and collapses the rest into a counter so the composer keeps
 * a predictable height while a long list is active.
 */
const TodoIndicator: React.FC<TodoIndicatorProps> = ({
  maxRows = MAX_VISIBLE,
}) => {
  const { todos } = readTodoState();

  if (todos.length === 0) {
    return null;
  }

  const done = todos.filter((todo) => todo.done).length;
  const visible = todos.slice(0, Math.max(1, maxRows));
  const hidden = todos.length - visible.length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray" dimColor>
          {t("tool.todosCount", { done, total: todos.length })}
        </Text>
      </Box>
      {visible.map((todo) => (
        <Box key={todo.id}>
          <Text color={todo.done ? "green" : "gray"}>
            {todo.done ? "✓" : "○"}{" "}
          </Text>
          <Text color={todo.done ? "gray" : undefined} dimColor={todo.done}>
            {todo.text}
          </Text>
        </Box>
      ))}
      {hidden > 0 && (
        <Box>
          <Text color="gray" dimColor>
            {`… ${hidden} more`}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export { TodoIndicator };
