# Relay runbook

## Charges that never land

A charge that fails leaves no partial state: the gateway is asked up to the
retry ceiling and then the call fails. If the gateway reports a decline that is
not transient, the retry ceiling will not help - the card needs a different
payment method, and re-running the job only spends the same four attempts again.

## The cache is too cold

If the same keys miss one after another, the ttl is shorter than the traffic
pattern. Increase `RELAY_TTL_MS` and restart; the process reads it once, at
startup, through `loadSettings`. A ttl of `0` is treated as missing and falls
back to the cache default rather than expiring everything immediately.

## Refunds that come back as policy errors

A policy error means the amount was over the limit and no approver was passed.
Re-issue the refund with an approver rather than lowering the limit: the limit is
a control, not a tuning knob.
