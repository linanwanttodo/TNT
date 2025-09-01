import React from "react";

import { NavigationProvider } from "./context/NavigationContext.js";
import { TUIChat } from "./TUIChat.js";

interface AppRootProps {
  remoteUrl?: string;
  configPath?: string;
  initialPrompt?: string;
  resume?: boolean;
  /** Specific session a resume should open; omitted means the newest root. */
  sessionId?: string;
  fork?: string;
  /** Model rounds allowed per turn before the turn is cut short. */
  maxSteps?: number;
  additionalRules?: string[];
  additionalPrompts?: string[];
}

/**
 * Root component that wraps TUIChat with all necessary providers
 * This is the main entry point for the UI application
 */
export const AppRoot: React.FC<AppRootProps> = (props) => {
  return (
    <NavigationProvider>
      <TUIChat {...props} />
    </NavigationProvider>
  );
};
