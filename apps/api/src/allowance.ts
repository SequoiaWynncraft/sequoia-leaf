/** A token bucket: an allowance that refills at `rate` a second, up to `burst`. */
export class Allowance {
  private readonly spec: { readonly rate: number; readonly burst: number };
  private tokens: number;
  private at: number;
  constructor(spec: { readonly rate: number; readonly burst: number }, now: number) {
    this.spec = spec;
    this.tokens = spec.burst;
    this.at = now;
  }
  private refill(now: number): void {
    this.tokens = Math.min(this.spec.burst, this.tokens + (Math.max(0, now - this.at) / 1000) * this.spec.rate);
    this.at = now;
  }
  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** Whether it has filled up again: nothing is owed on it. */
  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.spec.burst;
  }
}
