import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";
import { readTodoState } from "../../tools/todo.js";
import { useTheme } from "../theme/tokens.js";

const MAX_VISIBLE = 5;

interface TodoIndicatorProps {
  /** Number of open todo rows to show before collapsing into a summary row. */
  maxRows?: number;
}

/**
 * The open todo list, rendered directly above the composer.
 *
 * A single vertical spine guides the eye from the header down the rows and
 * every row hangs off it with a short branch. Finished rows hide themselves -
 * the header keeps their count so progress against the whole plan stays
 * readable - and open rows past the budget collapse into one trailing summary
 * line, so a long list cannot push the composer upward.
 */
const TodoIndicator: React.FC<TodoIndicatorProps> = ({
  maxRows = MAX_VISIBLE,
}) => {
  const { todos } = readTodoState();
  const theme = useTheme();

  const open = todos.filter((todo) => !todo.done);
  const done = todos.length - open.length;

  if (open.length === 0) {
    return null;
  }

  const visible = open.slice(0, Math.max(1, maxRows));
  const hidden = open.length - visible.length;
  const branch = (isLast: boolean): string => (isLast ? "└─" : "├─");

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={theme.accent} bold>
          TODO
        </Text>
        <Text color={theme.text.secondary}>
          {" · "}
          {done}/{todos.length}
        </Text>
      </Text>
      {visible.map((todo, index) => {
        const isLast = hidden === 0 && index === visible.length - 1;
        return (
          <Text key={todo.id}>
            <Text color={theme.text.subtle}>{branch(isLast)} </Text>
            <Text color={theme.text.secondary}>☐ </Text>
            {todo.text}
          </Text>
        );
      })}
      {hidden > 0 && (
        <Text>
          <Text color={theme.text.subtle}>└─ </Text>
          <Text color={theme.text.secondary}>
            {t("ui.todoMore", { count: hidden })}
          </Text>
        </Text>
      )}
    </Box>
  );
};

export { TodoIndicator };
