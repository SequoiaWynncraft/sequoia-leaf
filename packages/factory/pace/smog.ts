/**
 * The smog of a tier's estimate (`estimate.ts`), as SPEC-2 section 8 asks the pace script to print it:
 * on the plot the tier's dirty work stands on if the player buys no second plot, the most smog it
 * reaches and the share of ticks its machines lose.
 *
 * Every dirty machine of the tier's lines stands there: the folio lines for as long as the research
 * runs, and each node's lines for its minutes in turn, from the opening. Each makes what it adds for
 * each thing it finishes, at the share of its pace the plot's smog lets it. A mix's runs are those
 * for the most it must give of any one of its things for that goal, each thing's summed over every
 * line that wants it; the rest of the mix leaves the plot (sold, cracked or burned elsewhere). The
 * plot is counted every 100 ticks by the rules' own numbers (`SMOG`, `stepOf`, `shareAt`), with the
 * redwoods that stand on it.
 */
import * as F from "../src/index.ts";

/**
 * The plot each tier's dirty work stands on with no second plot bought, and the share of ticks SPEC-2
 * means it to lose, in per cent: none said for tiers 7 and 8, whose figures are printed all the same
 * (growers, chargers and pads make none; the breakers and stills of their folio lines, copper, pitch,
 * spirit and creosote do).
 */
export const SMOG_FROM: Readonly<
  Record<number, { readonly plot: F.PlotName; readonly lost?: readonly [number, number] }>
> = {
  5: { plot: "workings", lost: [0, 0] },
  6: { plot: "workings", lost: [5, 30] },
  7: { plot: "workings" },
  8: { plot: "workings" },
};

/** What grade III lines making each thing at so many a minute make of smog a minute. */
export function linesSmog(rates: readonly (readonly [F.Item, number])[]): number {
  let made = 0;
  // The runs each of a mix's things asks for, summed over every branch that wants it.
  const runs = new Map<F.Kind, Map<F.Item, number>>();
  const walk = (b: F.Branch): void => {
    if (F.MIX_OF[b.kind]?.gives.includes(b.item)) {
      const by = runs.get(b.kind) ?? new Map<F.Item, number>();
      runs.set(b.kind, by.set(b.item, (by.get(b.item) ?? 0) + (b.from[0]?.perMinute ?? 0)));
    } else made += (F.SMOG_OF[b.kind] ?? 0) * b.perMinute;
    b.from.forEach(walk);
  };
  for (const [n, rate] of rates) if (rate > 0) walk(F.tree(n, rate, 3));
  for (const [k, by] of runs) made += (F.SMOG_OF[k] ?? 0) * Math.max(0, ...by.values());
  return made;
}

export interface SmogFigure {
  /** The plot's name. */
  readonly plot: string;
  /** The most smog it reached. */
  readonly most: number;
  /** The share of ticks its machines lost, 0 to 1. */
  readonly lost: number;
  /** What SPEC-2 means it to lose, in per cent, where it says. */
  readonly target: readonly [number, number] | null;
}

/**
 * The smog figure of a tier: its nodes up to its commission, each built for `per` minutes, and its
 * folio lines (`folios`, each at `rate` a minute) for `research` minutes; or nothing for a tier with
 * no plot named for it.
 */
export function smogFigure(
  tier: number,
  nodes: readonly F.Goal[],
  per: number,
  folios: readonly F.Item[],
  rate: number,
  research: number,
): SmogFigure | null {
  const at = SMOG_FROM[tier];
  if (!at) return null;
  const y = F.create({ tier });
  const plot = F.plot(at.plot);
  const clears = F.clearsAt(F.standingOn(y, plot));
  const study = linesSmog(folios.map((k) => [k, rate]));
  const building = nodes.map((g) => {
    const want = F.GOALS[g]?.want ?? F.counts();
    return linesSmog(F.ALL_ITEMS.map((n) => [n, (want[n] ?? 0) / per]));
  });
  const every = F.SMOG.every / F.MINUTE;
  const total = Math.max(research, nodes.length * per);
  let level = 0;
  let most = 0;
  let lost = 0;
  let counts = 0;
  for (let t = 0; t < total; t += every) {
    const share = F.shareAt(F.stepOf(level));
    const made = ((t < research ? study : 0) + (building[Math.floor(t / per)] ?? 0)) * every * share;
    level = Math.min(F.SMOG.most, Math.max(0, level + made - clears));
    most = Math.max(most, level);
    lost += 1 - share;
    counts++;
  }
  const name = y.land.plots.find((p) => p.plot === plot)?.name ?? at.plot;
  return { plot: name, most, lost: counts === 0 ? 0 : lost / counts, target: at.lost ?? null };
}
