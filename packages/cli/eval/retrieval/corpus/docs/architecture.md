# Relay architecture

Relay is a small order service with a billing side. An order is fulfilled by
`OrderService`; when the item turns out not to be stocked, fulfillment refunds
the total instead of shipping nothing, and the refund goes through the billing
policy so the limit lives in one place.

A refund above the limit needs a second approver. The policy rejects the
request rather than picking a name itself, which is why callers pass `approver`
whenever they are over `PARTIAL_REFUND_LIMIT`.

Reads of hot keys are cached. The cache forgets its own entries once an entry is
older than the ttl it was built with, and `SingleFlight` keeps one in-flight
load per key so a cold cache costs one fetch rather than one per waiter.

Outbound calls are retried with a doubling wait up to `MAX_ATTEMPTS`, and the
gateway is told the idempotency key so a retry cannot become a second charge.
