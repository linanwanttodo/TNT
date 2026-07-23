import { Box, Text } from "ink";
import React, { useEffect, useRef, useState } from "react";

import { t } from "../../i18n/index.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import type { TurnProgress } from "../hooks/useTurnProgress.js";
import { LoadingAnimation } from "../LoadingAnimation.js";
import { useTheme } from "../theme/tokens.js";
import { Timer } from "../Timer.js";
import { compactTokenCount } from "../utils/contextUsageLine.js";
import { sanitizeTerminalText } from "../utils/terminalTextSafety.js";

/** The counter stays hidden until a turn has run this long. */
export const SHOW_TOKEN_COUNT_AFTER_MS = 30_000;

/** No new output for this long turns the spinner and message red. */
export const STALL_THRESHOLD_MS = 3_000;

/** How often the stall clock samples; the spinner paints independently. */
const STATUS_CLOCK_MS = 500;

/**
 * A short turn is still finding its shape; the token count would only be noise.
 * Once it has run for the threshold - or the reader asked for verbose output -
 * the count is worth the row space.
 */
export function shouldShowTokenCount(input: {
  elapsedMs: number;
  verbose?: boolean;
  tokenCount?: number;
}): boolean {
  // The bracket is the consumption readout while the turn streams, so the
  // counter shows as soon as the stream has produced anything.
  return input.tokenCount !== undefined && input.tokenCount > 0;
}

/**
 * Output has stopped arriving. A running tool is not a stall: its own row still
 * moves, so the spinner must not accuse it of being stuck.
 */
export function isOutputStalled(input: {
  now: number;
  lastOutputAt: number;
  tokenCount?: number;
  hasActiveTools?: boolean;
}): boolean {
  if (input.hasActiveTools || input.tokenCount === undefined) return false;
  return input.now - input.lastOutputAt >= STALL_THRESHOLD_MS;
}

/** Stalled output paints both the glyph and the message red. */
export function statusColors(input: {
  stalled: boolean;
  messageColor: string;
  loadingColor: string;
}): { message: string; spinner: string } {
  return input.stalled
    ? { message: "red", spinner: "red" }
    : { message: input.messageColor, spinner: input.loadingColor };
}

interface ActionStatusProps {
  visible: boolean;
  startTime: number;
  message: string;
  showSpinner?: boolean;
  color?: string;
  loadingColor?: string;
  /** The cancel hint sits first in the bracket, gemini style. */
  cancelHint?: string;
  additionalHint?: string;
  /** Tokens produced this turn, when the caller knows them. */
  tokenCount?: number;
  /** Approximate output token rate while streaming. */
  tokenRate?: number;
  /**
   * What the turn has done so far: tool calls, provider rounds and the token
   * ledger. Rendered live in the bracket; the footer keeps only cache and
   * context.
   */
  turnProgress?: TurnProgress;
  /** Shows the counter before the 30 s gate, for verbose sessions. */
  verbose?: boolean;
  /** A running tool explains silence; it must not read as a stall. */
  hasActiveTools?: boolean;
}

/**
 * The bracket's turn-consumption group: this turn's input, output and cache
 * share. A narrow terminal keeps only the output count, because the row cannot
 * wrap without moving the composer.
 */
export function turnConsumptionLabel(
  progress: TurnProgress | undefined,
  options: { compact: boolean; cacheLabel: string },
): string | undefined {
  if (!progress) return undefined;
  const parts: string[] = [];
  if (!options.compact && progress.inputTokens > 0) {
    parts.push(`↑${compactTokenCount(progress.inputTokens)}`);
  }
  if (progress.outputTokens > 0) {
    parts.push(`↓${compactTokenCount(progress.outputTokens)}`);
  }
  if (progress.cacheRate !== undefined && progress.cacheRate > 0) {
    parts.push(
      `${options.cacheLabel} ${(progress.cacheRate * 100).toFixed(0)}%`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

const ActionStatus: React.FC<ActionStatusProps> = ({
  visible,
  startTime,
  message,
  showSpinner = false,
  color = "dim",
  loadingColor: _loadingColor = "green",
  cancelHint,
  additionalHint,
  tokenCount,
  tokenRate,
  turnProgress,
  verbose = false,
  hasActiveTools = false,
}) => {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const [now, setNow] = useState(() => Date.now());
  const lastOutputAt = useRef(startTime);
  const lastTokenCount = useRef(tokenCount);
  const trackedStart = useRef(startTime);

  // A new turn reuses this component; its clock and token baseline start over.
  useEffect(() => {
    if (trackedStart.current === startTime) return;
    trackedStart.current = startTime;
    lastOutputAt.current = Date.now();
    lastTokenCount.current = tokenCount;
  }, [startTime, tokenCount]);

  useEffect(() => {
    if (tokenCount === undefined || tokenCount === lastTokenCount.current) {
      return;
    }
    lastTokenCount.current = tokenCount;
    lastOutputAt.current = Date.now();
  }, [tokenCount]);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), STATUS_CLOCK_MS);
    return () => clearInterval(interval);
  }, [visible, startTime]);

  if (!visible) return null;

  const elapsedMs = Math.max(0, now - startTime);
  const stalled = isOutputStalled({
    now,
    lastOutputAt: lastOutputAt.current,
    tokenCount,
    hasActiveTools,
  });
  // The status row keeps the theme's calm accent while it thinks. A long
  // round is reported by the timer in the bracket, not by painting the row
  // red: red reads as an error where nothing has failed.
  const colors = {
    message: stalled ? color : theme.accent,
    spinner: theme.accent,
  };
  const tokenLabel = shouldShowTokenCount({ elapsedMs, verbose, tokenCount })
    ? `↓ ${compactTokenCount(tokenCount ?? 0)} tokens`
    : null;
  const speedLabel =
    tokenRate && tokenRate > 0 ? `~${Math.round(tokenRate)} tok/s` : null;
  const consumptionLabel = turnConsumptionLabel(turnProgress, {
    compact: columns < 100,
    cacheLabel: t("status.cache"),
  });
  const toolLabel =
    turnProgress && turnProgress.toolCalls > 0
      ? `${turnProgress.toolCalls} ${t("status.tools")}`
      : null;
  const stepLabel =
    turnProgress && turnProgress.steps > 0
      ? `${turnProgress.steps} ${t("status.steps")}`
      : null;
  // The turn ledger replaces the bare output counter once it exists.
  const tokenGroup = consumptionLabel ?? tokenLabel;

  return (
    <Box paddingX={1} flexDirection="row" gap={1}>
      {showSpinner && (
        <LoadingAnimation color={colors.spinner} visible={true} />
      )}
      <Text color={colors.message} italic>
        {sanitizeTerminalText(message)}
      </Text>
      {(cancelHint || tokenGroup || additionalHint) && (
        <>
          <Text color="dim">(</Text>
          {cancelHint && (
            <>
              <Text color="dim">{sanitizeTerminalText(cancelHint)}</Text>
              <Text color="dim">,</Text>
            </>
          )}
          <Timer startTime={startTime} />
          {speedLabel && (
            <>
              <Text color="dim">·</Text>
              <Text color="dim">{speedLabel}</Text>
            </>
          )}
          {toolLabel && (
            <>
              <Text color="dim">·</Text>
              <Text color="dim">{toolLabel}</Text>
            </>
          )}
          {stepLabel && (
            <>
              <Text color="dim">·</Text>
              <Text color="dim">{stepLabel}</Text>
            </>
          )}
          {tokenGroup && (
            <>
              <Text color="dim">·</Text>
              <Text color="dim">{tokenGroup}</Text>
            </>
          )}
          {additionalHint && (
            <>
              <Text color="dim">·</Text>
              <Text color="dim">{sanitizeTerminalText(additionalHint)}</Text>
            </>
          )}
          <Text color="dim">)</Text>
        </>
      )}
    </Box>
  );
};

export { ActionStatus };
