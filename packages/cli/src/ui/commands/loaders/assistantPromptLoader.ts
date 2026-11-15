import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

/** Prompts declared in the assistant config become assistant commands. */
export class AssistantPromptLoader implements CommandLoader {
  readonly source = "prompt" as const;

  async loadCommands({
    assistant,
  }: CommandLoadContext): Promise<SlashCommand[]> {
    return (assistant?.prompts ?? [])
      .filter((prompt): prompt is NonNullable<typeof prompt> =>
        Boolean(prompt?.name),
      )
      .map((prompt) => ({
        name: prompt.name,
        description: prompt.description || "",
        category: "assistant" as const,
      }));
  }
}
