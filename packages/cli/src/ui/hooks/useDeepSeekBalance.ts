import { useEffect, useState } from "react";

interface BalanceModel {
  provider?: string;
  apiBase?: string;
  apiKey?: string;
}

export interface DeepSeekBalance {
  currency: string;
  total: string;
}

const REFRESH_MS = 5 * 60 * 1000;

function isDeepSeekHost(hostname: string): boolean {
  return hostname.toLowerCase() === "api.deepseek.com";
}

/**
 * Reads DeepSeek's documented GET /user/balance endpoint. Keys are read from
 * the selected model and only sent to api.deepseek.com; they are never logged
 * or returned from this hook. Other providers have no balance display.
 *
 * The host decides, not the provider id: a model on DeepSeek's official API
 * may be configured through the Anthropic-compatible route (provider
 * "anthropic" with apiBase .../anthropic/v1) and still has a balance there.
 */
export async function fetchDeepSeekBalance(
  model: BalanceModel,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DeepSeekBalance[]> {
  if (!model.apiBase || !model.apiKey) {
    return [];
  }
  let api: URL;
  try {
    api = new URL(model.apiBase);
  } catch {
    return [];
  }
  if (!isDeepSeekHost(api.hostname)) return [];

  try {
    const response = await fetcher(new URL("/user/balance", api.origin), {
      headers: { Authorization: `Bearer ${model.apiKey}` },
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      balance_infos?: Array<{ currency?: string; total_balance?: string }>;
    };
    return (body.balance_infos ?? [])
      .filter(
        (item): item is { currency: string; total_balance: string } =>
          typeof item.currency === "string" &&
          typeof item.total_balance === "string",
      )
      .map((item) => ({
        currency: item.currency,
        // DeepSeek returns "-0.00" once a key is drained: normalise that to a
        // plain zero so the status line does not read like a debt.
        total: Number(item.total_balance) === 0 ? "0.00" : item.total_balance,
      }));
  } catch {
    return [];
  }
}

export function useDeepSeekBalance(
  model: BalanceModel | null | undefined,
): DeepSeekBalance[] {
  const [balance, setBalance] = useState<DeepSeekBalance[]>([]);

  useEffect(() => {
    if (!model?.apiBase || !model.apiKey) {
      setBalance([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      const next = await fetchDeepSeekBalance(model, fetch, controller.signal);
      if (!cancelled) setBalance(next);
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [model?.provider, model?.apiBase, model?.apiKey]);

  return balance;
}
