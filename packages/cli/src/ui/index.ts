import { render, RenderOptions } from "ink";
import React from "react";

import { t } from "../i18n/index.js";
import { enableSigintHandler, setTUIUnmount } from "../index.js";
import { PermissionMode } from "../permissions/types.js";
import { initializeServices } from "../services/index.js";
import { ServiceContainerProvider } from "../services/ServiceContainerContext.js";
import { isHeadlessMode, isTTYless } from "../utils/cli.js";
import { logger } from "../utils/logger.js";

import { AppRoot } from "./AppRoot.js";
import {
  enterAlternateScreen,
  leaveAlternateScreen,
} from "./utils/terminalScreen.js";

export { MarkdownRenderer } from "./MarkdownRenderer.js";

export interface StartTUIChatOptions {
  initialPrompt?: string;
  resume?: boolean;
  /** Specific session a resume should open; omitted means the newest root. */
  sessionId?: string;
  fork?: string;
  /** Model rounds allowed per turn before the turn is cut short. */
  maxSteps?: number;
  config?: string;
  org?: string;
  rule?: string[];
  prompt?: string[];
  toolPermissionOverrides?: {
    allow?: string[];
    ask?: string[];
    exclude?: string[];
    mode?: PermissionMode;
  };
  skipOnboarding?: boolean;
}

export async function startTUIChat(
  options: StartTUIChatOptions & { customStdin?: NodeJS.ReadStream },
) {
  const {
    initialPrompt,
    resume,
    sessionId,
    fork,
    maxSteps,
    config,
    org,
    rule,
    prompt,
    toolPermissionOverrides,
    skipOnboarding,
    customStdin,
  } = options;

  // Critical safeguard: Prevent TUI initialization in headless mode
  if (isHeadlessMode()) {
    throw new Error(
      "Cannot start TUI in headless mode. This is a programming error - " +
        "startTUIChat should not be called when -p/--print flag is used.",
    );
  }

  // Critical safeguard: Prevent TUI initialization in TTY-less environment
  if (isTTYless() && !customStdin) {
    throw new Error(t("ui.ttyLess"));
  }

  // Initialize services only if not already done (skipOnboarding means already initialized)
  if (!skipOnboarding) {
    await initializeServices({
      options: { config, org, rule, prompt },
      headless: false,
      toolPermissionOverrides,
    });
  }

  // Validate stdin is available and suitable for Ink
  const stdinToUse = customStdin || process.stdin;

  // Test raw mode capability (required by Ink)
  if (
    stdinToUse.isTTY &&
    typeof (stdinToUse as any).setRawMode === "function"
  ) {
    try {
      // Test that we can enter raw mode (Ink requirement)
      (stdinToUse as any).setRawMode(true);
      (stdinToUse as any).setRawMode(false);
      logger.debug("Raw mode test passed - TTY is suitable for Ink");
    } catch {
      throw new Error(t("ui.rawModeRequired"));
    }
  } else if (!customStdin) {
    logger.warn("stdin is not a TTY or does not support setRawMode");
  }

  // Start the TUI immediately - it will handle loading states
  const renderOptions: RenderOptions = {
    exitOnCtrlC: false, // Disable Ink's default Ctrl+C handling so we can implement two-stage exit
    stdin: stdinToUse,
    stdout: process.stdout,
    stderr: process.stderr,
  };

  enterAlternateScreen();
  const { unmount } = render(
    React.createElement(ServiceContainerProvider, {
      children: React.createElement(AppRoot, {
        configPath: config,
        initialPrompt,
        resume,
        sessionId,
        fork,
        maxSteps,
        additionalRules: rule,
        additionalPrompts: prompt,
      }),
    }),
    renderOptions,
  );

  // Leaving the alternate buffer is part of teardown, not an afterthought: the
  // shell prompt must come back on the normal screen even when the app exits
  // through the two-stage Ctrl+C path.
  const restoreAndUnmount = () => {
    unmount();
    leaveAlternateScreen();
  };

  // Register unmount function with main process for two-stage Ctrl+C exit
  setTUIUnmount(restoreAndUnmount);

  // Enable the two-stage SIGINT handler for TUI mode
  enableSigintHandler();

  return { unmount: restoreAndUnmount };
}

export async function startRemoteTUIChat(
  remoteUrl: string,
  initialPrompt?: string,
) {
  // Critical safeguard: Prevent TUI initialization in TTY-less environment
  if (isTTYless()) {
    throw new Error(t("ui.remoteTtyLess"));
  }

  // Test raw mode capability for remote TUI
  if (
    process.stdin.isTTY &&
    typeof (process.stdin as any).setRawMode === "function"
  ) {
    try {
      (process.stdin as any).setRawMode(true);
      (process.stdin as any).setRawMode(false);
      logger.debug("Raw mode test passed for remote TUI");
    } catch {
      throw new Error(t("ui.remoteRawMode"));
    }
  }

  // Start the TUI in remote mode - no services needed
  enterAlternateScreen();
  const { unmount } = render(
    React.createElement(ServiceContainerProvider, {
      children: React.createElement(AppRoot, {
        remoteUrl,
        initialPrompt,
      }),
    }),
    {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );

  const restoreAndUnmount = () => {
    unmount();
    leaveAlternateScreen();
  };

  // Register unmount function with main process for two-stage Ctrl+C exit
  setTUIUnmount(restoreAndUnmount);

  return { unmount: restoreAndUnmount };
}
