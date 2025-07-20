import { ChatMessage, Tool } from "..";
import { renderChatMessage } from "./messageContent.js";

/**
 * Prompt caching only pays off while the prefix of a request stays byte
 * identical between turns. Anything that changes the system message or the
 * tool definitions invalidates the cached prefix for the whole conversation,
 * and the change is usually invisible: it comes from a reordered tool list or
 * a slightly different system prompt rather than from the user's message.
 *
 * This module fingerprints the stable parts of a request so a caller can tell
 * that the prefix changed and log which part of it moved.
 */

/** djb2, chosen for being small and dependency-free; not a security hash. */
export function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return hash;
}

export interface CacheFingerprint {
  systemHash: number;
  toolsHash: number;
  model: string;
  toolNames: string[];
  perToolHashes: Record<string, number>;
}

export function buildCacheFingerprint(
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  model: string,
): CacheFingerprint {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => renderChatMessage(message))
    .join("\n");

  const toolList = tools ?? [];
  const toolNames = toolList.map((tool) => tool.function.name);
  const perToolHashes: Record<string, number> = {};
  for (const tool of toolList) {
    perToolHashes[tool.function.name] = hashString(
      `${tool.function.description ?? ""}|${JSON.stringify(tool.function.parameters ?? {})}`,
    );
  }

  return {
    systemHash: hashString(systemText),
    // The order of the tool list matters to the provider, so fold it in.
    toolsHash: hashString(
      toolList
        .map(
          (tool) =>
            `${tool.function.name}:${perToolHashes[tool.function.name]}`,
        )
        .join(","),
    ),
    model,
    toolNames,
    perToolHashes,
  };
}

export interface CacheBreak {
  reason: "system_prompt" | "tools" | "model";
  /** Tools whose definitions changed, when the break came from the tools. */
  changedTools?: string[];
}

/**
 * Compares two fingerprints and reports why the cached prefix was invalidated.
 * Returns null when the prefix is unchanged, which is the common case.
 */
export function detectCacheBreak(
  previous: CacheFingerprint | undefined,
  current: CacheFingerprint,
): CacheBreak | null {
  if (!previous) {
    return null;
  }
  if (previous.model !== current.model) {
    return { reason: "model" };
  }
  if (previous.systemHash !== current.systemHash) {
    return { reason: "system_prompt" };
  }
  if (previous.toolsHash !== current.toolsHash) {
    const changedTools = Object.keys(current.perToolHashes).filter(
      (name) => previous.perToolHashes[name] !== current.perToolHashes[name],
    );
    return { reason: "tools", changedTools };
  }
  return null;
}
