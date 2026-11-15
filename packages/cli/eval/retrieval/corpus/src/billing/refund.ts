import { GatewayClient } from "./gatewayClient.js";

/**
 * A refund above the limit needs a second approver: the caller has to pass one
 * explicitly, and nothing here invents a name for it.
 */
export const PARTIAL_REFUND_LIMIT = 500;

export interface RefundRequest {
  orderId: string;
  amountCents: number;
  approver?: string;
}

export class RefundPolicyError extends Error {}

export async function issueRefund(
  request: RefundRequest,
  gateway: GatewayClient,
): Promise<{ refundId: string }> {
  if (
    request.amountCents > PARTIAL_REFUND_LIMIT &&
    request.approver === undefined
  ) {
    throw new RefundPolicyError(
      `refund of ${request.amountCents} needs an approver`,
    );
  }

  return gateway.refund(request.orderId, request.amountCents);
}
