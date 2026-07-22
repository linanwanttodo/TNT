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

/**
 * Reads DeepSeek's documented GET /user/balance endpoint. Keys are read from
 * the selected model and only sent to api.deepseek.com; they are never logged
 * or returned from this hook. Other providers have no balance display.
 */
export async function fetchDeepSeekBalance(
  model: BalanceModel,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DeepSeekBalance[]> {
  if (model.provider !== "deepseek" || !model.apiBase || !model.apiKey) {
    return [];
  }
  let api: URL;
  try {
    api = new URL(model.apiBase);
  } catch {
    return [];
  }
  if (api.hostname.toLowerCase() !== "api.deepseek.com") return [];

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
      .map((item) => ({ currency: item.currency, total: item.total_balance }));
  } catch {
    return [];
  }
}

export function useDeepSeekBalance(
  model: BalanceModel | null | undefined,
): DeepSeekBalance[] {
  const [balance, setBalance] = useState<DeepSeekBalance[]>([]);

  useEffect(() => {
    if (!model?.apiBase || !model.apiKey || model.provider !== "deepseek") {
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
