import { Box, Text } from "ink";
import React from "react";

import { t } from "../../i18n/index.js";

interface SubagentBreadcrumbProps {
  /** Delegated agent that owns the currently open transcript. */
  subagentType: string;
  /** Session the delegated run was spawned from. */
  parentSessionId: string;
}

/**
 * Header for a delegated transcript. Names the agent and the parent session,
 * and points to the parent messaging tool used to resume the child.
 */
const SubagentBreadcrumb: React.FC<SubagentBreadcrumbProps> = ({
  subagentType,
  parentSessionId,
}) => {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color="blue" bold>
          {t("subagent.breadcrumb", { type: subagentType })}
        </Text>
        <Text color="gray" dimColor>
          {`  ${parentSessionId}`}
        </Text>
      </Text>
      <Text color="gray" dimColor>
        {t("subagent.readOnly")}
      </Text>
    </Box>
  );
};

export { SubagentBreadcrumb };
