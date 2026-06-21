import { z } from "zod";

// 精简自 ZCode packages/shared/src/zcode-protocol-v4/rows.ts：
// conversation-preview-artifacts.ts 只用到这一个 enum，无需整条协议链。
export const conversationArtifactTypeSchema = z.enum([
  "pdf",
  "pptx",
  "docx",
  "xlsx",
  "image",
  "html",
  "md",
  "text",
]);
export type ConversationArtifactType = z.infer<
  typeof conversationArtifactTypeSchema
>;
