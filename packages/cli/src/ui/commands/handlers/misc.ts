import chalk from "chalk";

import { readTodoState } from "../../../tools/todo.js";
import type { SlashCommandResult } from "../types.js";

export function handleJobs(): SlashCommandResult {
  return { openJobsSelector: true };
}

export function handleTodos(): SlashCommandResult {
  const { todos } = readTodoState();

  if (todos.length === 0) {
    return { output: chalk.dim("No todos yet.") };
  }

  const done = todos.filter((todo) => todo.done).length;
  const lines = todos.map((todo) => {
    const mark = todo.done ? chalk.green("✓") : chalk.dim("○");
    const id = chalk.cyan(`#${todo.id}`);
    const text = todo.done ? chalk.dim(todo.text) : todo.text;
    return `  ${mark} ${id} ${text}`;
  });

  return {
    output: [
      chalk.bold(`Todos (${done}/${todos.length} completed)`),
      "",
      ...lines,
    ].join("\n"),
  };
}
