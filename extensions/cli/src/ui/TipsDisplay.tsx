import { Box, Text } from "ink";
import React, { useMemo } from "react";

import { t } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/index.js";

const TIP_KEYS: TranslationKey[] = [
  "tip.shortcuts",
  "tip.pause",
  "tip.history",
  "tip.multiline",
  "tip.resume",
  "tip.headless",
  "tip.init",
];

interface TipsDisplayProps {
  // No props needed - component handles its own randomization
}

const TipsDisplay: React.FC<TipsDisplayProps> = () => {
  const randomTip = useMemo(
    () => t(TIP_KEYS[Math.floor(Math.random() * TIP_KEYS.length)]),
    [],
  );

  return (
    <Box flexDirection="row" paddingX={1} paddingBottom={1}>
      <Text color="green" bold>
        * {t("tip.label")}:
      </Text>
      <Text color="dim" italic>
        {" "}
        {randomTip}
      </Text>
      <Text> </Text>
    </Box>
  );
};

export function shouldShowTip(): boolean {
  return Math.random() < 0.2;
}

export { TipsDisplay, TIP_KEYS };
