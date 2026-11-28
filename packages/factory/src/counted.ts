/** Counts of things as a kept yard keeps them (`codec.ts`): by each thing's name, only those above 0. */
import { isRecord, whole } from "./fields.ts";
import { ALL_ITEMS, itemName } from "./tables.ts";
import { type Counts, counts } from "./yard.ts";

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
  if (!isRecord(v)) return out;
  for (const n of ALL_ITEMS) {
    const got = v[itemName(n)];
    if (whole(got, most) && got > 0) out[n] = got;
  }
  return out;
}
