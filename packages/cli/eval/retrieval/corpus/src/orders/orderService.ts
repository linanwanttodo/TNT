import { issueRefund } from "../billing/refund.js";
import { cursorFor, DEFAULT_PAGE_SIZE } from "./pagination.js";

export interface Order {
  id: string;
  totalCents: number;
  stocked: boolean;
}

/**
 * Fulfilling an order that turned out to be unstockable gives the money back
 * immediately: the refund goes through the billing policy, so the limit and the
 * approver rules stay in one place.
 */
export class OrderService {
  constructor(
    private readonly orders: Map<string, Order>,
    private readonly gateway: Parameters<typeof issueRefund>[1],
  ) {}

  async fulfillOrder(orderId: string): Promise<Order | undefined> {
    const order = this.orders.get(orderId);
    if (!order) {
      return undefined;
    }
    if (!order.stocked) {
      await issueRefund(
        { orderId, amountCents: order.totalCents },
        this.gateway,
      );
      return undefined;
    }
    return order;
  }

  listPage(page: number, size = DEFAULT_PAGE_SIZE) {
    return {
      items: [...this.orders.values()].slice(0, size),
      next: cursorFor(page + 1, size),
    };
  }
}
