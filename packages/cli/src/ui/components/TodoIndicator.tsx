import type { DOMElement } from "ink";
import { Box, Text } from "ink";
import React, { useRef } from "react";

import { t } from "../../i18n/index.js";
import { readTodoState } from "../../tools/todo.js";
import { useClickRegion } from "../hooks/useClickRegion.js";
import { useTheme } from "../theme/tokens.js";
import { toggleTodoExpanded, useTodoExpanded } from "../todoFold.js";

const MAX_VISIBLE = 5;

interface TodoIndicatorProps {
  /** Number of open todo rows to show before collapsing into a summary row. */
  maxRows?: number;
}

/**
 * The todo list, rendered directly above the composer.
 *
 * A single vertical spine guides the eye from the header down the rows and
 * every row hangs off it with a short branch. Finished rows stay in place
 * with a checkmark until the whole plan is done - only then does the panel
 * disappear - so progress against the list stays readable while it runs.
 * Open rows past the budget collapse into one trailing summary line, and
 * clicking the header's arrow folds the rows away entirely, leaving the
 * counter - the same click-to-fold the tool panels use.
 */
const TodoIndicator: React.FC<TodoIndicatorProps> = ({
  maxRows = MAX_VISIBLE,
}) => {
  const { todos } = readTodoState();
  const theme = useTheme();
  const expanded = useTodoExpanded();
  const headerRef = useRef<DOMElement>(null);
  useClickRegion(headerRef, toggleTodoExpanded);

  if (todos.length === 0) {
    return null;
  }

  const done = todos.filter((todo) => todo.done);
  const open = todos.filter((todo) => !todo.done);

  if (open.length === 0) {
    return null;
  }

  const branch = (isLast: boolean): string => (isLast ? "└─" : "├─");
  const row = (todo: (typeof todos)[number], isLast: boolean) => (
    <Text key={todo.id}>
      <Text color={theme.text.subtle}>{branch(isLast)} </Text>
      {todo.done ? (
        <>
          <Text color={theme.status.success}>☑ </Text>
          <Text color={theme.text.subtle} strikethrough>
            {todo.text}
          </Text>
        </>
      ) : (
        <>
          <Text color={theme.text.secondary}>☐ </Text>
          {todo.text}
        </>
      )}
    </Text>
  );

  if (!expanded) {
    return (
      <Box flexDirection="column">
        <TodoHeader
          done={done.length}
          total={todos.length}
          expanded={false}
          headerRef={headerRef}
        />
      </Box>
    );
  }

  const visible = open.slice(0, Math.max(1, maxRows));
  const hidden = open.length - visible.length;
  const rows = [
    ...done.map((todo) => row(todo, false)),
    ...visible.map((todo, index) =>
      row(todo, hidden === 0 && index === visible.length - 1),
    ),
  ];

  return (
    <Box flexDirection="column">
      <TodoHeader
        done={done.length}
        total={todos.length}
        expanded={true}
        headerRef={headerRef}
      />
      {rows}
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

const TodoHeader: React.FC<{
  done: number;
  total: number;
  expanded: boolean;
  headerRef: React.RefObject<DOMElement | null>;
}> = ({ done, total, expanded, headerRef }) => {
  const theme = useTheme();
  return (
    <Box ref={headerRef} width="fit-content">
      <Text>
        <Text color={theme.accent} bold>
          TODO
        </Text>
        <Text color={theme.text.secondary}>
          {" · "}
          {done}/{total}
        </Text>
        <Text color={theme.text.subtle}>{expanded ? " ▾" : " ▸"}</Text>
      </Text>
    </Box>
  );
};

export { TodoIndicator };
