import winston from "winston";

import { getCoreLogsPath } from "./paths.js";

type LogLevel = "error" | "warn" | "info" | "debug";

// Log level is configurable so a session can be turned up for troubleshooting
// without a rebuild. Defaults to info.
function resolveLogLevel(): LogLevel {
  const configured = (
    process.env.CONTINUE_LOG_LEVEL ?? ""
  ).toLowerCase() as LogLevel;
  return ["error", "warn", "info", "debug"].includes(configured)
    ? configured
    : "info";
}

class LoggerClass {
  private static instance: LoggerClass;
  private winston: winston.Logger;

  private constructor() {
    // Logs are also written to a file so a session can be inspected after the
    // fact. File logging is best-effort: a read-only or unavailable directory
    // must not take down the process that is only trying to log.
    const fileTransports: winston.transport[] = [];
    try {
      fileTransports.push(
        new winston.transports.File({
          filename: getCoreLogsPath(),
          level: resolveLogLevel(),
        }),
      );
    } catch {
      // Fall back to stderr-only logging.
    }

    this.winston = winston.createLogger({
      level: resolveLogLevel(),
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";
          return `[@tnt] ${level}: ${message}${metaStr}`;
        }),
      ),
      transports: [
        ...(process.env.NODE_ENV === "test"
          ? [
              new winston.transports.File({
                filename: "e2e.log",
                level: "info",
              }),
            ]
          : []),
        ...fileTransports,
        // Use stderr to avoid corrupting IPC stdout stream in the binary
        new winston.transports.Console({
          stderrLevels: ["error", "warn", "info", "debug"],
        }),
      ],
    });
  }

  public static getInstance(): LoggerClass {
    if (!LoggerClass.instance) {
      LoggerClass.instance = new LoggerClass();
    }
    return LoggerClass.instance;
  }

  public log(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  public debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }

  public info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  public warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }

  public error(
    error: Error | string | unknown,
    context?: Record<string, any>,
  ): void {
    let errorMessage: string;

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    } else {
      errorMessage = "An unknown error occurred";
    }

    this.winston.error(errorMessage, context);
  }
}

export const Logger = LoggerClass.getInstance();
