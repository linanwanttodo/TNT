/**
 * Unavailable services for the ZCode UI host.
 *
 * The browser shell calls a service the moment it paints; a missing channel
 * would instead wait out the ChannelServer timeout and surface a "Unknown
 * channel" error. Every method on a stub rejects immediately with a stable
 * code so the UI can show its own unavailable state and the log names the
 * channel that still needs a real implementation.
 */
export const ZCODE_UNAVAILABLE_PREFIX = "ZCODE_UNAVAILABLE:";

const IDLE_DISPOSABLE = { dispose: () => undefined };

/** An Event that never fires; subscriptions are inert but valid. */
const neverEvent = (): typeof IDLE_DISPOSABLE => IDLE_DISPOSABLE;

function isEventName(name: string): boolean {
  return (
    name.length >= 3 &&
    name[0] === "o" &&
    name[1] === "n" &&
    name.charCodeAt(2) >= 65 &&
    name.charCodeAt(2) <= 90
  );
}

function isDynamicEventName(name: string): boolean {
  return (
    name.length >= 10 &&
    name.startsWith("onDynamic") &&
    name.charCodeAt(9) >= 65 &&
    name.charCodeAt(9) <= 90
  );
}

/**
 * A service whose every RPC method rejects with `ZCODE_UNAVAILABLE:<channel>`.
 *
 * Event members are the exception: they resolve to an Event that never fires,
 * because the shell legitimately subscribes while painting and an unhandled
 * rejection there would escape the RPC channel.
 */
export function stubService<T>(channelName: string): T {
  const rejectUnavailable = (): Promise<never> =>
    Promise.reject(new Error(`${ZCODE_UNAVAILABLE_PREFIX}${channelName}`));

  const target: Record<PropertyKey, unknown> = {};
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "symbol") {
        return Reflect.get(object, property, receiver);
      }
      // A service proxy must not look thenable; awaiting it would otherwise
      // call a rejected "then" method.
      if (property === "then") {
        return undefined;
      }
      if (isDynamicEventName(property)) {
        return () => neverEvent;
      }
      if (isEventName(property)) {
        return neverEvent;
      }
      return rejectUnavailable;
    },
  }) as T;
}
