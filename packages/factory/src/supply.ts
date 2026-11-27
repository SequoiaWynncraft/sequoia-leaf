/**
 * The yard's power book: where its power comes from and goes, counted once from what stands, as every
 * screen says it. What gives power is counted by kind, by how it gives (`kinds/`): what gives it
 * steadily where power reaches it (a waterwheel, by `Hooks.steady`), and what burns for it (a
 * boiler, by `KindDef.burns`), each at its own kind's power.
 */
import { RULES } from "./kinds/list.ts";
import { litAt, litOf } from "./power.ts";
import { OWN } from "./sizes.ts";
import { ALL_KINDS, BURNS, DRAW, drawnAt, GIVES, HALF, type Kind, NONE } from "./tables.ts";
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
 * What stands of a kind that gives power, and what it gives now: whether it burns for it; how many
 * give it now (turning, burning); how many stand giving none, a steady one not turning or out of
 * reach and a burning one in reach gone cold; the burning ones out of reach; and the power given,
 * by the kind's own power (`KindInfo.gives`).
 */
export interface KindGives {
  readonly kind: Kind;
  readonly burns: boolean;
  readonly giving: number;
  readonly idle: number;
  readonly dark: number;
  readonly gives: number;
}

/**
 * Where a yard's power comes from and goes, as every screen says it: what the depot gives; each kind
 * that gives power, as `KindGives` says, for each kind of which something stands; and each kind that
 * draws, as `KindPower` says. The kinds' power drawn adds up to `demand`, and what the depot and
 * every kind gives to `supply`.
 */
export interface PowerSummary extends Power {
  readonly depot: number;
  readonly gives: readonly KindGives[];
  readonly draws: readonly KindPower[];
}

/** The kinds that draw power, in the tables' order. */
const DRAWS: readonly Kind[] = ALL_KINDS.filter((k) => (DRAW[k] ?? 0) > 0);
/** The kinds that give power steadily where power reaches them, and those that burn for it, in the tables' order. */
const GIVERS: readonly Kind[] = ALL_KINDS.filter((k) => RULES[k]?.steady !== null || BURNS[k] !== null);

export function powerSummary(y: Yard): PowerSummary {
  const p = power(y);
  const t = tally(y);
  // What burned at the last tick is what the supply has beyond what is always there.
  const burnt = burntBy(t, y.supply - (y.wire ?? rewire(y)).steady);
  return {
    ...p,
    depot: y.open.depot,
    gives: GIVERS.filter((k) => of(t.lit, k) + of(t.dark, k) > 0).map((k) => {
      const burns = BURNS[k] !== null;
      const giving = burns ? of(burnt, k) : of(t.giving, k);
      return {
        kind: k,
        burns,
        giving,
        // A steady one out of reach is idle with those not turning; a burning one out of reach is apart.
        idle: (burns ? of(t.lit, k) : of(t.lit, k) + of(t.dark, k)) - giving,
        dark: burns ? of(t.dark, k) : 0,
        gives: giving * (GIVES[k] ?? 0),
      };
    }),
    draws: DRAWS.filter((k) => of(t.lit, k) + of(t.dark, k) > 0).map((k) => ({
      kind: k,
      lit: of(t.lit, k),
      dark: of(t.dark, k),
      drawn: of(t.drawn, k) / HALF,
      each: [of(t.least, k) / HALF, of(t.most, k) / HALF],
    })),
  };
}

/**
 * How many of each kind that burns burned at the last tick, of those in reach, from `beyond`, the
 * power in halves that burning gave. Where one kind burns, that tells how many. Where several do,
 * each still burning burned, and the rest of `beyond` was given by pieces that burned their last,
 * counted from the kind that gives most.
 */
function burntBy(t: Tally, beyond: number): Int32Array {
  const out = new Int32Array(ALL_KINDS.length);
  const kinds = ALL_KINDS.filter((k) => BURNS[k] && of(t.lit, k) > 0).toSorted(
    (a, b) => (BURNS[b]?.halves ?? 0) - (BURNS[a]?.halves ?? 0),
  );
  const [only] = kinds;
  if (kinds.length === 1 && only !== undefined) {
    const halves = BURNS[only]?.halves ?? 0;
    out[only] = halves > 0 ? Math.min(of(t.lit, only), Math.max(0, Math.round(beyond / halves))) : 0;
    return out;
  }
  let left = beyond;
  for (const k of kinds) {
    out[k] = Math.min(of(t.lit, k), of(t.fuelled, k));
    left -= of(out, k) * (BURNS[k]?.halves ?? 0);
  }
  for (const k of kinds) {
    const halves = BURNS[k]?.halves ?? 0;
    const more = halves > 0 ? Math.min(of(t.lit, k) - of(out, k), Math.max(0, Math.floor(left / halves))) : 0;
    out[k] = of(out, k) + more;
    left -= more * halves;
  }
  return out;
}

/** A kind's count in a tally. */
const of = (a: Int32Array, k: number): number => a[k] ?? 0;

/**
 * One walk over what stands, of each kind (by its number): how many in reach of power and not, what
 * those in reach draw and the least and most one draws, in halves; of what gives power steadily, how
 * many give it now; of what burns for it, how many in reach still have fuel.
 */
interface Tally {
  readonly lit: Int32Array;
  readonly dark: Int32Array;
  readonly drawn: Int32Array;
  readonly least: Int32Array;
  readonly most: Int32Array;
  readonly giving: Int32Array;
  readonly fuelled: Int32Array;
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
    giving: new Int32Array(n),
    fuelled: new Int32Array(n),
  };
  for (let i = 0; i < y.kind.length; i++) {
    const k = y.kind[i] ?? NONE;
    // A piece of more than one tile counts once, by its own tile, in reach if any of its tiles is.
    if (k === NONE || (y.part[i] !== 0 && y.part[i] !== OWN)) continue;
    const reached = y.part[i] === 0 ? lit[i] === 1 : litAt(y, i);
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

/** Counts in a piece in reach that gives power: one that gives it steadily and gives it now; one that burns for it and has fuel. */
function givers(t: Tally, y: Yard, i: number, k: number, reached: boolean): void {
  if (!reached) return;
  const steady = RULES[k]?.steady ?? null;
  if (steady !== null && steady(KIT, y, i) > 0) t.giving[k] = of(t.giving, k) + 1;
  if (BURNS[k] && (y.holders.fuel[KIT.holderOf(y, i)] ?? 0) > 0) t.fuelled[k] = of(t.fuelled, k) + 1;
}

/** Takes in what one piece of a kind draws: the least and the most one of the kind draws. */
function widen(t: Tally, k: number, d: number): void {
  if (of(t.least, k) === 0 || d < of(t.least, k)) t.least[k] = d;
  if (d > of(t.most, k)) t.most[k] = d;
}
