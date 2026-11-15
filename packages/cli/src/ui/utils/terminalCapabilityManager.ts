/**
 * Port of gemini-cli's terminalCapabilityManager, trimmed to the probes TNT
 * uses: kitty keyboard, terminal name, modifyOtherKeys, and the
 * ambiguous-width probe whose answer drives the anti-ghosting width fix. The
 * background-colour query is not duplicated here; TNT's theme probe (OSC 11
 * in terminalAppearance.ts) already owns it.
 */

import * as fs from "node:fs";

import { logger } from "../../utils/logger.js";

import {
  disableBracketedPasteMode,
  disableKittyKeyboardProtocol,
  disableModifyOtherKeys,
  enableBracketedPasteMode,
  enableKittyKeyboardProtocol,
  enableLineWrapping,
  enableModifyOtherKeys,
} from "./terminalModes.js";

const ESC = "\x1b";

// Resets every terminal mode the CLI may have switched on, in one synchronous
// write, so that abrupt exits do not leave the user's shell in a broken
// state. Auto-wrap (DECAWM, `?7h`) is restored last because it is turned off
// in the alternate buffer and on terminals that render ambiguous-width
// characters as wide.
const TERMINAL_CLEANUP_SEQUENCE =
  "\x1b[<u\x1b[>4;0m\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?7h";

export function cleanupTerminalOnExit(): void {
  try {
    if (process.stdout.isTTY) {
      fs.writeSync(process.stdout.fd, TERMINAL_CLEANUP_SEQUENCE);
    }
  } catch {
    // The stream may already be gone during teardown.
  }
  disableModifyOtherKeys();
  disableBracketedPasteMode();
  disableKittyKeyboardProtocol();
  enableLineWrapping();
}

export type TerminalName = string | undefined;

// Kitty keyboard protocol availability: CSI > u flags reply.
// eslint-disable-next-line no-control-regex
const KITTY_REGEX = new RegExp(`${ESC}\\[\\?\\d+u`);
// Terminal name reply: CSI < kind ; ver ; patch y (Primary Device Attributes
// in the DA3 form used by the >q name query).
// eslint-disable-next-line no-control-regex
const TERMINAL_NAME_REGEX = new RegExp(`${ESC}\\[<(\\d+);\\d+;\\d+y`);
// modifyOtherKeys response: CSI > 4 ; level m
// eslint-disable-next-line no-control-regex
const MODIFY_OTHER_KEYS_REGEX = new RegExp(`${ESC}\\[>4;(\\d+)m`);
// Cursor Position Report: CSI row ; column R. Built from the ESC constant so
// the control character needs no no-control-regex suppression; global so
// every report in the buffer can be inspected.
const CURSOR_POSITION_REGEX = new RegExp(`${ESC}\\[(\\d+);(\\d+)R`, "g");
// Primary Device Attributes reply acts as the sentinel: it is sent last, so
// receiving it means the terminal processed every query.
// eslint-disable-next-line no-control-regex
const DEVICE_ATTRIBUTES_REGEX = new RegExp(`${ESC}\\[\\?\\d*;?\\d*c`);

const KITTY_QUERY = `${ESC}[?u`;
const TERMINAL_NAME_QUERY = `${ESC}[>q`;
const MODIFY_OTHER_KEYS_QUERY = `${ESC}[>4;?m`;
// Prints a box-drawing character (East Asian Width: Ambiguous) at column 1
// and asks for the cursor position (DSR 6). The reported column reveals
// whether the terminal renders ambiguous-width characters in one cell or two.
// The glyph is written in hidden mode and the line is cleared afterwards.
const AMBIGUOUS_WIDTH_PROBE = `\r\u2500${ESC}[6n`;
const DEVICE_ATTRIBUTES_QUERY = `${ESC}[c`;
const HIDDEN_MODE = `${ESC}[8m`;
const CLEAR_LINE_AND_RETURN = `${ESC}[2K\r`;
const RESET_ATTRIBUTES = `${ESC}[0m`;

class TerminalCapabilityManager {
  private static instance: TerminalCapabilityManager | undefined;

  private detectionComplete = false;
  private kittySupported = false;
  private kittyEnabled = false;
  private modifyOtherKeysSupported = false;
  private terminalName: TerminalName = undefined;
  private ambiguousCharactersWide = false;

  private constructor() {}

  static getInstance(): TerminalCapabilityManager {
    if (!this.instance) {
      this.instance = new TerminalCapabilityManager();
    }
    return this.instance;
  }

  static resetInstanceForTesting(): void {
    this.instance = undefined;
  }

  /**
   * Detects terminal capabilities (Kitty protocol support, terminal name,
   * modifyOtherKeys, ambiguous-width character rendering). This should be
   * called once at app startup, before Ink owns stdin.
   */
  async detectCapabilities(): Promise<void> {
    if (this.detectionComplete) return;

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.detectionComplete = true;
      return;
    }

    process.off("exit", cleanupTerminalOnExit);
    process.off("SIGTERM", cleanupTerminalOnExit);
    process.off("SIGINT", cleanupTerminalOnExit);
    process.on("exit", cleanupTerminalOnExit);
    process.on("SIGTERM", cleanupTerminalOnExit);
    process.on("SIGINT", cleanupTerminalOnExit);

    return new Promise((resolve) => {
      const originalRawMode = process.stdin.isRaw;
      const stdinWasFlowing = process.stdin.readableFlowing === true;
      if (!originalRawMode) {
        process.stdin.setRawMode(true);
      }

      let buffer = "";
      let kittyKeyboardReceived = false;
      let terminalNameReceived = false;
      let deviceAttributesReceived = false;
      let modifyOtherKeysReceived = false;
      let cursorPositionReceived = false;
      // The cleanup closure references the timer before its declaration;
      // both run after the listener is attached.
      // eslint-disable-next-line prefer-const
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        process.stdin.removeListener("data", onData);
        // Adding a `data` listener puts a Node readable stream into flowing
        // mode. Removing the listener does not pause it again, so stdin can
        // otherwise discard keyboard input before Ink attaches its consumer.
        if (!stdinWasFlowing && process.stdin.listenerCount("data") === 0) {
          process.stdin.pause?.();
        }
        if (!originalRawMode) {
          process.stdin.setRawMode(false);
        }
        this.detectionComplete = true;
        resolve();
      };

      // A terminal that answers nothing must not hold up the first frame:
      // 300ms covers local terminals and SSH round trips, and a missed
      // answer just means the conservative defaults stay in force.
      timeoutId = setTimeout(cleanup, 300);

      const onData = (data: Buffer) => {
        buffer += data.toString();

        if (!kittyKeyboardReceived && KITTY_REGEX.test(buffer)) {
          kittyKeyboardReceived = true;
          this.kittySupported = true;
        }

        // check for modifyOtherKeys support
        if (!modifyOtherKeysReceived) {
          const match = buffer.match(MODIFY_OTHER_KEYS_REGEX);
          if (match) {
            modifyOtherKeysReceived = true;
            const level = parseInt(match[1], 10);
            this.modifyOtherKeysSupported = level >= 2;
            logger.debug(
              `Detected modifyOtherKeys support: ${this.modifyOtherKeysSupported} (level ${level})`,
            );
          }
        }

        // Check for Terminal Name/Version response.
        if (!terminalNameReceived) {
          const match = buffer.match(TERMINAL_NAME_REGEX);
          if (match) {
            terminalNameReceived = true;
            this.terminalName = match[1];
            logger.debug(`Detected terminal name: ${this.terminalName}`);
          }
        }

        // Check the cursor position reported after the ambiguous-width probe.
        if (!cursorPositionReceived) {
          for (const match of buffer.matchAll(CURSOR_POSITION_REGEX)) {
            const column = parseInt(match[2], 10);
            // The probe glyph is printed at column 1, so the cursor ends up
            // on column 2 when it occupies one cell and column 3 when it
            // occupies two. Anything else (e.g. a stray report left over from
            // the shell) is not a response to our probe, so keep looking.
            if (column !== 2 && column !== 3) {
              continue;
            }
            cursorPositionReceived = true;
            this.ambiguousCharactersWide = column === 3;
            logger.debug(
              `Detected ambiguous-width characters as ${
                this.ambiguousCharactersWide ? "wide" : "narrow"
              } (cursor column ${column})`,
            );
            break;
          }
        }

        if (!deviceAttributesReceived) {
          const match = buffer.match(DEVICE_ATTRIBUTES_REGEX);
          if (match) {
            deviceAttributesReceived = true;
            cleanup();
          }
        }
      };

      process.stdin.on("data", onData);

      try {
        fs.writeSync(
          process.stdout.fd,
          // Use hidden mode to prevent potential "m" characters from being
          // printed to the terminal during startup when querying for
          // modifyOtherKeys. We hide the output, send queries, then
          // immediately clear the line and reset attributes.
          HIDDEN_MODE +
            KITTY_QUERY +
            TERMINAL_NAME_QUERY +
            MODIFY_OTHER_KEYS_QUERY +
            AMBIGUOUS_WIDTH_PROBE +
            DEVICE_ATTRIBUTES_QUERY +
            CLEAR_LINE_AND_RETURN +
            RESET_ATTRIBUTES,
        );
      } catch (e) {
        logger.warn(`Failed to write terminal capability queries: ${e}`);
        cleanup();
      }
    });
  }

  enableSupportedModes() {
    try {
      if (this.kittySupported) {
        logger.debug("Enabling Kitty keyboard protocol");
        enableKittyKeyboardProtocol();
        this.kittyEnabled = true;
      } else if (this.modifyOtherKeysSupported) {
        logger.debug("Enabling modifyOtherKeys");
        enableModifyOtherKeys();
      }
      // Always enable bracketed paste since it'll be ignored if unsupported.
      enableBracketedPasteMode();
    } catch (e) {
      logger.warn(`Failed to enable keyboard protocols: ${e}`);
    }
  }

  getTerminalName(): TerminalName {
    return this.terminalName;
  }

  /**
   * Whether the terminal renders East Asian Ambiguous-width characters (e.g.
   * box-drawing borders) in two cells instead of one. Defaults to `false`
   * when the terminal did not answer the probe.
   */
  areAmbiguousCharactersWide(): boolean {
    return this.ambiguousCharactersWide;
  }

  isKittyProtocolEnabled(): boolean {
    return this.kittyEnabled;
  }
}

export const terminalCapabilityManager =
  TerminalCapabilityManager.getInstance();
