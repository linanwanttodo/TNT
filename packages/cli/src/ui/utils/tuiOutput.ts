import { Console } from "node:console";
import { Writable } from "node:stream";

import { render, type RenderOptions } from "ink";
import React from "react";

import { logger } from "../../utils/logger.js";

const CONSOLE_METHODS = [
  "log",
  "info",
  "debug",
  "warn",
  "error",
  "dir",
  "dirxml",
  "trace",
  "assert",
  "table",
  "group",
  "groupCollapsed",
  "groupEnd",
  "count",
  "countReset",
  "time",
  "timeLog",
  "timeEnd",
  "clear",
] as const;

export function renderGuardedTui(
  node: React.ReactNode,
  options: RenderOptions,
) {
  const output = guardTuiOutput();
  try {
    const instance = render(node, {
      ...options,
      patchConsole: false,
      stderr: output.stderr,
    });
    if (typeof instance.waitUntilExit === "function") {
      void instance.waitUntilExit().then(output.restore, output.restore);
    }
    return {
      ...instance,
      unmount: () => {
        try {
          instance.unmount();
        } finally {
          output.restore();
        }
      },
    };
  } catch (error) {
    output.restore();
    throw error;
  }
}

export function guardTuiOutput() {
  const originalStderrWrite = process.stderr.write;
  const rawStderrWrite = originalStderrWrite.bind(process.stderr);
  const originals = new Map<string, (...args: any[]) => void>();
  const methods = console as unknown as Record<
    string,
    (...args: any[]) => void
  >;
  let recording = false;

  const record = (text: string, error: boolean) => {
    if (recording) return;
    recording = true;
    try {
      if (error) logger.warn(text.trimEnd());
      else logger.info(text.trimEnd());
    } finally {
      recording = false;
    }
  };

  const output = (error: boolean) =>
    new Writable({
      write(chunk, _encoding, callback) {
        try {
          record(chunk.toString(), error);
          callback();
        } catch (failure) {
          callback(failure as Error);
        }
      },
    });
  const redirected = new Console({
    stdout: output(false),
    stderr: output(true),
  });
  const redirectedMethods = redirected as unknown as typeof methods;
  for (const name of CONSOLE_METHODS) {
    originals.set(name, methods[name]);
    methods[name] = redirectedMethods[name].bind(redirected);
  }

  // Ink must retain a raw stderr writer; dependency writes must never move its
  // parked cursor or invalidate the terminal buffer's last painted frame.
  const stderr = new Proxy(process.stderr, {
    get(target, property) {
      if (property === "write") return rawStderrWrite;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const interceptedWrite = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const encoding =
      typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
    const done =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    try {
      record(
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(encoding),
        true,
      );
    } finally {
      done?.();
    }
    return true;
  };
  process.stderr.write = interceptedWrite;

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const [name, method] of originals) methods[name] = method;
    if (process.stderr.write === interceptedWrite)
      process.stderr.write = originalStderrWrite;
  };
  return { stderr, restore };
}
