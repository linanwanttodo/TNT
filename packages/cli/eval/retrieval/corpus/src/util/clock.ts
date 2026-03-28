/**
 * Wall-clock reads go through here so a test can use a clock it advances itself
 * instead of waiting on real time.
 */
export interface Clock {
  nowMillis(): number;
}

export const systemClock: Clock = {
  nowMillis: () => Date.now(),
};

/** A clock the tests can advance: it only moves when told to. */
export class FixedClock implements Clock {
  constructor(private at: number = 0) {}

  nowMillis(): number {
    return this.at;
  }

  advance(ms: number): void {
    this.at += ms;
  }
}
