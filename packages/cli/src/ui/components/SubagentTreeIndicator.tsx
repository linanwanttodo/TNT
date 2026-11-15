import React from "react";

import {
  currentSessionIdSafe,
  useSubagentTree,
} from "../hooks/useSubagentTree.js";

import { SubagentTree } from "./SubagentTree.js";

interface SubagentTreeIndicatorProps {
  /** Defaults to the session the compositor currently owns. */
  parentSessionId?: string;
  /** False once the parent turn ends, which folds finished agents. */
  active?: boolean;
}

/**
 * The live delegated-agent tree under the composer. Kept separate from the
 * presentation so fixture states render without the event bus.
 */
const SubagentTreeIndicator: React.FC<SubagentTreeIndicatorProps> = ({
  parentSessionId,
  active = true,
}) => {
  const resolvedParent = parentSessionId ?? currentSessionIdSafe();
  const entries = useSubagentTree({ parentSessionId: resolvedParent });
  return <SubagentTree entries={entries} active={active} />;
};

export { SubagentTreeIndicator };
