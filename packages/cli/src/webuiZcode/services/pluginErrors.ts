import { ZCODE_UNAVAILABLE_PREFIX } from "./stubs.js";

/** Reject an operation the host cannot serve without pretending it succeeded. */
export function unavailable(channel: string): never {
  throw new Error(`${ZCODE_UNAVAILABLE_PREFIX}${channel}`);
}

export function isUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith(ZCODE_UNAVAILABLE_PREFIX)
  );
}
