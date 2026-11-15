import { withBackoff } from "./retryPolicy.js";

export class PaymentDeclinedError extends Error {}

export interface GatewayResponse {
  chargeId: string;
}

/**
 * The card is charged once per idempotency key: the key goes with the request,
 * so a retry after a transport failure cannot turn into two charges.
 */
export class GatewayClient {
  constructor(
    private readonly fetcher: (path: string, body: unknown) => Promise<unknown>,
  ) {}

  async charge(idempotencyKey: string, amountCents: number) {
    return withBackoff(async () => {
      const answer = (await this.fetcher("/charges", {
        idempotencyKey,
        amountCents,
      })) as GatewayResponse;
      return answer;
    });
  }

  async refund(orderId: string, amountCents: number) {
    return withBackoff(async () => {
      return (await this.fetcher(`/orders/${orderId}/refunds`, {
        amountCents,
      })) as { refundId: string };
    });
  }
}
