/**
 * What a played slice comes to: a row for each goal in the order it was done, a row for each tier
 * beside the time it is meant to take, and one for the whole slice, each split into building,
 * waiting for Coins and waiting for deliveries (or folios). As data for `--json`, and as a table.
 */
import * as F from "../src/index.ts";
import type { Doing, Game } from "./player.ts";

/** Minutes of the yard's clock, split by what the player was doing. */
export interface Split {
  readonly minutes: number;
  readonly building: number;
  readonly coins: number;
  readonly waiting: number;
}

export interface GoalRow extends Split {
  readonly tier: number;
  readonly goal: string;
  readonly title: string;
  readonly kind: string;
  readonly came: number;
  readonly done: number;
  readonly pieces: number;
  readonly purse: number;
  readonly power: string;
  readonly bought: string;
}

/** Coins in a stretch: from orders handed over (and how many), goals done and the depot's share; and spent. */
export interface Purse {
  readonly orders: number;
  readonly fromOrders: number;
  readonly fromGoals: number;
  readonly fromDepot: number;
  readonly spent: number;
}

export interface TierRow extends Split, Purse {
  readonly tier: number;
  readonly from: number;
  readonly to: number;
  /** The time the design means the tier to take, in minutes: least and most. */
  readonly target: readonly [number, number];
}

export interface Report {
  readonly seed: number;
  readonly goals: readonly GoalRow[];
  readonly tiers: readonly TierRow[];
  readonly slice: Split & Purse & { readonly swaps: number };
  readonly stuck: string | null;
}

/** What the design means each tier of the slice to take, in minutes (`WORKS-FOUNDATIONS.md`). */
export const TARGETS: readonly (readonly [number, number])[] = [
  [20, 20],
  [60, 60],
  [120, 120],
  [240, 300],
];

const minutes = (ticks: number): number => Math.round((ticks / F.MINUTE) * 10) / 10;

/** A stretch of the yard's clock, split by what the player was doing in it. */
function split(game: Game, from: number, to: number): Split {
  const by: Record<Doing, number> = { build: 0, coins: 0, wait: 0 };
  for (const s of game.spans) {
    const n = Math.min(to, s.to) - Math.max(from, s.from);
    if (n > 0) by[s.doing] += n;
  }
  return {
    minutes: minutes(to - from),
    building: minutes(by.build),
    coins: minutes(by.coins),
    waiting: minutes(by.wait),
  };
}

/** The Coins of a stretch of the yard's clock, from its first tick to its last. */
function purse(game: Game, from: number, to: number): Purse {
  const within = game.coins.filter((c) => c.tick > from && c.tick <= to);
  const sum = (what: (typeof within)[number]["what"]): number =>
    within.reduce((n, c) => n + (c.what === what ? c.coins : 0), 0);
  return {
    orders: within.filter((c) => c.what === "order").length,
    fromOrders: sum("order"),
    fromGoals: sum("goal"),
    fromDepot: sum("depot"),
    spent: sum("spent"),
  };
}

export function report(game: Game, seed: number): Report {
  const goals = game.goals.map((p): GoalRow => {
    const info = F.GOALS[p.goal];
    return {
      tier: info?.tier ?? 0,
      goal: info?.id ?? "",
      title: info?.title ?? "",
      kind: info?.kind ?? "",
      came: minutes(p.came),
      done: minutes(p.done),
      ...split(game, p.came, p.done),
      pieces: p.pieces,
      purse: p.purse,
      power: `${p.power.draws}/${p.power.gives}`,
      bought: [...p.bought].map(([what, n]) => (n > 0 ? `${n} ${what}` : what)).join(", "),
    };
  });
  // A tier runs from when it opened to when its last goal was done: research of a tier may go on after the next opens.
  const tiers = TARGETS.flatMap((target, t): TierRow[] => {
    const from = game.tiers[t];
    if (from === undefined) return [];
    const last = Math.max(...game.goals.filter((p) => F.GOALS[p.goal]?.tier === t).map((p) => p.done));
    const to = Math.max(game.tiers[t + 1] ?? game.end, Number.isFinite(last) ? last : 0);
    return [
      { tier: t, from: minutes(from), to: minutes(to), target, ...split(game, from, to), ...purse(game, from, to) },
    ];
  });
  const slice = { ...split(game, 0, game.end), ...purse(game, -1, game.end), swaps: game.swaps };
  return { seed, goals, tiers, slice, stuck: game.stuck };
}

const cols = (cells: readonly (string | number)[], widths: readonly number[]): string =>
  cells
    .map((c, k) => {
      const w = widths[k] ?? 0;
      return typeof c === "number" ? String(c).padStart(w) : c.padEnd(w);
    })
    .join("  ")
    .trimEnd();
const m = (n: number): string => n.toFixed(1);
const range = (target: readonly [number, number]): string =>
  target[0] === target[1] ? `${target[0]}` : `${target[0]} to ${target[1]}`;

/** The report as a table to read. */
export function text(r: Report): string {
  const out: string[] = [];
  const w = [4, 28, 7, 7, 7, 7, 7, 6, 6, 7, 0];
  out.push(
    cols(["tier", "goal", "came", "done", "build", "coins", "wait", "pieces", "purse", "power", "bought for it"], w),
  );
  for (const g of r.goals)
    out.push(
      cols(
        [
          String(g.tier),
          `${g.kind === "research" ? "~ " : ""}${g.title}`.slice(0, 28),
          m(g.came).padStart(7),
          m(g.done).padStart(7),
          m(g.building).padStart(7),
          m(g.coins).padStart(7),
          m(g.waiting).padStart(7),
          g.pieces,
          g.purse,
          g.power.padStart(7),
          g.bought,
        ],
        w,
      ),
    );
  out.push("");
  const t = [4, 8, 8, 8, 8, 8, 8, 13, 7, 11, 10, 10, 6];
  out.push(
    cols(
      [
        "tier",
        "from",
        "to",
        "minutes",
        "build",
        "coins",
        "wait",
        "meant to take",
        "orders",
        "from orders",
        "from goals",
        "from depot",
        "spent",
      ],
      t,
    ),
  );
  for (const row of r.tiers)
    out.push(
      cols(
        [
          String(row.tier),
          m(row.from).padStart(8),
          m(row.to).padStart(8),
          m(row.minutes).padStart(8),
          m(row.building).padStart(8),
          m(row.coins).padStart(8),
          m(row.waiting).padStart(8),
          range(row.target).padStart(13),
          row.orders,
          row.fromOrders,
          row.fromGoals,
          row.fromDepot,
          row.spent,
        ],
        t,
      ),
    );
  const s = r.slice;
  out.push(
    `\nThe slice: ${m(s.minutes)} minutes (${m(s.minutes / 60)} hours): building ${m(s.building)}, waiting for Coins ${m(s.coins)}, waiting for deliveries and folios ${m(s.waiting)}.`,
    `Coins: ${s.fromOrders} from ${s.orders} orders handed over (${s.swaps} swapped), ${s.fromGoals} from goals, ${s.fromDepot} from the depot; ${s.spent} spent. Seed ${r.seed}.`,
  );
  if (r.stuck) out.push(`\nThe player stopped short: ${r.stuck}`);
  return out.join("\n");
}
