/**
 * What burns for power, as the rules read it from each kind's module (`KindDef.burns`): the tick burns
 * from this alone (`tick.ts`'s `power`), and the books and the words count what burns by it.
 */
import type { KindDef } from "./kinds/kind.ts";
import { KIND_DEFS } from "./kinds/list.ts";
import { HALF, type Item, item } from "./tables.ts";

/**
 * For each kind that burns for power (`KindDef.burns`): what it burns, in the order it takes them, each
 * a thing, the ticks a piece of it burns and the smog a piece taken adds to its plot; how many pieces
 * of each it holds; and the power it gives while it burns, in halves.
 */
export interface Burns {
  readonly fuels: readonly { readonly fuel: Item; readonly ticks: number; readonly smog: number }[];
  readonly holds: number;
  readonly halves: number;
}
export type Fuel = Burns["fuels"][number];
export const BURNS: readonly (Burns | null)[] = KIND_DEFS.map((d: KindDef) => {
  const b = d.burns;
  if (!b) return null;
  const fuels = b.fuels.map((f): Fuel => ({
    fuel: item(f.fuel),
    ticks: f.ticks,
    smog: f.smog ?? 0,
  }));
  return { fuels, holds: b.holds, halves: d.info.gives * HALF };
});
