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
  /** Whether `n` may be taken now, taking nothing. */
  has(now: number, n = 1): boolean {
    this.refill(now);
    return this.tokens >= n;
  }
  /** Takes `n` if there are that many, and says whether it did: all of them or none. */
  take(now: number, n = 1): boolean {
    if (!this.has(now, n)) return false;
    this.tokens -= n;
    return true;
  }
  /** Whether it has filled up again: nothing is owed on it. */
  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.spec.burst;
  }
}

/**
 * Allowances kept by player, each made full the first time a player is seen. Once more than `kept`
 * players are held, those whose allowances have filled up again are let go.
 */
export class Allowances {
  private readonly specs: readonly { readonly rate: number; readonly burst: number }[];
  private readonly kept: number;
  private readonly held = new Map<string, readonly Allowance[]>();
  constructor(specs: readonly { readonly rate: number; readonly burst: number }[], kept: number) {
    this.specs = specs;
    this.kept = kept;
  }
  /**
   * Takes `amounts[i]` from the player's `i`th allowance, all at once or not at all, and says whether
   * it did.
   */
  take(player: string, now: number, amounts: readonly number[]): boolean {
    if (this.held.size > this.kept) {
      for (const [id, allowances] of this.held) if (allowances.every((a) => a.full(now))) this.held.delete(id);
    }
    const mine = this.held.get(player) ?? this.specs.map((spec) => new Allowance(spec, now));
    this.held.set(player, mine);
    if (!mine.every((allowance, i) => allowance.has(now, amounts[i] ?? 0))) return false;
    for (const [i, allowance] of mine.entries()) allowance.take(now, amounts[i] ?? 0);
    return true;
  }
}
