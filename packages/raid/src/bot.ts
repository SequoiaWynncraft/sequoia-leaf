import { below, mix, pick, type Stream } from "@sequoia-leaf/core";

import { overfills } from "./chairs.ts";
/**
 * A bot that plays the game through the same actions a member has. It has habits rather than
 * cleverness: what it likes, how much it saves, whether it levels or rolls. It exists to try the
 * numbers out in `review/balance.ts`, and it is honest about being a rough player: a person will
 * place figures better than it does.
 */
import { act, type PlanningCommand } from "./command.ts";
import { type BoonId, giftsTrait } from "./content/boons.ts";
import { type Catalog, catalogOf } from "./content/catalog.ts";
import { type FigureId, figureIn, specOf, type Stars, starScale, traitsOf } from "./content/figures.ts";
import {
  type ComponentId,
  type EmblemId,
  type FinishedId,
  halvesOf,
  isComponentId,
  isEmblemId,
  isFinishedId,
} from "./content/items.ts";
import { holdItem } from "./content/recipes.ts";
import { ECONOMY, MAX_LEVEL } from "./content/rooms.ts";
import { isToolId, type RackItem, type ToolId } from "./content/tools.ts";
import { stepFor, type TraitId, traitNumber } from "./content/traits.ts";
import type { RuleId } from "./content/wilds.ts";
import { lastRoom } from "./endless.ts";
import { arrange } from "./formation.ts";
import { SEATS } from "./hex.ts";
import { chairsUsed, countTraits } from "./party.ts";
import { countOn, kindsOn } from "./racks.ts";
import { roomsFought } from "./record.ts";
import { closedNow } from "./room.ts";
import {
  beginFight,
  type Done,
  fieldCap,
  picksOf,
  type Piece,
  pieces,
  priceOf,
  type Run,
  type RunOptions,
  type RunView,
  rustleCost,
  type Spot,
  startRun,
  type Taken,
  takeTakings,
} from "./run.ts";

/**
 * How the bot plans, on a run `R`: a member's planning command, done. Played directly it is done to
 * the run by its spec (`act`); a page that plays through Leaf hands it one that does it to its copy,
 * which has no streams, and writes the command down (see `game.ts`).
 */
export type Hands<R extends RunView = Run> = (run: R, c: PlanningCommand) => Done;
/** The run's own commands. */
export const DIRECT: Hands = (run, c) => act(run, c);

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

/** The level a sensible player has by each room, and after the fifteenth (an endless run's) the top. */
const PAR = [1, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8] as const;
/** Roughly what a figure is worth on the board, by tier and by stars. */
const TIER_WORTH = [1, 1.5, 2.1, 3, 4.2] as const;
const STAR_WORTH = [1, 1.9, 3.6] as const;
/** Which of the cheapest it would rather set out with, all else equal: ones that can stand alone. */
const STARTERS: readonly FigureId[] = ["crab7", "emberkit", "barrowgnome", "worm", "finch", "moth", "mossmote"];

const liking = (cat: Catalog, habit: Habit, kind: FigureId): number => {
  let most = 0;
  for (const trait of traitsOf(cat, kind)) most = Math.max(most, habit.taste[trait] ?? 1);
  return most;
};
/**
 * The tier a figure is worth on the board: its cost, but a figure that takes no chair (Crab #8) a
 * four-acorn figure's, as its numbers are; it costs no seat, so it is always fielded besides.
 */
const tierWorth = (cat: Catalog, kind: FigureId): number => {
  const f = figureIn(cat, kind);
  return f.chairs === 0 ? Math.min(f.tier, 4) : f.tier;
};
const worthOf = (cat: Catalog, habit: Habit, kind: FigureId, stars: Stars): number =>
  (TIER_WORTH[tierWorth(cat, kind) - 1] ?? 1) * (STAR_WORTH[stars - 1] ?? 1) * (0.7 + 0.3 * liking(cat, habit, kind));

/** How good a set of figures is as a party: what each is worth, and something for every trait step switched on. */
function partyScore(cat: Catalog, habit: Habit, party: readonly Piece[]): number {
  let score = 0;
  for (const p of party) score += worthOf(cat, habit, p.kind, p.stars);
  const counts = countTraits(cat, party);
  for (const trait of cat.ids.traits) {
    const step = stepFor(cat, trait, counts[trait] ?? 0);
    if (step > 0) score += step * 1.1 * (habit.taste[trait] ?? 1);
  }
  return score;
}
/** The best party it can find among some figures for so many chairs: one at a time, whoever adds most and still has a chair. */
function bestParty(cat: Catalog, habit: Habit, all: readonly Piece[], chairs: number): Piece[] {
  const party: Piece[] = [];
  const rest = all.slice();
  while (rest.length > 0) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < rest.length; i++) {
      const p = rest[i];
      if (!p) continue;
      party.push(p);
      // Only who still has a chair (the first copy of a Stowaway needs none).
      const score = chairsUsed(cat, party) > chairs ? -1 : partyScore(cat, habit, party);
      party.pop();
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const [taken] = best < 0 ? [] : rest.splice(best, 1);
    if (!taken) break;
    party.push(taken);
  }
  return party;
}

const floorOf = (run: RunView, habit: Habit): number => {
  // Near the end, or near going home, there is nothing to save for. An endless run has no end.
  if (run.room >= lastRoom(run) - 1 || run.resolve <= 8) return 0;
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
  grootercharm: 3,
  choruscharm: 3,
  graidcharm: 3,
  sneakcharm: 3,
};
function likesBoon(run: RunView, habit: Habit, boon: BoonId): number {
  let score = BOON_LIKES[boon];
  // A charm's emblem grants a trait: more if one more of it would put a step on.
  const kin = giftsTrait(catalogOf(run), boon);
  if (kin !== undefined) {
    const count =
      countTraits(
        catalogOf(run),
        run.board.flatMap((p) => (p ? [p] : [])),
      )[kin] ?? 0;
    if (stepFor(catalogOf(run), kin, count + 1) > stepFor(catalogOf(run), kin, count)) score += 5;
    score *= habit.taste[kin] ?? 1;
  }
  if (boon === "blanket" && run.resolve <= 12) score += 3;
  if (boon === "deeppockets" && habit.levels === "keen") score += 3;
  if ((boon === "regular" || boon === "widestall") && habit.rustles > 4) score += 3;
  if (boon === "smallfry")
    score = run.board.filter((p) => p && figureIn(catalogOf(run), p.kind).tier <= 2).length * 1.3;
  return score;
}
/**
 * How much it likes a Wilds rule, by a plain rule of its own: Fog when more of its board fights up
 * close than from 3 hexes or more, Long Table when it is the other way round, and nothing else
 * above any other (the first card, then).
 */
function likesRule(run: RunView, rule: RuleId): number {
  const reach = run.board.flatMap((p) => (p ? [figureIn(catalogOf(run), p.kind).range] : []));
  const lean = reach.filter((r) => r <= 1).length - reach.filter((r) => r >= 3).length;
  return rule === "fog" ? lean : rule === "long" ? -lean : 0;
}
function likesComponent(run: RunView, item: ComponentId): number {
  const own = pieces(run);
  const loose = own.some((p) => p.items.some(isComponentId)) || kindsOn(run.rack).some(isComponentId);
  const casters = own.filter(
    (p) => figureIn(catalogOf(run), p.kind).calling === "sage" || figureIn(catalogOf(run), p.kind).calling === "mender",
  ).length;
  const base = item === "glowcap" ? 2 + casters * 0.4 : item === "thorn" || item === "plume" ? 3 : 2.6;
  return base + (loose ? 0.2 : 0);
}
/** How much it likes a tool on offer: less than any component, so it takes one only from a pick of tools; a Whetstone over Tongs. */
const TOOL_LIKES: Record<ToolId, number> = { tongs: 1, whetstone: 1.5 };
function settleChoices<R extends RunView>(run: R, habit: Habit, s: Stream, hands: Hands<R>): void {
  for (let guard = 0; guard < 12; guard++) {
    const choice = picksOf(run)[0];
    if (!choice) return;
    let best = 0;
    if (habit.careless) best = below(s, choice.options.length);
    else {
      let bestScore = -Infinity;
      choice.options.forEach((option, i) => {
        let score = 0;
        if (choice.kind === "starter") {
          const kind = choice.options[i];
          if (kind !== undefined) score = liking(catalogOf(run), habit, kind) * 10 - STARTERS.indexOf(kind);
        } else if (choice.kind === "boon") {
          const boon = choice.options[i];
          if (boon !== undefined) score = likesBoon(run, habit, boon);
        } else if (choice.kind === "rule") {
          const rule = choice.options[i];
          if (rule !== undefined) score = likesRule(run, rule);
        } else if (isComponentId(option)) score = likesComponent(run, option);
        else if (isToolId(option)) score = TOOL_LIKES[option];
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      });
    }
    if (!hands(run, { do: "choose", option: best }).ok) return;
  }
}

// ---------- shopping ----------

/** How much it wants an offer: what it would add to its best party, and something for being a second or third copy. */
function wants(run: RunView, habit: Habit, kind: FigureId, before: number): number {
  const own = pieces(run);
  const cap = fieldCap(run);
  const twins = own.filter((p) => p.kind === kind && p.stars === 1).length;
  const better = own.some((p) => p.kind === kind && p.stars > 1);
  if (twins >= 2) return 6 + figureIn(catalogOf(run), kind).tier * habit.chases;
  const guest: Piece = { id: -1, kind, stars: 1, items: [], fed: 0 };
  const after = partyScore(catalogOf(run), habit, bestParty(catalogOf(run), habit, [...own, guest], cap));
  return after - before + (twins === 1 ? 0.7 * habit.chases : 0) + (better ? 0.4 * habit.chases : 0);
}
/** Where a Greg is who can still eat, the board's before the bench's; null for none. */
function hungryGreg(run: RunView): Spot | null {
  const most = traitNumber(catalogOf(run), "greg", "most", 1);
  const seat = run.board.findIndex((p) => p?.kind === "greg" && p.fed < most);
  if (seat >= 0) return { on: "board", at: seat };
  const slot = run.bench.findIndex((p) => p?.kind === "greg" && p.fed < most);
  return slot >= 0 ? { on: "bench", at: slot } : null;
}
/**
 * Lets go of whoever on the bench is doing least: not in the best party, and not half of a pair. It
 * goes to a Greg who can still eat (`feed`) if there is one, and is sold if not.
 */
function sellSpare<R extends RunView>(run: R, habit: Habit, keep: number, hands: Hands<R>): boolean {
  const own = pieces(run);
  const best = new Set(bestParty(catalogOf(run), habit, own, fieldCap(run)).map((p) => p.id));
  let worst = -1;
  let worstScore = Infinity;
  run.bench.forEach((p, slot) => {
    if (!p || best.has(p.id)) return;
    const twins = own.filter((o) => o.kind === p.kind && o.stars === p.stars).length;
    const score = worthOf(catalogOf(run), habit, p.kind, p.stars) + (twins > 1 ? 2 * habit.chases : 0);
    if (score < worstScore) {
      worst = slot;
      worstScore = score;
    }
  });
  if (worst < 0 || worstScore > keep) return false;
  const greg = hungryGreg(run);
  if (greg && hands(run, { do: "feed", from: { on: "bench", at: worst }, to: greg }).ok) return true;
  return hands(run, { do: "sell", from: { on: "bench", at: worst } }).ok;
}

function shop<R extends RunView>(run: R, habit: Habit, hands: Hands<R>): void {
  const floor = floorOf(run, habit);
  let paidRustles = 0;
  for (let guard = 0; guard < 80; guard++) {
    // The offer it wants most, if it can pay for it.
    let best = -1;
    let bestWant = 0;
    const before = partyScore(catalogOf(run), habit, bestParty(catalogOf(run), habit, pieces(run), fieldCap(run)));
    run.stall.forEach((kind, i) => {
      if (!kind) return;
      const cost = priceOf(run, i);
      if (cost > run.acorns) return;
      const want = wants(run, habit, kind, before);
      const pressing = want >= 6 || chairsUsed(catalogOf(run), pieces(run)) < fieldCap(run);
      if (!pressing && (run.acorns - cost < floor || want < 0.3 * cost)) return;
      if (want / Math.max(1, cost) > bestWant) {
        best = i;
        bestWant = want / Math.max(1, cost);
      }
    });
    if (best >= 0) {
      if (!run.bench.includes(null)) sellSpare(run, habit, Infinity, hands);
      if (hands(run, { do: "buy", offer: best }).ok) continue;
    }
    // Experience, by its habit.
    const short = chairsUsed(catalogOf(run), pieces(run)) < fieldCap(run);
    const par = PAR[Math.min(run.room, PAR.length - 1)] ?? MAX_LEVEL;
    const wantsLevel =
      !short &&
      run.level < MAX_LEVEL &&
      (habit.levels === "keen" || (habit.levels === "par" && run.level < par)) &&
      run.acorns - ECONOMY.xpCost >= floor;
    if (wantsLevel && hands(run, { do: "xp" }).ok) continue;
    // New offers: the free ones always, paid ones while there are acorns to spare.
    const cost = rustleCost(run);
    if (cost === 0 && hands(run, { do: "rustle" }).ok) continue;
    if (paidRustles < habit.rustles + (short ? 2 : 0) && run.acorns - cost >= Math.max(floor, short ? 1 : 2)) {
      if (hands(run, { do: "rustle" }).ok) {
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
function shopCarelessly<R extends RunView>(run: R, s: Stream, hands: Hands<R>): void {
  for (let guard = 0; guard < 20; guard++) {
    const able = run.stall.flatMap((kind, i) => (kind && priceOf(run, i) <= run.acorns ? [i] : []));
    if (able.length === 0 || !run.bench.includes(null)) break;
    if (!hands(run, { do: "buy", offer: pick(s, able) }).ok) break;
  }
  // With a full bench it sells one at random to make room for next time.
  if (!run.bench.includes(null)) hands(run, { do: "sell", from: { on: "bench", at: below(s, run.bench.length) } });
}

// ---------- seating and items ----------

function seatParty<R extends RunView>(run: R, habit: Habit, hands: Hands<R>): void {
  const own = pieces(run);
  const party = bestParty(catalogOf(run), habit, own, fieldCap(run));
  const counts = countTraits(catalogOf(run), party);
  const closed = closedNow(run);
  const seats = arrange(
    catalogOf(run),
    party.map((p) => ({ kind: p.kind, health: specOf(catalogOf(run), p.kind).hp * starScale(p.stars) })),
    stepFor(catalogOf(run), "sneak", counts.sneak ?? 0) > 0,
    closed,
  );
  const want = new Map<number, number>();
  party.forEach((p, i) => want.set(p.id, seats[i] ?? i));
  // Whoever is on the board and not wanted changes places with somebody wanted, or sits down.
  run.board.forEach((p, seat) => {
    if (!p || want.has(p.id)) return;
    const slot = run.bench.findIndex((b) => b !== null && want.has(b.id));
    if (slot >= 0) hands(run, { do: "move", from: { on: "bench", at: slot }, to: { on: "board", at: seat } });
    else if (!hands(run, { do: "bench", seat }).ok) hands(run, { do: "sell", from: { on: "board", at: seat } });
  });
  run.bench.forEach((p, slot) => {
    if (!p || !want.has(p.id)) return;
    const seat = run.board.findIndex((b, s) => b === null && !closed.has(s));
    if (seat >= 0) hands(run, { do: "move", from: { on: "bench", at: slot }, to: { on: "board", at: seat } });
  });
  // Then everyone to their own seat: each move puts at least one of them right.
  for (let guard = 0; guard < 2 * SEATS; guard++) {
    const from = run.board.findIndex((p, seat) => p !== null && want.get(p.id) !== seat && want.has(p.id));
    const to = from >= 0 ? want.get(run.board[from]?.id ?? -1) : undefined;
    if (from < 0 || to === undefined) break;
    if (!hands(run, { do: "move", from: { on: "board", at: from }, to: { on: "board", at: to } }).ok) break;
  }
}
function seatCarelessly<R extends RunView>(run: R, s: Stream, hands: Hands<R>): void {
  run.bench.forEach((p, slot) => {
    if (!p || overfills(run, p, null)) return;
    const closed = closedNow(run);
    const free = run.board.flatMap((b, seat) => (b || closed.has(seat) ? [] : [seat]));
    hands(run, { do: "move", from: { on: "bench", at: slot }, to: { on: "board", at: pick(s, free) } });
  });
}

type Suits = "hitter" | "caster" | "wall";
const suitOf = (cat: Catalog, item: ComponentId | FinishedId): Suits => {
  const part: ComponentId = isComponentId(item) ? item : halvesOf(cat, item)[0];
  return part === "thorn" || part === "plume" ? "hitter" : part === "glowcap" ? "caster" : "wall";
};
/** How well a figure suits a kind of item: more is better, 0 is not at all. */
function fits(cat: Catalog, p: Piece, suits: Suits): number {
  const f = figureIn(cat, p.kind);
  if (suits === "hitter") {
    if (f.attack === 0) return 0;
    return f.calling === "fang" || f.calling === "slinger" || f.calling === "sneak"
      ? 3
      : f.calling === "bulwark"
        ? 1
        : 0.5;
  }
  if (suits === "caster") return f.calling === "sage" ? 3 : f.calling === "mender" || f.calling === "chorus" ? 2.5 : 1;
  return f.calling === "bulwark" ? 3 : f.range <= 1 || f.calling === "chorus" ? 2 : 1;
}
/** Whether an emblem is any use on a figure: a False Moustache is not on one rooted to its hex, which never leaps. */
const emblemSuits = (cat: Catalog, p: Piece, item: EmblemId): boolean =>
  !(item === "sneakcharm" && specOf(cat, p.kind).rooted === true);
/** Whether a figure on the board holding an emblem would put its trait's step on: it counts once a figure, so not on a twin of one that carries it. */
function raisesStep(run: RunView, p: Piece, item: EmblemId): boolean {
  const cat = catalogOf(run);
  const board = run.board.flatMap((b) => (b ? [b] : []));
  const trait = cat.items[item]?.grants;
  if (trait === undefined) return false;
  const before = countTraits(cat, board)[trait] ?? 0;
  const after =
    countTraits(
      cat,
      board.map((b) => (b === p ? { kind: b.kind, items: [...b.items, item] } : b)),
    )[trait] ?? 0;
  return stepFor(cat, trait, after) > stepFor(cat, trait, before);
}
/** A component or a finished item: what it hands out first. */
const isMade = (item: RackItem | undefined): item is ComponentId | FinishedId =>
  isComponentId(item) || isFinishedId(item);
/** Who on the board it would hand a component or a finished item to: the best suited (`fits`), and worthiest; -1 for nobody. */
function takerOf(run: RunView, habit: Habit, item: ComponentId | FinishedId): number {
  const suits = suitOf(catalogOf(run), item);
  let best = -1;
  let bestScore = 0;
  run.board.forEach((p, seat) => {
    if (!p || "refused" in holdItem(catalogOf(run), p, item)) return;
    // Somebody already holding a loose component can forge with it now.
    const forges = isComponentId(item) && p.items.some(isComponentId) ? 1.5 : 1;
    const score = fits(catalogOf(run), p, suits) * forges * worthOf(catalogOf(run), habit, p.kind, p.stars);
    if (score > bestScore) {
      best = seat;
      bestScore = score;
    }
  });
  return best;
}
function handOutItems<R extends RunView>(run: R, habit: Habit, hands: Hands<R>): void {
  // Components and finished items first, in the rack's order, until the first nobody on the board can take.
  for (let guard = 0; guard < 30; guard++) {
    const item = kindsOn(run.rack).find(isMade);
    const best = item === undefined ? -1 : takerOf(run, habit, item);
    if (item === undefined || best < 0 || !hands(run, { do: "give", item, to: { on: "board", at: best } }).ok) break;
  }
  // Then each emblem, to the worthiest figure on the board that can take it and that it suits.
  for (const item of kindsOn(run.rack)) {
    if (!isEmblemId(item)) continue;
    let best = -1;
    let bestScore = 0;
    run.board.forEach((p, seat) => {
      if (!p || "refused" in holdItem(catalogOf(run), p, item) || !emblemSuits(catalogOf(run), p, item)) return;
      // First to one for whom it puts a step on; then a Tin Whistle to the dearest mana bar, any other by worth.
      const score =
        (raisesStep(run, p, item) ? 1000 : 0) +
        (item === "choruscharm"
          ? specOf(catalogOf(run), p.kind).mana[1]
          : worthOf(catalogOf(run), habit, p.kind, p.stars));
      if (score > bestScore) {
        best = seat;
        bestScore = score;
      }
    });
    if (best >= 0) hands(run, { do: "give", item, to: { on: "board", at: best } });
  }
}

// ---------- tools ----------

/** The fielded figure whose finished items suit it least, if on average they suit it less than a little (`fits` under 1); -1 for none. */
function misfit(run: RunView): number {
  const cat = catalogOf(run);
  let worst = -1;
  let worstFit = 1;
  run.board.forEach((p, seat) => {
    const made = p ? p.items.filter(isFinishedId) : [];
    if (!p || made.length === 0) return;
    const fit = made.reduce((n, item) => n + fits(cat, p, suitOf(cat, item)), 0) / made.length;
    if (fit < worstFit) {
      worst = seat;
      worstFit = fit;
    }
  });
  return worst;
}

/**
 * Its rule for tools, after handing out. Tongs: on the figure on the bench holding most, if one holds
 * anything (there it does nothing with it); else, with no Whetstone to use instead, on the fielded
 * figure whose finished items suit it least (`misfit`); then it hands out again, so each item goes to
 * whoever suits it best. A Whetstone: on the fielded figure whose finished items suit it least; last
 * of all, since what it makes is Leaf's to draw. Otherwise a tool is kept. It never melts: the rack
 * has no limit.
 */
function useTools<R extends RunView>(run: R, habit: Habit, hands: Hands<R>): void {
  let laden = -1;
  run.bench.forEach((p, slot) => {
    if (p && p.items.length > (run.bench[laden]?.items.length ?? 0)) laden = slot;
  });
  const stone = countOn(run.rack, "whetstone") > 0;
  const worst = misfit(run);
  const tongsTo: Spot | null =
    laden >= 0 ? { on: "bench", at: laden } : !stone && worst >= 0 ? { on: "board", at: worst } : null;
  if (countOn(run.rack, "tongs") > 0 && tongsTo && hands(run, { do: "tongs", to: tongsTo }).ok)
    handOutItems(run, habit, hands);
  const now = misfit(run);
  if (stone && now >= 0) hands(run, { do: "whetstone", to: { on: "board", at: now } });
}

// ---------- playing ----------

/** Does everything a player does before a fight, with the run's own actions, its habits drawn from the run's seed. */
export function planRoom(run: Run, habit: Habit): void {
  planWith(run, habit, DIRECT, { rng: mix(run.seed, 9000 + roomsFought(run)) });
}
/**
 * Does everything a player does before a fight, with `hands`, its habits drawn from `s`: settles
 * what is waiting to be chosen, shops, seats the party, hands out items, uses its tools.
 */
export function planWith<R extends RunView>(run: R, habit: Habit, hands: Hands<R>, s: Stream): void {
  if (run.stage.phase !== "plan") return;
  settleChoices(run, habit, s, hands);
  if (habit.careless) {
    shopCarelessly(run, s, hands);
    seatCarelessly(run, s, hands);
    return;
  }
  shop(run, habit, hands);
  seatParty(run, habit, hands);
  handOutItems(run, habit, hands);
  useTools(run, habit, hands);
}
/** Plans a room, fights it and takes the takings. */
export function playRoom(run: Run, habit: Habit): Taken {
  planRoom(run, habit);
  const begun = beginFight(run);
  if (!begun.ok) return begun;
  return takeTakings(run);
}
/** Plays a whole run from a seed. */
export function playRun(seed: number, habit: Habit, options: RunOptions): Run {
  const run = startRun(seed, options);
  for (let guard = 0; guard < 200 && run.stage.phase !== "over"; guard++) {
    if (!playRoom(run, habit).ok) break;
  }
  return run;
}
