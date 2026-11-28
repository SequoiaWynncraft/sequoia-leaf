/**
 * The beat (tier 8: SPEC-2 3.5's last step). On every tick that divides by `CHARGED.beat` (200 ticks,
 * 20 seconds), in a yard that knows the charger's research, every charged cell in the yard loses a bar,
 * in one pass over everything that carries or holds: what each tile carries, what is under the ground
 * in every tunnel, and every holder's row (its finished thing, its by-product, and its counts, with the
 * count of different things it holds put right). One with 1 bar is a plain cell again. Then every
 * waiting tile is woken, as what it holds may now be taken, or refused.
 *
 * It reads nothing but the yard as kept (its tick, what it knows and what it holds), so a yard read
 * back beats as the yard it was kept from. A yard that does not know the research is never passed over:
 * it does what it did before tier 8, tick for tick. The pass makes nothing.
 */
import { CHARGED } from "./launch.ts";
import { goal, ITEM_COUNT } from "./tables.ts";
import type { Wire, Yard } from "./yard.ts";

/** The research a yard knows before its charged cells lose bars. */
const CHARGING = goal(CHARGED.known);
const { down: DOWN, plain: PLAIN, beat: BEAT } = CHARGED;
const [ONE = 0, TWO = 0, THREE = 0] = CHARGED.bars;

/** Ticks from a tick to the next beat: 200 on a beat's own tick, which has had its beat. The one place a screen reads it from. */
export const toBeat = (tick: number): number => BEAT - (tick % BEAT);

/** Whether the yard's charged cells lose a bar on its tick now: one that divides by the beat, in a yard that knows the charger. */
export const beats = (y: Yard): boolean => y.tick % BEAT === 0 && y.open.done[CHARGING] === 1;

/** 1 for a count above 0, else 0. */
const some = (c: number): number => (c > 0 ? 1 : 0);

/** A holder's row's charged cells each lose a bar, its counts kept right: those with 1 bar join its plain cells. */
function rowBeats(y: Yard, r: number): void {
  const h = y.holders;
  const { stock } = h;
  h.out[r] = DOWN[h.out[r] ?? 0] ?? 0;
  h.also[r] = DOWN[h.also[r] ?? 0] ?? 0;
  const at = r * ITEM_COUNT;
  const one = stock[at + ONE] ?? 0;
  const two = stock[at + TWO] ?? 0;
  const three = stock[at + THREE] ?? 0;
  if (one + two + three === 0) return;
  const plain = stock[at + PLAIN] ?? 0;
  const before = some(plain) + some(one) + some(two) + some(three);
  stock[at + PLAIN] = plain + one;
  stock[at + ONE] = two;
  stock[at + TWO] = three;
  stock[at + THREE] = 0;
  h.kinds[r] = (h.kinds[r] ?? 0) + some(plain + one) + some(two) + some(three) - before;
}

/** Every charged cell in the yard loses a bar, on what carries, under the ground and in every holder, and every tile that waited may try again. */
export function beat(y: Yard, wire: Wire): void {
  const { item } = y;
  for (let i = 0; i < item.length; i++) item[i] = DOWN[item[i] ?? 0] ?? 0;
  const { under } = y.tunnels;
  for (let k = 0; k < under.length; k++) under[k] = DOWN[under[k] ?? 0] ?? 0;
  for (let r = 0; r < y.holders.size; r++) rowBeats(y, r);
  wire.waiting.fill(0);
}
