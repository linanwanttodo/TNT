// TNT webui 的极简 i18n 适配层：保持 ZCode 组件里的
// `intl.formatMessage({ id })` 调用形状不变，只是把文案表换成这里。
// 文案逐字取自 ZCode `src/i18n/locales/en-US.ts` / `zh-CN.ts`。

type MessageDescriptor = { id: string };

const enUS: Record<string, string> = {
  "common.loading": "Loading...",
  "chat.loading.working": "Working",
  "chat.history.duration.day": "d",
  "chat.history.duration.hour": "h",
  "chat.history.duration.minute": "m",
  "chat.history.duration.second": "s",
};

const zhCN: Record<string, string> = {
  "common.loading": "加载中...",
  "chat.loading.working": "工作中",
  "chat.history.duration.day": "天",
  "chat.history.duration.hour": "时",
  "chat.history.duration.minute": "分",
  "chat.history.duration.second": "秒",
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
      formatMessage: (descriptor: MessageDescriptor): string =>
        messages[descriptor.id] ?? descriptor.id,
    },
  } as const;
}
