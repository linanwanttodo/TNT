/*
 * TNT 桥：`ai` 包 UIMessage 类型的本地替身。
 * message.tsx 只消费 role 字段，无需安装 Vercel AI SDK。
 */
export type UIMessage = {
  role: "user" | "assistant" | "system";
  parts?: Array<{ type: string; [key: string]: unknown }>;
  [key: string]: unknown;
};
