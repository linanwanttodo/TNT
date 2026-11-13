import type { ComponentProps } from "react";
import { useCallback, useMemo, useRef } from "react";

import type { Composer } from "../components/Composer.js";

type ComposerProps = ComponentProps<typeof Composer>;

/** The handlers the stable wrappers below read on every call. */
export interface ComposerHandlers {
  handleUserMessage: ComposerProps["handleUserMessage"];
  handleInterrupt: ComposerProps["handleInterrupt"];
  handleFileAttached: ComposerProps["handleFileAttached"];
  handleEditMessage: ComposerProps["handleEditMessage"];
  handleToolPermissionResponse: ComposerProps["handleToolPermissionResponse"];
  handleQuizAnswer: ComposerProps["handleQuizAnswer"];
  handleReload: ComposerProps["handleReload"];
  navigateTo: ComposerProps["navigateTo"];
  jumpToBottom: () => void;
}

/**
 * Stable wrappers for the callbacks the composer receives.
 *
 * Every streaming delta re-renders the terminal root. A prop that gets a fresh
 * closure per render would pull the input row back onto that path, and
 * keystrokes would queue behind the frame work. Each wrapper reads the latest
 * handler out of a ref, so its identity survives those renders while the call
 * still sees current state.
 */
export function useComposerCallbacks(handlers: ComposerHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;

  const submit = useCallback(
    (message: string, imageMap?: Map<string, Buffer>) => {
      // Sending always returns to the live tail, the way every reference CLI
      // resumes following when the user speaks.
      latest.current.jumpToBottom();
      void latest.current.handleUserMessage(message, imageMap);
    },
    [],
  );
  const interrupt = useCallback(() => {
    latest.current.handleInterrupt();
  }, []);
  const fileAttached = useCallback((filePath: string, content: string) => {
    latest.current.handleFileAttached(filePath, content);
  }, []);
  const editMessage = useCallback(
    (messageIndex: number, newContent: string) => {
      void latest.current.handleEditMessage(messageIndex, newContent);
    },
    [],
  );
  const toolPermission = useCallback<
    ComposerProps["handleToolPermissionResponse"]
  >((requestId, approved, createPolicy, stopStream, forSession) => {
    latest.current.handleToolPermissionResponse(
      requestId,
      approved,
      createPolicy,
      stopStream,
      forSession,
    );
  }, []);
  const quizAnswer = useCallback((requestId: string, answer: string) => {
    latest.current.handleQuizAnswer(requestId, answer);
  }, []);
  const reload = useCallback<ComposerProps["handleReload"]>(
    () => latest.current.handleReload(),
    [],
  );
  const openEditSelector = useCallback(
    () => latest.current.navigateTo("edit"),
    [],
  );
  const openAddModel = useCallback(
    () => latest.current.navigateTo("addModel"),
    [],
  );
  const openPalette = useCallback(
    () => latest.current.navigateTo("palette"),
    [],
  );
  const openJobs = useCallback(() => latest.current.navigateTo("jobs"), []);

  return useMemo(
    () => ({
      submit,
      interrupt,
      fileAttached,
      editMessage,
      toolPermission,
      quizAnswer,
      reload,
      openEditSelector,
      openAddModel,
      openPalette,
      openJobs,
    }),
    [
      submit,
      interrupt,
      fileAttached,
      editMessage,
      toolPermission,
      quizAnswer,
      reload,
      openEditSelector,
      openAddModel,
      openPalette,
      openJobs,
    ],
  );
}
