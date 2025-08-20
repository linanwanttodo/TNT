import type {
  CommandLoadContext,
  CommandLoader,
  SlashCommand,
} from "../types.js";

interface InvokableRule {
  invokable?: boolean;
  name?: string;
  description?: string;
}

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

/** Rules marked `invokable: true` become assistant commands. */
export class InvokableRuleLoader implements CommandLoader {
  readonly source = "rule" as const;

  async loadCommands({
    assistant,
  }: CommandLoadContext): Promise<SlashCommand[]> {
    const rules = assistant?.rules ?? [];

    return rules.flatMap((rule) => {
      if (!rule || typeof rule === "string") {
        return [];
      }

      const invokableRule = rule as InvokableRule;
      if (invokableRule.invokable !== true || !invokableRule.name) {
        return [];
      }

      return [
        {
          name: invokableRule.name,
          description: invokableRule.description || "",
          category: "assistant" as const,
        },
      ];
    });
  }
}
