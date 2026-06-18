// TNT webui 的极简 i18n 适配层：保持 ZCode 组件里的
// `intl.formatMessage({ id })` 调用形状不变，只是把文案表换成这里。
// 文案逐字取自 ZCode `src/i18n/locales/en-US.ts` / `zh-CN.ts`。

type MessageDescriptor = { id: string };
export type IntlInstance = {
  formatMessage: (
    descriptor: MessageDescriptor,
    values?: Record<string, string | number>,
  ) => string;
};

function interpolate(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template;
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

const enUS: Record<string, string> = {
  "common.loading": "Loading...",
  "chat.loading.working": "Working",
  "chat.history.duration.day": "d",
  "chat.history.duration.hour": "h",
  "chat.history.duration.minute": "m",
  "chat.history.duration.second": "s",
  "workspaceSidebar.toggleSidebar": "Toggle sidebar",
  "sidebar.newTask": "New task",
  "taskNav.back": "Go back",
  "taskNav.forward": "Go forward",
  "chat.message.expand": "Expand",
  "chat.message.collapse": "Collapse",
  "chat.message.copy": "Copy",
  "chat.message.copy.copied": "Copied",
  "chat.reasoning.thinking": "Thinking",
  "chat.reasoning.thought": "Thought",
  "chat.reasoning.durationFewSeconds": "a few seconds",
  "chat.reasoning.durationSeconds": "{seconds} seconds",
  "chat.error.dismiss": "Dismiss error",
  "chat.error.retry": "Retry",
  "chat.error.copyFull": "Copy",
  "chat.error.copyFull.copied": "Full error details copied",
  "chat.error.copyFailed": "Failed to copy error details: {error}",
  "chat.error.expandDetails": "Show details",
  "chat.error.collapseDetails": "Hide details",
  "modelTrajectory.empty":
    "No model calls recorded (only ZCode Agent writes model-io)",
  "modelTrajectory.inputSection": "Input",
  "modelTrajectory.outputSection": "Output",
  "modelTrajectory.reasoning": "Reasoning",
  "modelTrajectory.message": "Message",
  "modelTrajectory.toolCall": "Tool call",
  "modelTrajectory.toolInput": "Input",
  "modelTrajectory.toolOutput": "Output",
  "modelTrajectory.toolResult": "Tool result",
  "modelTrajectory.role.system": "System",
  "modelTrajectory.role.user": "User",
  "modelTrajectory.role.assistant": "Assistant",
  "modelTrajectory.role.tool": "Tool result",
  "modelTrajectory.finish.stop": "Stopped",
  "modelTrajectory.finish.toolCalls": "Tool call",
  "modelTrajectory.finish.length": "Length limit",
  "modelTrajectory.finish.contentFilter": "Content filtered",
  "modelTrajectory.source.main": "Main session",
  "modelTrajectory.source.subagent": "Subagent",
  "modelTrajectory.source.unknown": "Unknown source",
};

const zhCN: Record<string, string> = {
  "common.loading": "加载中...",
  "chat.loading.working": "工作中",
  "chat.history.duration.day": "天",
  "chat.history.duration.hour": "时",
  "chat.history.duration.minute": "分",
  "chat.history.duration.second": "秒",
  "workspaceSidebar.toggleSidebar": "切换侧边栏",
  "sidebar.newTask": "新建任务",
  "taskNav.back": "后退",
  "taskNav.forward": "前进",
  "chat.message.expand": "展开",
  "chat.message.collapse": "收起",
  "chat.message.copy": "复制",
  "chat.message.copy.copied": "已复制",
  "chat.reasoning.thinking": "正在思考",
  "chat.reasoning.thought": "思考",
  "chat.reasoning.durationFewSeconds": "持续了几秒",
  "chat.reasoning.durationSeconds": "持续了 {seconds} 秒",
  "chat.error.dismiss": "关闭错误提示",
  "chat.error.retry": "重试",
  "chat.error.copyFull": "复制",
  "chat.error.copyFull.copied": "已复制完整报错信息",
  "chat.error.copyFailed": "复制报错信息失败：{error}",
  "chat.error.expandDetails": "展开详情",
  "chat.error.collapseDetails": "收起详情",
  "modelTrajectory.empty": "暂无模型调用记录（仅 ZCode Agent 会落盘 model-io）",
  "modelTrajectory.inputSection": "输入",
  "modelTrajectory.outputSection": "输出",
  "modelTrajectory.reasoning": "思考过程",
  "modelTrajectory.message": "消息",
  "modelTrajectory.toolCall": "工具调用",
  "modelTrajectory.toolInput": "输入",
  "modelTrajectory.toolOutput": "输出",
  "modelTrajectory.toolResult": "工具结果",
  "modelTrajectory.role.system": "系统提示词",
  "modelTrajectory.role.user": "用户消息",
  "modelTrajectory.role.assistant": "助手消息",
  "modelTrajectory.role.tool": "工具结果",
  "modelTrajectory.finish.stop": "正常结束",
  "modelTrajectory.finish.toolCalls": "工具调用",
  "modelTrajectory.finish.length": "达到长度限制",
  "modelTrajectory.finish.contentFilter": "内容过滤",
  "modelTrajectory.source.main": "主会话",
  "modelTrajectory.source.subagent": "子智能体",
  "modelTrajectory.source.unknown": "未知来源",
};

function resolveLocale(): string {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function useZCodeIntl() {
  const locale = resolveLocale();
  const messages = locale === "zh-CN" ? zhCN : enUS;
  return {
    locale,
    intl: {
      formatMessage: (
        descriptor: MessageDescriptor,
        values?: Record<string, string | number>,
      ): string =>
        interpolate(messages[descriptor.id] ?? descriptor.id, values),
    },
  } as const;
}
