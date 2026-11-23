/**
 * What a played slice comes to: a row for each goal in the order it was done, a row for each tier
 * beside the time it is meant to take, and one for the whole slice, each split into building,
 * waiting for Coins and waiting for deliveries (or folios). A tier runs from when it opened to when
 * its commission was done and the next opened; research still being studied then is listed after
 * it, and summed on a line of its own, not counted in the tier. As data for `--json`, and as a
 * table; and, for several seeds played, the least, the middle and the most of each tier (`seeds`).
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
  /** Research done after its tier's commission, once the next tier was open. */
  readonly after: boolean;
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
  /** When its commission was done, or when the player stopped, if it was not. */
  readonly to: number;
  readonly done: boolean;
  /** The time the design means the tier to take, in minutes: least and most; nothing for a tier with no target yet. */
  readonly target: Target | null;
}

/** Research of a tier and below still to do when its commission was done: folios, and the minutes it then took. */
export interface Left {
  readonly tier: number;
  readonly folios: number;
  /** Minutes from the commission to the last of it known, or nothing if the player stopped first. */
  readonly minutes: number | null;
}

export interface Report {
  readonly seed: number;
  readonly folios: number;
  readonly goals: readonly GoalRow[];
  readonly tiers: readonly TierRow[];
  readonly left: readonly Left[];
  readonly slice: Split & Purse & { readonly swaps: number };
  readonly stuck: string | null;
}

/** Least and most minutes. */
export type Target = readonly [number, number];

/**
 * What the design means each tier of the slice to take, in minutes (`WORKS-FOUNDATIONS.md`). Tier 0
 * is the first design's four lessons, which its play-testers took about 40 minutes over. A tier
 * played that has none here is printed without one.
 */
export const TARGETS: readonly Target[] = [
  [35, 40],
  [50, 60],
  [90, 120],
  [240, 300],
];

/** The tiers that have nodes: those a play goes through, each to its commission. */
const TIERS = [...new Set(F.NODES.map((n) => n.tier))].toSorted((a, b) => a - b);

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

export function report(game: Game, seed: number, folios: number): Report {
  const goals = game.goals.map((p): GoalRow => {
    const info = F.GOALS[p.goal];
    const tier = info?.tier ?? 0;
    const next = game.tiers[tier + 1];
    return {
      tier,
      goal: info?.id ?? "",
      title: info?.title ?? "",
      kind: info?.kind ?? "",
      after: info?.kind === "research" && next !== undefined && p.done > next,
      came: minutes(p.came),
      done: minutes(p.done),
      ...split(game, p.came, p.done),
      pieces: p.pieces,
      purse: p.purse,
      power: `${p.power.draws}/${p.power.gives}`,
      bought: [...p.bought].map(([what, n]) => (n > 0 ? `${n} ${what}` : what)).join(", "),
    };
  });
  const tiers = TIERS.flatMap((t): TierRow[] => {
    const from = game.tiers[t];
    if (from === undefined) return [];
    const next = game.tiers[t + 1];
    const to = next ?? game.end;
    return [
      {
        tier: t,
        from: minutes(from),
        to: minutes(to),
        done: next !== undefined,
        target: TARGETS[t] ?? null,
        ...split(game, from, to),
        ...purse(game, from, to),
      },
    ];
  });
  const left = game.left.flatMap((n, t): Left[] => {
    const at = game.tiers[t];
    if (t === 0 || n === 0 || at === undefined) return [];
    const theirs = game.goals.filter((p) => F.GOALS[p.goal]?.kind === "research" && (F.GOALS[p.goal]?.tier ?? 0) < t);
    const last = Math.max(at, ...theirs.map((p) => p.done));
    // The player plays on until every piece of research in its list is known, unless it stops short.
    return [{ tier: t - 1, folios: n, minutes: game.stuck === null ? minutes(last - at) : null }];
  });
  const slice = { ...split(game, 0, game.end), ...purse(game, -1, game.end), swaps: game.swaps };
  return { seed, folios, goals, tiers, left, slice, stuck: game.stuck };
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
const range = (target: Target | null): string =>
  target === null ? "none yet" : target[0] === target[1] ? `${target[0]}` : `${target[0]} to ${target[1]}`;

/** The line that says what research was still to do when a tier's commission was done. */
function leftLine(l: Left, folios: number): string {
  const took = l.minutes === null ? "not all known when the player stopped" : `${m(l.minutes)} minutes`;
  return `Research still to do when tier ${l.tier}'s commission was done: ${l.folios} folios, ${took} at ${folios} folios a minute.`;
}

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
          `${g.kind === "research" ? (g.after ? "~ after: " : "~ ") : ""}${g.title}`.slice(0, 28),
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
          `${row.tier}${row.done ? "" : "*"}`,
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
  if (r.tiers.some((row) => !row.done)) out.push("* its commission was not done");
  for (const l of r.left) out.push(leftLine(l, r.folios));
  const s = r.slice;
  out.push(
    `\nThe slice: ${m(s.minutes)} minutes (${m(s.minutes / 60)} hours): building ${m(s.building)}, waiting for Coins ${m(s.coins)}, waiting for deliveries and folios ${m(s.waiting)}.`,
    `Coins: ${s.fromOrders} from ${s.orders} orders handed over (${s.swaps} swapped), ${s.fromGoals} from goals, ${s.fromDepot} from the depot; ${s.spent} spent. Seed ${r.seed}, Studies for ${r.folios} folios a minute.`,
  );
  if (r.stuck) out.push(`\nThe player stopped short: ${r.stuck}`);
  return out.join("\n");
}

/** The least, the middle and the most of some numbers; the middle of an even count is the mean of the two in the middle. */
export interface Spread {
  readonly least: number;
  readonly middle: number;
  readonly most: number;
}

export function spread(ns: readonly number[]): Spread {
  const s = ns.toSorted((a, b) => a - b);
  if (s.length === 0) return { least: 0, middle: 0, most: 0 };
  const lo = s[Math.floor((s.length - 1) / 2)] ?? 0;
  const hi = s[Math.ceil((s.length - 1) / 2)] ?? 0;
  return { least: s[0] ?? 0, middle: Math.round(((lo + hi) / 2) * 10) / 10, most: s.at(-1) ?? 0 };
}

/** A tier over several seeds: how many finished it, and the spread of its minutes, building and waiting (for Coins and for deliveries together). */
export interface SeedsRow {
  readonly tier: number;
  readonly seeds: number;
  readonly minutes: Spread;
  readonly building: Spread;
  readonly waiting: Spread;
  readonly target: Target | null;
}

export interface Seeds {
  readonly folios: number;
  readonly seeds: readonly number[];
  readonly tiers: readonly SeedsRow[];
  readonly left: readonly { readonly tier: number; readonly folios: Spread; readonly minutes: Spread }[];
  readonly slice: Spread;
  /** The seeds that stopped short, and why. */
  readonly stuck: readonly { readonly seed: number; readonly why: string }[];
}

/** Several seeds' reports, played at one pace, as a row for each tier: only seeds that finished a tier count in it. */
export function seeds(reports: readonly Report[]): Seeds {
  const tiers = TIERS.flatMap((t): SeedsRow[] => {
    const rows = reports.flatMap((r) => r.tiers.filter((row) => row.tier === t && row.done));
    if (rows.length === 0) return [];
    const target = TARGETS[t] ?? null;
    return [
      {
        tier: t,
        seeds: rows.length,
        minutes: spread(rows.map((row) => row.minutes)),
        building: spread(rows.map((row) => row.building)),
        waiting: spread(rows.map((row) => Math.round((row.coins + row.waiting) * 10) / 10)),
        target,
      },
    ];
  });
  const left = [...new Set(reports.flatMap((r) => r.left.map((l) => l.tier)))].map((tier) => {
    const ls = reports.flatMap((r) => r.left.filter((l) => l.tier === tier));
    return {
      tier,
      folios: spread(ls.map((l) => l.folios)),
      minutes: spread(ls.flatMap((l) => (l.minutes === null ? [] : [l.minutes]))),
    };
  });
  return {
    folios: reports[0]?.folios ?? 0,
    seeds: reports.map((r) => r.seed),
    tiers,
    left,
    slice: spread(reports.filter((r) => r.stuck === null).map((r) => r.slice.minutes)),
    stuck: reports.flatMap((r) => (r.stuck === null ? [] : [{ seed: r.seed, why: r.stuck.split("\n")[0] ?? "" }])),
  };
}

/** Several seeds as a table to read. */
export function seedsText(s: Seeds): string {
  const three = (x: Spread): string => `${m(x.least).padStart(7)} ${m(x.middle).padStart(7)} ${m(x.most).padStart(7)}`;
  const out = [
    `Seeds ${s.seeds.join(", ")}, Studies for ${s.folios} folios a minute: the least, the middle and the most of each.`,
    "",
    `tier  seeds  ${"minutes".padEnd(23)}  ${"build".padEnd(23)}  ${"waiting".padEnd(23)}  meant to take`,
  ];
  for (const row of s.tiers)
    out.push(
      `${String(row.tier).padEnd(4)}  ${String(row.seeds).padStart(5)}  ${three(row.minutes)}  ${three(row.building)}  ${three(row.waiting)}  ${range(row.target).padStart(13)}`,
    );
  for (const l of s.left)
    out.push(
      `Research still to do when tier ${l.tier}'s commission was done: ${m(l.folios.least)} to ${m(l.folios.most)} folios, ${m(l.minutes.least)} to ${m(l.minutes.most)} minutes (middle ${m(l.minutes.middle)}).`,
    );
  const finished = s.seeds.length - s.stuck.length;
  if (finished > 0)
    out.push(
      `The slice, for the ${finished} seeds that played to the end: ${m(s.slice.least)} to ${m(s.slice.most)} minutes (middle ${m(s.slice.middle)}).`,
    );
  for (const k of s.stuck) out.push(`Seed ${k.seed} stopped short: ${k.why}`);
  return out.join("\n");
}
