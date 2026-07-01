import { IBroadcastService, ISettingService } from "@zcode/services";
import { DEFAULT_LOCALE, type AppSettings } from "@zcode/shared";

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

/**
 * A stub with a handful of members replaced by working implementations. The
 * rest keeps `stubService`'s behaviour: events are inert and every other
 * method rejects `ZCODE_UNAVAILABLE:<channel>`.
 */
export function stubServiceWith<T extends object>(
  channelName: string,
  overrides: Partial<Record<keyof T, unknown>>,
): T {
  const stub = stubService<T>(channelName);
  return new Proxy(stub as object, {
    get(target, property, receiver) {
      if (
        typeof property === "string" &&
        Object.prototype.hasOwnProperty.call(overrides, property)
      ) {
        return (overrides as Record<string, unknown>)[property];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as T;
}

/**
 * settingService as `ZCodeIntlProvider` consumes it: `get()` resolves the
 * AppSettings fields the type requires so the provider's uncaught `.then`
 * chain settles, while every write still reports the service as unavailable.
 */
export function stubSettingService(): ISettingService {
  return stubServiceWith<ISettingService>(ISettingService.channelName, {
    get: (): Promise<AppSettings> =>
      Promise.resolve({ recentProjects: [], locale: DEFAULT_LOCALE }),
  });
}

/**
 * broadcastService as `ZCodeIntlProvider` consumes it: the provider calls
 * `send(...).finally(...)` without a catch, so a rejected send would surface
 * as an unhandled rejection; the stub accepts the broadcast and drops it.
 */
export function stubBroadcastService(): IBroadcastService {
  return stubServiceWith<IBroadcastService>(IBroadcastService.channelName, {
    send: (): Promise<void> => Promise.resolve(),
  });
}
