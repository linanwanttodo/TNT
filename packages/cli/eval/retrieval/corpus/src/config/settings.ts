import { DEFAULT_TTL_MS, TtlCache } from "../cache/ttlCache.js";
import { SingleFlight } from "../cache/singleFlight.js";
import { GatewayClient } from "../billing/gatewayClient.js";

export interface Settings {
  ttlMs: number;
  pageSize: number;
  gatewayUrl: string;
}

/**
 * Reads the process environment once. The ttl comes from the environment, in
 * milliseconds, and falls back to the cache's own default when it is missing or
 * not a number.
 */
export function loadSettings(
  env: Record<string, string | undefined> = process.env,
): Settings {
  const parsed = Number(env.RELAY_TTL_MS);
  return {
    ttlMs: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS,
    pageSize: Number(env.RELAY_PAGE_SIZE ?? 25),
    gatewayUrl: env.RELAY_GATEWAY_URL ?? "https://gateway.invalid",
  };
}

export function buildCache(settings: Settings) {
  const cache = new TtlCache<string>(settings.ttlMs);
  return { cache, flights: new SingleFlight(cache) };
}

export function buildGateway(settings: Settings) {
  return new GatewayClient(async (path) => {
    const response = await fetch(`${settings.gatewayUrl}${path}`);
    return response.json();
  });
}
