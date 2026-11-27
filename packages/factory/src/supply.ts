/**
 * The yard's power book: where its power comes from and goes, counted once from what stands, as every
 * screen says it. What gives power is counted by how it gives (`kinds/`): what gives it steadily
 * where power reaches it (the waterwheels, by `Hooks.steady`), and what burns for it (the boilers, by
 * `Hooks.burn`). The book's two rows are named for the two kinds that give power today; a kind that
 * gives power another way, or burns at another rate, makes them a row for each kind that gives.
 */
import { RULES } from "./kinds/list.ts";
import { litOf } from "./power.ts";
import { ALL_KINDS, DRAW, drawnAt, GIVES, HALF, type Kind, NONE } from "./tables.ts";
import { KIT, type Power, power, rewire } from "./wire.ts";
import type { Yard } from "./yard.ts";

/** What stands of a kind that draws power: how many where power reaches and where it does not, the power those in reach draw, and the least and most one of them draws at its grade where power reaches it. */
export interface KindPower {
  readonly kind: Kind;
  readonly lit: number;
  readonly dark: number;
  readonly drawn: number;
  readonly each: readonly [number, number];
}

/**
 * Where a yard's power comes from and goes, as every screen says it: what the depot gives; the
 * waterwheels turning and those out of reach; the boilers in reach burning and cold, and those out
 * of reach; and each kind that draws, as `KindPower` says, for each kind of which something stands.
 * The kinds' power drawn adds up to `demand`, and what the depot, the wheels and the boilers burning
 * give to `supply`.
 */
export interface PowerSummary extends Power {
  readonly depot: number;
  readonly wheels: { readonly turning: number; readonly away: number };
  readonly boilers: { readonly burning: number; readonly cold: number; readonly dark: number };
  readonly draws: readonly KindPower[];
}

/** The kinds that draw power, in the tables' order. */
const DRAWS: readonly Kind[] = ALL_KINDS.filter((k) => (DRAW[k] ?? 0) > 0);
/** Whether a kind gives power steadily where power reaches it, and whether it burns for power. */
const STEADY = RULES.map((r) => r.steady !== null);
const BURNS = RULES.map((r) => r.burn !== null);
/** The power one piece that burns gives while it burns, in halves. */
const BURNT = (GIVES[BURNS.indexOf(true)] ?? 0) * HALF;

export function powerSummary(y: Yard): PowerSummary {
  const p = power(y);
  const t = tally(y);
  // What burned at the last tick is what the supply has beyond what is always there.
  const beyond = y.supply - (y.wire ?? rewire(y)).steady;
  const burning = BURNT > 0 ? Math.min(t.burners, Math.max(0, Math.round(beyond / BURNT))) : 0;
  return {
    ...p,
    depot: y.open.depot,
    wheels: { turning: t.turning, away: t.steady - t.turning },
    boilers: { burning, cold: t.burners - burning, dark: t.burnersAway },
    draws: DRAWS.filter((k) => of(t.lit, k) + of(t.dark, k) > 0).map((k) => ({
      kind: k,
      lit: of(t.lit, k),
      dark: of(t.dark, k),
      drawn: of(t.drawn, k) / HALF,
      each: [of(t.least, k) / HALF, of(t.most, k) / HALF],
    })),
  };
}

/** A kind's count in a tally. */
const of = (a: Int32Array, k: number): number => a[k] ?? 0;

/**
 * One walk over what stands: of each kind (by its number), how many in reach of power and not, what
 * those in reach draw and the least and most one draws, in halves; what gives power steadily, and
 * of that what gives it now; what burns for it in reach, and out of reach.
 */
interface Tally {
  readonly lit: Int32Array;
  readonly dark: Int32Array;
  readonly drawn: Int32Array;
  readonly least: Int32Array;
  readonly most: Int32Array;
  steady: number;
  turning: number;
  burners: number;
  burnersAway: number;
}

function tally(y: Yard): Tally {
  const lit = litOf(y);
  const n = ALL_KINDS.length;
  const t: Tally = {
    lit: new Int32Array(n),
    dark: new Int32Array(n),
    drawn: new Int32Array(n),
    least: new Int32Array(n),
    most: new Int32Array(n),
    steady: 0,
    turning: 0,
    burners: 0,
    burnersAway: 0,
  };
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    if (k === NONE) continue;
    const reached = lit[i] === 1;
    const counts = reached ? t.lit : t.dark;
    counts[k] = of(counts, k) + 1;
    givers(t, y, i, k, reached);
    const d = drawnAt(k, y.grade[i] ?? 0);
    if (!reached) continue;
    t.drawn[k] = of(t.drawn, k) + d;
    if (d > 0) widen(t, k, d);
  }
  return t;
}

/** Counts in a piece that gives power: one that gives it steadily, and one that burns for it. */
function givers(t: Tally, y: Yard, i: number, k: number, reached: boolean): void {
  if (STEADY[k] === true) {
    t.steady++;
    if (reached && (RULES[k]?.steady?.(KIT, y, i) ?? 0) > 0) t.turning++;
  }
  if (BURNS[k] === true) {
    if (reached) t.burners++;
    else t.burnersAway++;
  }
}

/** Takes in what one piece of a kind draws: the least and the most one of the kind draws. */
function widen(t: Tally, k: number, d: number): void {
  if (of(t.least, k) === 0 || d < of(t.least, k)) t.least[k] = d;
  if (d > of(t.most, k)) t.most[k] = d;
}
