/** Counts of things as a kept yard keeps them (`codec.ts`): by each thing's name, only those above 0. */
import { ALL_ITEMS, itemName } from "./tables.ts";
import { type Counts, counts } from "./yard.ts";

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, most: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most ? v : null;

/** A count by name, as kept: only real things, only sensible counts, always in the same order. */
export function tally(c: Counts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of ALL_ITEMS) {
    const v = c[n] ?? 0;
    if (Number.isFinite(v) && v > 0) out[itemName(n)] = v;
  }
  return out;
}
/** A count by name read back. */
export function untally(v: unknown, most: number): Counts {
  const out = counts();
  if (!isRec(v)) return out;
  for (const n of ALL_ITEMS) {
    const got = whole(v[itemName(n)], most);
    if (got !== null && got > 0) out[n] = got;
  }
  return out;
}
