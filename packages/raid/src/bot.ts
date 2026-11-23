import { below, mix, pick, type Stream } from "@sequoia-leaf/core";

/**
 * A bot that plays the game through the same actions a member has. It has habits rather than
 * cleverness: what it likes, how much it saves, whether it levels or rolls. It exists to try the
 * numbers out in `review/balance.ts`, and it is honest about being a rough player: a person will
 * place figures better than it does.
 */
import type { BoonId } from "./content/boons.ts";
import { type FigureId, FIGURES, specOf, type Stars, starScale, traitsOf } from "./content/figures.ts";
import {
  type ComponentId,
  EMBLEMS,
  FINISHED,
  type FinishedId,
  holdItem,
  isComponentId,
  isEmblemId,
} from "./content/items.ts";
import { ECONOMY, MAX_LEVEL } from "./content/rooms.ts";
import { stepFor, TRAIT_IDS, type TraitId } from "./content/traits.ts";
import { arrange } from "./formation.ts";
import { SEATS } from "./hex.ts";
import { countTraits } from "./party.ts";
import {
  beginFight,
  buy,
  buyXp,
  choose,
  fieldCap,
  fielded,
  giveItem,
  move,
  type Piece,
  pieces,
  priceOf,
  type Run,
  type RunOptions,
  rustle,
  rustleCost,
  sell,
  startRun,
  type Taken,
  takeTakings,
  toBench,
} from "./run.ts";

/**
 * The actions the bot plans with. Played directly they are the run's own; a page that plays through
 * Leaf hands it ones that act on its copy and write down the command for each (see `game.ts`).
 */
export interface Hands {
  choose: typeof choose;
  buy: typeof buy;
  sell: typeof sell;
  move: typeof move;
  toBench: typeof toBench;
  rustle: typeof rustle;
  buyXp: typeof buyXp;
  giveItem: typeof giveItem;
}
/** The run's own actions. */
export const DIRECT: Hands = { choose, buy, sell, move, toBench, rustle, buyXp, giveItem };

export interface Habit {
  name: string;
  /** How much it likes each trait: 1 where it has no view. */
  taste: Partial<Record<TraitId, number>>;
  /** Acorns it tries to keep in hand, for the interest, in each of the three wings. */
  keeps: readonly [number, number, number];
  /** How it buys experience: whenever it has acorns to spare, only to keep up with the room, or never. */
  levels: "keen" | "par" | "never";
  /** How many times a room it will pay to rustle when it has acorns to spare. */
  rustles: number;
  /** How much a second and third copy matter to it: 1 plain, more for one who chases stars. */
  chases: number;
  /** Buys whatever is there, stands anywhere, and forgets its items. */
  careless: boolean;
}

/** A plain, sensible player with no favourites. */
export const SENSIBLE: Habit = {
  name: "sensible",
  taste: {},
  keeps: [0, 10, 20],
  levels: "par",
  rustles: 2,
  chases: 1,
  careless: false,
};
/** Saves hard for the interest and spends it on levels. */
export const SAVER: Habit = { ...SENSIBLE, name: "saver", keeps: [10, 20, 10], levels: "keen", rustles: 1 };
/** Stays low and rolls for three stars. */
export const ROLLER: Habit = {
  ...SENSIBLE,
  name: "roller",
  keeps: [0, 10, 10],
  levels: "never",
  rustles: 8,
  chases: 3,
};
/** Takes what it is given. */
export const CARELESS: Habit = {
  name: "careless",
  taste: {},
  keeps: [0, 0, 0],
  levels: "never",
  rustles: 0,
  chases: 1,
  careless: true,
};
/** A sensible player with a favourite trait. */
export const fondOf = (trait: TraitId): Habit => ({ ...SENSIBLE, name: trait, taste: { [trait]: 3 } });

/** The level a sensible player has by each room. */
const PAR = [1, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7] as const;
/** Roughly what a figure is worth on the board, by tier and by stars. */
const TIER_WORTH = [1, 1.5, 2.1, 3, 4.2] as const;
const STAR_WORTH = [1, 1.9, 3.6] as const;
/** Which of the cheapest it would rather set out with, all else equal: ones that can stand alone. */
const STARTERS: readonly FigureId[] = ["crab7", "emberkit", "barrowgnome", "worm", "finch", "moth", "mossmote"];

const liking = (habit: Habit, kind: FigureId): number => {
  let most = 0;
  for (const trait of traitsOf(kind)) most = Math.max(most, habit.taste[trait] ?? 1);
  return most;
};
const worthOf = (habit: Habit, kind: FigureId, stars: Stars): number =>
  (TIER_WORTH[FIGURES[kind].tier - 1] ?? 1) * (STAR_WORTH[stars - 1] ?? 1) * (0.7 + 0.3 * liking(habit, kind));

/** How good a set of figures is as a party: what each is worth, and something for every trait step switched on. */
function partyScore(habit: Habit, party: readonly Piece[]): number {
  let score = 0;
  for (const p of party) score += worthOf(habit, p.kind, p.stars);
  const counts = countTraits(party);
  for (const trait of TRAIT_IDS) {
    const step = stepFor(trait, counts[trait] ?? 0);
    if (step > 0) score += step * 1.1 * (habit.taste[trait] ?? 1);
  }
  return score;
}
/** The best party of a size it can find among some figures: one at a time, whoever adds most. */
function bestParty(habit: Habit, all: readonly Piece[], size: number): Piece[] {
  const party: Piece[] = [];
  const rest = all.slice();
  while (party.length < size && rest.length > 0) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i];
      if (!p) continue;
      party.push(p);
      const score = partyScore(habit, party);
      party.pop();
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const [taken] = rest.splice(best, 1);
    if (!taken) break;
    party.push(taken);
  }
  return party;
}

const floorOf = (run: Run, habit: Habit): number => {
  // Near the end, or near going home, there is nothing to save for.
  if (run.room >= 13 || run.resolve <= 8) return 0;
  return habit.keeps[Math.min(2, Math.floor(run.room / 5))] ?? 0;
};

// ---------- choosing ----------

const BOON_LIKES: Record<BoonId, number> = {
  extrachair: 10,
  secondwind: 7,
  basket: 6.5,
  headstart: 6,
  quickstudy: 6,
  formation: 5.5,
  blanket: 5,
  windfall: 5,
  deeppockets: 4.5,
  smallfry: 4,
  regular: 4,
  widestall: 4,
  haggler: 4,
  embercharm: 3,
  mosscharm: 3,
  mistcharm: 3,
  burrowcharm: 3,
  feathercharm: 3,
  crabcharm: 3,
  gnomecharm: 3,
};
function likesBoon(run: Run, habit: Habit, boon: BoonId): number {
  let score = BOON_LIKES[boon];
  if (isEmblemId(boon)) {
    const kin = EMBLEMS[boon];
    const count = countTraits(run.board.flatMap((p) => (p ? [p] : [])))[kin] ?? 0;
    if (stepFor(kin, count + 1) > stepFor(kin, count)) score += 5;
    score *= habit.taste[kin] ?? 1;
  }
  if (boon === "blanket" && run.resolve <= 12) score += 3;
  if (boon === "deeppockets" && habit.levels === "keen") score += 3;
  if ((boon === "regular" || boon === "widestall") && habit.rustles > 4) score += 3;
  if (boon === "smallfry") score = run.board.filter((p) => p && FIGURES[p.kind].tier <= 2).length * 1.3;
  return score;
}
function likesComponent(run: Run, item: ComponentId): number {
  const own = pieces(run);
  const loose = own.some((p) => p.items.some(isComponentId)) || run.items.some(isComponentId);
  const casters = own.filter((p) => FIGURES[p.kind].calling === "sage" || FIGURES[p.kind].calling === "mender").length;
  const base = item === "glowcap" ? 2 + casters * 0.4 : item === "thorn" || item === "plume" ? 3 : 2.6;
  return base + (loose ? 0.2 : 0);
}
function settleChoices(run: Run, habit: Habit, s: Stream, hands: Hands): void {
  for (let guard = 0; guard < 12; guard++) {
    const choice = run.choices[0];
    if (!choice) return;
    let best = 0;
    if (habit.careless) best = below(s, choice.options.length);
    else {
      let bestScore = -Infinity;
      choice.options.forEach((option, i) => {
        let score = 0;
        if (choice.kind === "starter") {
          const kind = choice.options[i];
          if (kind !== undefined) score = liking(habit, kind) * 10 - STARTERS.indexOf(kind);
        } else if (choice.kind === "boon") {
          const boon = choice.options[i];
          if (boon !== undefined) score = likesBoon(run, habit, boon);
        } else if (isComponentId(option)) score = likesComponent(run, option);
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      });
    }
    if (!hands.choose(run, best).ok) return;
  }
}

// ---------- shopping ----------

/** How much it wants an offer: what it would add to its best party, and something for being a second or third copy. */
function wants(run: Run, habit: Habit, kind: FigureId, before: number): number {
  const own = pieces(run);
  const cap = fieldCap(run);
  const twins = own.filter((p) => p.kind === kind && p.stars === 1).length;
  const better = own.some((p) => p.kind === kind && p.stars > 1);
  if (twins >= 2) return 6 + FIGURES[kind].tier * habit.chases;
  const guest: Piece = { id: -1, kind, stars: 1, items: [], fed: 0 };
  const after = partyScore(habit, bestParty(habit, [...own, guest], cap));
  return after - before + (twins === 1 ? 0.7 * habit.chases : 0) + (better ? 0.4 * habit.chases : 0);
}
/** Sells whoever on the bench is doing least: not in the best party, and not half of a pair. */
function sellSpare(run: Run, habit: Habit, keep: number, hands: Hands): boolean {
  const own = pieces(run);
  const best = new Set(bestParty(habit, own, fieldCap(run)).map((p) => p.id));
  let worst = -1;
  let worstScore = Infinity;
  run.bench.forEach((p, slot) => {
    if (!p || best.has(p.id)) return;
    const twins = own.filter((o) => o.kind === p.kind && o.stars === p.stars).length;
    const score = worthOf(habit, p.kind, p.stars) + (twins > 1 ? 2 * habit.chases : 0);
    if (score < worstScore) {
      worst = slot;
      worstScore = score;
    }
  });
  if (worst < 0 || worstScore > keep) return false;
  return hands.sell(run, { on: "bench", at: worst }).ok;
}

function shop(run: Run, habit: Habit, hands: Hands): void {
  const floor = floorOf(run, habit);
  let paidRustles = 0;
  for (let guard = 0; guard < 80; guard++) {
    // The offer it wants most, if it can pay for it.
    let best = -1;
    let bestWant = 0;
    const before = partyScore(habit, bestParty(habit, pieces(run), fieldCap(run)));
    run.stall.forEach((kind, i) => {
      if (!kind) return;
      const cost = priceOf(run, i);
      if (cost > run.acorns) return;
      const want = wants(run, habit, kind, before);
      const pressing = want >= 6 || pieces(run).length < fieldCap(run);
      if (!pressing && (run.acorns - cost < floor || want < 0.3 * cost)) return;
      if (want / Math.max(1, cost) > bestWant) {
        best = i;
        bestWant = want / Math.max(1, cost);
      }
    });
    if (best >= 0) {
      if (!run.bench.includes(null)) sellSpare(run, habit, Infinity, hands);
      if (hands.buy(run, best).ok) continue;
    }
    // Experience, by its habit.
    const short = pieces(run).length < fieldCap(run);
    const par = PAR[Math.min(run.room, PAR.length - 1)] ?? MAX_LEVEL;
    const wantsLevel =
      !short &&
      run.level < MAX_LEVEL &&
      (habit.levels === "keen" || (habit.levels === "par" && run.level < par)) &&
      run.acorns - ECONOMY.xpCost >= floor;
    if (wantsLevel && hands.buyXp(run).ok) continue;
    // New offers: the free ones always, paid ones while there are acorns to spare.
    const cost = rustleCost(run);
    if (cost === 0 && hands.rustle(run).ok) continue;
    if (paidRustles < habit.rustles + (short ? 2 : 0) && run.acorns - cost >= Math.max(floor, short ? 1 : 2)) {
      if (hands.rustle(run).ok) {
        paidRustles++;
        continue;
      }
    }
    break;
  }
  // Anyone on the bench who is neither in the party nor half of a pair goes home.
  for (let guard = 0; guard < ECONOMY.bench; guard++) if (!sellSpare(run, habit, 2.5, hands)) break;
}

/** Buys whatever it can reach, in the order it comes. */
function shopCarelessly(run: Run, s: Stream, hands: Hands): void {
  for (let guard = 0; guard < 20; guard++) {
    const able = run.stall.flatMap((kind, i) => (kind && priceOf(run, i) <= run.acorns ? [i] : []));
    if (able.length === 0 || !run.bench.includes(null)) break;
    if (!hands.buy(run, pick(s, able)).ok) break;
  }
  // With a full bench it sells one at random to make room for next time.
  if (!run.bench.includes(null)) hands.sell(run, { on: "bench", at: below(s, run.bench.length) });
}

// ---------- seating and items ----------

function seatParty(run: Run, habit: Habit, hands: Hands): void {
  const own = pieces(run);
  const party = bestParty(habit, own, fieldCap(run));
  const counts = countTraits(party);
  const seats = arrange(
    party.map((p) => ({ kind: p.kind, health: specOf(p.kind).hp * starScale(p.stars) })),
    stepFor("sneak", counts.sneak ?? 0) > 0,
  );
  const want = new Map<number, number>();
  party.forEach((p, i) => want.set(p.id, seats[i] ?? i));
  // Whoever is on the board and not wanted changes places with somebody wanted, or sits down.
  run.board.forEach((p, seat) => {
    if (!p || want.has(p.id)) return;
    const slot = run.bench.findIndex((b) => b !== null && want.has(b.id));
    if (slot >= 0) hands.move(run, { on: "bench", at: slot }, { on: "board", at: seat });
    else if (!hands.toBench(run, seat).ok) hands.sell(run, { on: "board", at: seat });
  });
  run.bench.forEach((p, slot) => {
    if (!p || !want.has(p.id)) return;
    const seat = run.board.indexOf(null);
    if (seat >= 0) hands.move(run, { on: "bench", at: slot }, { on: "board", at: seat });
  });
  // Then everyone to their own seat: each move puts at least one of them right.
  for (let guard = 0; guard < 2 * SEATS; guard++) {
    const from = run.board.findIndex((p, seat) => p !== null && want.get(p.id) !== seat && want.has(p.id));
    const to = from >= 0 ? want.get(run.board[from]?.id ?? -1) : undefined;
    if (from < 0 || to === undefined) break;
    if (!hands.move(run, { on: "board", at: from }, { on: "board", at: to }).ok) break;
  }
}
function seatCarelessly(run: Run, s: Stream, hands: Hands): void {
  run.bench.forEach((p, slot) => {
    if (!p || fielded(run) >= fieldCap(run)) return;
    const free = run.board.flatMap((b, seat) => (b ? [] : [seat]));
    hands.move(run, { on: "bench", at: slot }, { on: "board", at: pick(s, free) });
  });
}

type Suits = "hitter" | "caster" | "wall";
const suitOf = (item: ComponentId | FinishedId): Suits => {
  const part: ComponentId = isComponentId(item) ? item : FINISHED[item].made[0];
  return part === "thorn" || part === "plume" ? "hitter" : part === "glowcap" ? "caster" : "wall";
};
/** How well a figure suits a kind of item: more is better, 0 is not at all. */
function fits(p: Piece, suits: Suits): number {
  const f = FIGURES[p.kind];
  if (suits === "hitter") {
    if (f.attack === 0) return 0;
    return f.calling === "fang" || f.calling === "slinger" || f.calling === "sneak"
      ? 3
      : f.calling === "bulwark"
        ? 1
        : 0.5;
  }
  if (suits === "caster") return f.calling === "sage" ? 3 : f.calling === "mender" ? 2.5 : 1;
  return f.calling === "bulwark" ? 3 : f.range <= 1 ? 2 : 1;
}
function handOutItems(run: Run, habit: Habit, hands: Hands): void {
  // Components and finished items first, the first on the item bench first.
  for (let guard = 0; guard < 30; guard++) {
    const at = run.items.findIndex((item) => !isEmblemId(item));
    const item = run.items[at];
    if (item === undefined || isEmblemId(item)) break;
    const suits = suitOf(item);
    let best = -1;
    let bestScore = 0;
    run.board.forEach((p, seat) => {
      if (!p || "refused" in holdItem(p, item)) return;
      // Somebody already holding a loose component can forge with it now.
      const forges = isComponentId(item) && p.items.some(isComponentId) ? 1.5 : 1;
      const score = fits(p, suits) * forges * worthOf(habit, p.kind, p.stars);
      if (score > bestScore) {
        best = seat;
        bestScore = score;
      }
    });
    if (best < 0 || !hands.giveItem(run, at, { on: "board", at: best }).ok) break;
  }
  // Then each emblem, to the worthiest figure on the board that can take it.
  for (let at = run.items.length - 1; at >= 0; at--) {
    const item = run.items[at];
    if (!isEmblemId(item)) continue;
    let best = -1;
    let bestScore = 0;
    run.board.forEach((p, seat) => {
      if (!p || "refused" in holdItem(p, item)) return;
      const score = worthOf(habit, p.kind, p.stars);
      if (score > bestScore) {
        best = seat;
        bestScore = score;
      }
    });
    if (best >= 0) hands.giveItem(run, at, { on: "board", at: best });
  }
}

// ---------- playing ----------

/** Does everything a player does before a fight: settles what is waiting to be chosen, shops, seats the party, hands out items. */
export function planRoom(run: Run, habit: Habit, hands: Hands = DIRECT): void {
  if (run.phase !== "plan") return;
  const s: Stream = { rng: mix(run.seed, 9000 + run.record.length) };
  settleChoices(run, habit, s, hands);
  if (habit.careless) {
    shopCarelessly(run, s, hands);
    seatCarelessly(run, s, hands);
    return;
  }
  shop(run, habit, hands);
  seatParty(run, habit, hands);
  handOutItems(run, habit, hands);
}
/** Plans a room, fights it and takes the takings. */
export function playRoom(run: Run, habit: Habit): Taken {
  planRoom(run, habit);
  const begun = beginFight(run);
  if (!begun.ok) return begun;
  return takeTakings(run);
}
/** Plays a whole run from a seed. */
export function playRun(seed: number, habit: Habit, options: RunOptions = {}): Run {
  const run = startRun(seed, options);
  for (let guard = 0; guard < 200 && run.phase !== "over"; guard++) {
    if (!playRoom(run, habit).ok) break;
  }
  return run;
}
