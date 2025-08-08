import crypto from "crypto";
import fs from "fs";
import path from "path";

import chalk from "chalk";
import winston from "winston";

import { env } from "../config/env.js";

const { combine, timestamp, printf, errors } = winston.format;

// Generate a unique session ID for this process
const SESSION_ID = crypto.randomBytes(4).toString("hex");

// Get log directory
function getLogDir(): string {
  const logDir = path.join(env.continueHome, "logs");

  // Create directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return logDir;
}

// Get current log file path
function getLogFilePath(): string {
  const logDir = getLogDir();
  return path.join(logDir, "tnt.log");
}

// Simple replacer for JSON.stringify to handle common issues
function createReplacer() {
  const seen = new Set();

  return (key: string, value: any) => {
    // Handle circular references
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }

    // Handle Error objects explicitly - extract useful properties
    if (value instanceof Error) {
      const errorObj: any = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      if (value.cause) {
        errorObj.cause = value.cause;
      }
      return errorObj;
    }

    // Handle functions
    if (typeof value === "function") {
      return "[Function]";
    }

    // Handle undefined (which JSON.stringify skips by default)
    if (value === undefined) {
      return "[undefined]";
    }

    return value;
  };
}

// Custom format for log output
const logFormat = printf(
  ({ level, message, timestamp, stack, ...metadata }) => {
    let msg = `${timestamp} [${SESSION_ID}] [${level}]: ${message}`;

    // Add metadata if present
    if (Object.keys(metadata).length > 0) {
      try {
        msg += ` ${JSON.stringify(metadata, createReplacer())}`;
      } catch (err) {
        // Fallback if stringify still fails somehow
        msg += ` [Failed to stringify metadata: ${err}]`;
      }
    }

    // Add stack trace for errors
    if (stack) {
      msg += `\n${stack}`;
    }

    return msg;
  },
);

// Track headless mode
let isHeadlessMode = false;
let isTTYlessEnvironment = false;

// Create the winstonLogger instance
const winstonLogger = winston.createLogger({
  level: "info", // Default level
  format: combine(
    errors({ stack: true }),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    logFormat,
  ),
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: getLogFilePath(),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

const LOG_LEVELS = ["error", "warn", "info", "debug", "silly"] as const;

/**
 * Maps a configured level name to a level this logger accepts, or undefined
 * when the name is not one of them. A typo is ignored rather than raising the
 * volume, so it cannot flood the log.
 */
export function resolveLogLevel(
  value: string | undefined,
): (typeof LOG_LEVELS)[number] | undefined {
  const requested = (value ?? "").trim().toLowerCase();
  return LOG_LEVELS.find((level) => level === requested);
}

/**
 * Applies the level named by `TNT_LOG_LEVEL` (or the older
 * `CONTINUE_LOG_LEVEL`). Unrecognized values are ignored rather than raising
 * the volume, so a typo cannot flood the log.
 */
function applyConfiguredLogLevel(): void {
  const level = resolveLogLevel(
    process.env.TNT_LOG_LEVEL ?? process.env.CONTINUE_LOG_LEVEL,
  );

  if (level) {
    winstonLogger.level = level;
  }
}

applyConfiguredLogLevel();

// Function to set log level
export function setLogLevel(level: string) {
  winstonLogger.level = level;
}

interface ClosableTransport {
  close?: (callback?: () => void) => void;
}

/**
 * Closes each transport and resolves when they report done, or after the
 * timeout, so a wedged transport cannot hold the exit.
 */
export function flushTransports(
  transports: ReadonlyArray<ClosableTransport>,
  timeoutMs = 1000,
): Promise<void> {
  const pending = transports.map(
    (transport) =>
      new Promise<void>((resolve) => {
        if (typeof transport.close !== "function") {
          resolve();
          return;
        }

        let settled = false;
        const done = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        timer.unref?.();

        try {
          transport.close(() => {
            clearTimeout(timer);
            done();
          });
        } catch {
          clearTimeout(timer);
          done();
        }
      }),
  );

  return Promise.all(pending).then(() => undefined);
}

/**
 * Waits until the lines already written have reached the log file.
 *
 * The process leaves through `process.exit()`, which drops whatever the file
 * stream still had buffered, and the end-of-turn telemetry is exactly that
 * tail.
 */
export function flushLogs(timeoutMs = 1000): Promise<void> {
  return flushTransports(
    winstonLogger.transports as unknown as ReadonlyArray<ClosableTransport>,
    timeoutMs,
  );
}

// Function to configure headless mode
export function configureHeadlessMode(headless: boolean) {
  isHeadlessMode = headless;

  // Detect TTY-less environment
  isTTYlessEnvironment =
    process.stdin.isTTY !== true &&
    process.stdout.isTTY !== true &&
    process.stderr.isTTY !== true;

  // In TTY-less environments with headless mode, ensure output is line-buffered
  if (headless && isTTYlessEnvironment) {
    // Set encoding for consistent output
    if (process.stdout.setDefaultEncoding) {
      process.stdout.setDefaultEncoding("utf8");
    }
    if (process.stderr.setDefaultEncoding) {
      process.stderr.setDefaultEncoding("utf8");
    }
  }
}

// Export winstonLogger methods
export const logger = {
  debug: (message: string, meta?: any) => winstonLogger.debug(message, meta),
  info: (message: string, meta?: any) => winstonLogger.info(message, meta),
  warn: (message: string, meta?: any) => {
    winstonLogger.warn(message, meta);
  },
  error: (message: string, error?: Error | any, meta?: any) => {
    if (error instanceof Error) {
      winstonLogger.error(message, {
        ...meta,
        error: error.message,
        stack: error.stack,
      });
    } else if (error) {
      winstonLogger.error(message, { ...meta, error });
    } else {
      winstonLogger.error(message, meta);
    }

    // In headless mode, also output to stderr
    if (isHeadlessMode) {
      if (error instanceof Error) {
        console.error(chalk.red(`${message}: ${error.message}`));
      } else if (error) {
        console.error(chalk.red(`${message}: ${error}`));
      } else {
        console.error(chalk.red(message));
      }
    }
  },
  setLevel: setLogLevel,
  configureHeadlessMode,
  flush: flushLogs,
  getLogPath: getLogFilePath,
  getSessionId: () => SESSION_ID,
};
