declare const leafBrand: unique symbol;

/**
 * A positive whole number of Leaf, the guild currency.
 *
 * Leaf is never fractional and an amount is never zero or negative: the
 * direction of a movement comes from the kind of ledger entry, not from the
 * sign of the amount.
 */
export type Leaf = number & { readonly [leafBrand]: true };

/** Largest amount a single entry may move. Keeps every sum far inside safe integers. */
export const MAX_LEAF = 1_000_000_000;

export function isLeaf(value: unknown): value is Leaf {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_LEAF;
}

export function leaf(value: number): Leaf {
  if (!isLeaf(value)) {
    throw new RangeError(`Leaf amount must be a whole number from 1 to ${MAX_LEAF}, got ${value}`);
  }
  return value;
}
