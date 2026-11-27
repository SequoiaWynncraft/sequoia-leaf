/**
 * A run: one little raid, from the first pick to the last room. It is plain data (so it saves as it
 * is) and a set of actions on it. Every action either does something and gives back notes on what
 * happened, for a screen to animate, or changes nothing and gives back a reason in plain words.
 *
 * A room goes: plan (buy, sell, move, rustle, level, hand out items; no clock), `beginFight`, the
 * fight (the screen steps it from the setup it is given, or does not bother), `takeTakings`.
 * `beginFight` locks both boards, draws the fight's seed from the run's stream and works the fight
 * out to its end there and then; the run keeps how it came out, and the takings are paid from that,
 * so the result never depends on what the screen did.
 *
 * Every draw a run makes comes from its stream (`rng`): the first picks, the stall, who waits in
 * each room, the components and boons on offer, each fight's seed. `seed` is only where the stream
 * started; nothing the run draws is worked out from it after that.
 */

import { draw32, type Met, mix, pick } from "@sequoia-leaf/core";

import { chairsOn, overfills } from "./chairs.ts";
import { type BoonId, boonIn, boonNumber, boonOr, FIGHT_BOONS, giftOf, giftsTrait } from "./content/boons.ts";
import { type Catalog, catalogOf, type Era } from "./content/catalog.ts";
import { type BossId, type FigureId, figureIn, type Stars, traitsOf } from "./content/figures.ts";
import type { FinishedId, ItemId } from "./content/items.ts";
import { holdItem } from "./content/recipes.ts";
import { ECONOMY, MAX_LEVEL, type RoomKind, sellPrice } from "./content/rooms.ts";
import type { RackItem } from "./content/tools.ts";
import { topStep, type TraitId, traitNumber } from "./content/traits.ts";
import { drawOffer, starters } from "./draws.ts";
import { lastRoom } from "./endless.ts";
import type { Fed } from "./feed.ts";
import { resolveFight } from "./fight/engine.ts";
import { afterRoom } from "./fight/hooks.ts";
import type { FightResult, FightSetup, FightSummary } from "./fight/types.ts";
import { across, foeOf } from "./foe.ts";
import { COLS, SEATS } from "./hex.ts";
import { handOver, takeMade } from "./made.ts";
import { placedOf } from "./own.ts";
import { type Party, type TraitState, traitStates, traitSteps } from "./party.ts";
import { counted, countOn, type Rack, withAll } from "./racks.ts";
import { keepRoom, noRooms, type RoomRecord, type RoomTotals, totalsOf } from "./record.ts";
import { componentOptions, type ComponentPick, type Pickable, roomPicks } from "./rewards.ts";
import { closedNow, roomOf, type RoomRun, setupRules } from "./room.ts";
import { courseOf, onTrail, onTrailThere, trailOf, type Way } from "./way.ts";
import { enterRoom, ruleOptions, rulePicks, takeRule } from "./wilds.ts";
import type { Wing } from "./wing.ts";

// ---------- what a run is ----------

/** One figure the party owns. */
export interface Piece {
  /** Its own number in this run, so a screen can follow it about. */
  id: number;
  kind: FigureId;
  stars: Stars;
  items: ItemId[];
  /** What Greg has eaten (`feed`): percent of his health he has gained for good. 0 for anyone else. */
  fed: number;
}
/** A place a figure can be: a seat on the party's half of the board (`row * 7 + col`, row 0 the front), or a place on the bench. */
export interface Spot {
  on: "board" | "bench";
  at: number;
}
/** Something the player has to choose before anything else happens. */
export type Choice =
  | { kind: "starter"; options: FigureId[] }
  /** Components to take one of; after some rooms a tool among them, or tools instead (`rewards.ts`). */
  | ComponentPick
  | { kind: "boon"; options: BoonId[]; redraws: number }
  | { kind: "rule"; options: Wing["rule"][] };
/** How a run ended: its last boss beaten, its health gone, or walked home from. */
export type Ending = "won" | "lost" | "left";
/**
 * Where a run stands, as one value: planning a room, with the picks waiting (the first is up); the
 * room's fight, as Leaf decided it when the party set out; or over, and how.
 */
export type Stage =
  { phase: "plan"; picks: Choice[] } | { phase: "fight"; fight: Fought } | { phase: "over"; ending: Ending };
export type Phase = Stage["phase"];
export type { RoomRecord, RoomTotals } from "./record.ts";
export interface Run {
  /** Where the stream started. The bot's own habits are drawn from it; the run's draws never are. */
  seed: number;
  /** The random stream: every draw the run makes comes from it. */
  rng: number;
  /** The era it last moved in (`releases.ts`): what its draws draw from (`catalogOf`). */
  era: Era;
  /**
   * How it set out (`way.ts`): its course (a trail, or an endless way) and whose figures (everyone's,
   * or the member's own, with their roster as it was when the run started: what the stall sells
   * above one acorn, and each figure's level). Its slot, boards, pay and records are read from it.
   */
  way: Way;
  /** The room being planned for or fought, counting from 0. */
  room: number;
  stage: Stage;
  resolve: number;
  acorns: number;
  /** Rooms won in a row (above 0), or lost in a row (below 0), up to the last one fought. A draw makes it 0. */
  streak: number;
  level: number;
  xp: number;
  board: (Piece | null)[];
  bench: (Piece | null)[];
  /** The rack: what nobody is holding (components, finished items, emblems, tools), as how many of each kind. */
  rack: Rack;
  stall: (FigureId | null)[];
  /** The stall is being kept as it is for the next room. */
  held: boolean;
  /** Free rustles left this room, and figures bought in it. */
  rustles: number;
  bought: number;
  boons: BoonId[];
  /** Who is waiting in the room. */
  foe: Party;
  /** The last rooms fought, `KEPT_ROOMS` at most (`record.ts`), and every room before them as totals. */
  record: RoomRecord[];
  before: RoomTotals;
  nextId: number;
  /** The last fight fought, as it was set up, so that it can be played again to be looked back on. */
  last: FightSetup | null;
  /** In the Wilds, the rule picked for a wing (`wing.ts`): it holds while the run is in that wing. Null before the first pick. */
  wing: Wing | null;
  /** Things this run has done that the almanac remembers. */
  seen: {
    fielded: FigureId[];
    threeStars: FigureId[];
    forged: FinishedId[];
    topped: TraitId[];
  };
}

/**
 * A run without its streams: what the page is shown of it, and all that a command that draws
 * nothing reads and changes. The page keeps one, and does such commands to it ahead of Leaf.
 */
export type RunView = Omit<Run, "seed" | "rng">;

/** The picks waiting, the first one up; none outside planning. */
export const picksOf = (run: Pick<Run, "stage">): readonly Choice[] =>
  run.stage.phase === "plan" ? run.stage.picks : [];
/** The fight being fought, as Leaf decided it; null outside a fight. */
export const foughtOf = ({ stage }: Pick<Run, "stage">): Fought | null =>
  stage.phase === "fight" ? stage.fight : null;
/** How the run ended; null for one not over. */
export const endingOf = ({ stage }: Pick<Run, "stage">): Ending | null =>
  stage.phase === "over" ? stage.ending : null;

/** A fight as the run keeps it while it is being fought: its setup, and how it came out. */
export interface Fought {
  setup: FightSetup;
  outcome: FightSummary;
}

/**
 * Whether the rules loaded here play a fight from its setup to the outcome Leaf kept. A page whose
 * rules are not Leaf's (one opened before a deploy) does not, and loads again rather than show a
 * fight that is not the one paid for.
 */
export function playsAsKept({ setup, outcome }: Fought): boolean {
  const here = resolveFight(setup);
  return (
    here.result === outcome.result &&
    here.ticks === outcome.ticks &&
    here.standing[0] === outcome.standing[0] &&
    here.standing[1] === outcome.standing[1]
  );
}

/** Why acorns were paid: the room, a win, savings, gnomes, a streak, or Windfall. */
export type AcornsWhy = "room" | "win" | "interest" | "gnomes" | "streak" | "windfall";
export const ACORNS_WHYS: readonly AcornsWhy[] = ["room", "win", "interest", "gnomes", "streak", "windfall"];

/** What happened, for a screen to show. Figures are named by `piece`, their own number in the run. */
export type Note =
  | { t: "starter"; kind: FigureId; piece: number; to: Spot }
  | { t: "component"; item: Pickable }
  | { t: "boon"; boon: BoonId }
  | { t: "redrawn"; options: BoonId[] }
  /** `to` is null when the figure went straight into a merge with no place of its own. */
  | { t: "bought"; kind: FigureId; piece: number; offer: number; cost: number; to: Spot | null }
  /** Three became one: `gone` went into `piece`, which now has `stars`. `spilled` items went back to the item bench. */
  | {
      t: "merged";
      kind: FigureId;
      stars: Stars;
      piece: number;
      at: Spot;
      gone: number[];
      items: ItemId[];
      spilled: ItemId[];
    }
  | { t: "sold"; kind: FigureId; stars: Stars; piece: number; from: Spot; acorns: number; items: ItemId[] }
  | { t: "moved"; piece: number; from: Spot; to: Spot; swapped: number | null }
  /** Moved off a seat a Wilds rule closed, as the room was laid out under it. */
  | { t: "shifted"; piece: number; from: number; to: Spot }
  | { t: "rustled"; cost: number; stall: (FigureId | null)[] }
  | { t: "held"; on: boolean }
  | { t: "xp"; gained: number; cost: number }
  | { t: "level"; level: number }
  /** An item handed over, and the item it made with one held (`combine`), if it made one. */
  | { t: "gave"; item: ItemId; piece: number; forged: ItemId | null; holds: ItemId[] }
  /** Two items on the rack made an item (`combine`), which is on it now. */
  | { t: "made"; item: ItemId }
  | { t: "acorns"; why: AcornsWhy; amount: number }
  /** Items put on the item bench by a boon: A Basket On The Stump's components, or a charm's emblem. */
  | { t: "items"; why: "basket" | "charm"; items: ItemId[] }
  /** Something on the rack melted for acorns, by the member's hand (`melt`). */
  | { t: "melted"; item: RackItem; acorns: number }
  /** Tongs took everything a figure held back to the rack. */
  | { t: "tongs"; piece: number; items: ItemId[] }
  /** A Whetstone turned each item a figure held into another of its sort: `was` became `now`, place by place. */
  | { t: "whetted"; piece: number; was: ItemId[]; now: ItemId[] }
  | { t: "resolve"; change: number; left: number }
  /** The fight, locked: both boards and its seed to play it from, and how it came out. */
  | { t: "fight"; room: number; seed: number; setup: FightSetup; outcome: FightSummary }
  | { t: "result"; room: number; result: FightResult; standing: [number, number] }
  /** Greg ate a figure from the bench (`feed.ts`). */
  | Fed
  | { t: "choice"; kind: Choice["kind"] }
  | { t: "room"; room: number; kind: RoomKind; who: string; title: string }
  | { t: "over"; won: boolean };

/** Why an action was turned down, as a code, and the sentence a player is shown for it. */
export const REFUSALS = {
  raid_over: "The raid is over.",
  fighting: "The figures are busy fighting.",
  pick_starter: "Pick who sets out with you first.",
  pick_boon: "Pick a boon first.",
  pick_component: "Pick a component first.",
  pick_rule: "Pick a rule first.",
  nothing_to_choose: "There is nothing to choose.",
  not_one_of_three: "That is not one of the three.",
  not_on_offer: "That is not on offer.",
  no_boons: "There are no boons on offer.",
  redrawn: "You have already asked for others.",
  stall_empty: "That place on the stall is empty.",
  not_enough_acorns: "Not enough acorns.",
  bench_full: "The bench is full.",
  nobody_there: "Nobody is there.",
  last_figure: "Somebody has to go on the raid.",
  no_such_place: "There is no such place.",
  closed_hex: "That hex is closed.",
  already_there: "It is already there.",
  field_full: "You can field no more figures for now.",
  top_level: "There is no level above this one.",
  no_such_item: "There is no such item.",
  hands_full: "It is holding all it can.",
  already_kin: "It is of that origin already.",
  two_components: "It takes two components.",
  boon_held: "You have that boon already.",
  board_empty: "Put somebody on the board first.",
  too_many_fielded: "There are more on the board than you can field.",
  no_fight: "There has been no fight yet.",
  no_such_room: "There is no such room.",
  not_from_bench: "Greg only eats from the bench.",
  not_greg: "Only Greg eats.",
  greg_on_greg: "Greg does not eat Greg.",
  greg_full: "Greg is full.",
  holds_nothing: "It holds nothing.",
} as const;
export type Why = keyof typeof REFUSALS;

export type Refused = { ok: false; code: Why; why: string };
export type Done = { ok: true; notes: Note[] } | Refused;
export type Begun = { ok: true; notes: Note[]; setup: FightSetup } | Refused;
export type Taken = { ok: true; notes: Note[]; fight: FightSummary } | Refused;

/** The sentence for a refusal. How many may be fielded is said with the number, when it is given. */
export function whyText(code: Why, cap?: number): string {
  if (code === "field_full" && cap !== undefined) return `You can field ${cap} figure${cap === 1 ? "" : "s"} for now.`;
  return REFUSALS[code];
}
/** A refusal, with its sentence. */
export const refusal = (code: Why, cap?: number): Refused => ({ ok: false, code, why: whyText(code, cap) });
const no = refusal;
const yes = (notes: Note[]): Done => ({ ok: true, notes });

// ---------- looking at a run ----------

/** Everyone the party owns, board first. */
export const pieces = (run: Pick<Run, "board" | "bench">): Piece[] =>
  [...run.board, ...run.bench].filter((p) => p !== null);
export const fielded = (run: Pick<Run, "board">): number => run.board.reduce((n, p) => n + (p ? 1 : 0), 0);
/** How many chairs the room the run is in has (`Room.chairs`): the level, one more with An Extra Chair, and an endless run's chairs. */
export const fieldCap = (run: RoomRun): number => roomOf(run).chairs;
/** Who is at a spot: null for nobody, undefined for no such spot. */
export function pieceAt(run: RunView, spot: Spot): Piece | null | undefined {
  if (!Number.isInteger(spot.at)) return undefined;
  return spot.on === "board" ? run.board[spot.at] : run.bench[spot.at];
}
/** Puts a figure, or nobody, at a spot. */
const put = (run: RunView, at: Spot, who: Piece | null) => ((at.on === "board" ? run.board : run.bench)[at.at] = who);
/** Where a figure is, by its number. */
export function spotOf(run: Pick<Run, "board" | "bench">, piece: number): Spot | null {
  const seat = run.board.findIndex((p) => p?.id === piece);
  if (seat >= 0) return { on: "board", at: seat };
  const slot = run.bench.findIndex((p) => p?.id === piece);
  return slot >= 0 ? { on: "bench", at: slot } : null;
}
/** Experience still needed for the next level; 0 at the top. */
export const xpToNext = (run: Pick<Run, "level" | "xp">): number =>
  run.level >= MAX_LEVEL ? 0 : (ECONOMY.levelXp[run.level - 1] ?? 0) - run.xp;
/** The most interest a room can pay. */
export const interestCap = (run: Pick<Run, "boons" | "era">): number =>
  boonOr(catalogOf(run), run.boons, "deeppockets", "cap", ECONOMY.interestMost);
/** What the acorns now held would earn after the next room. */
export const interestNow = (run: Pick<Run, "boons" | "acorns" | "era">): number => {
  const per = boonOr(catalogOf(run), run.boons, "deeppockets", "per", ECONOMY.interestPer);
  return Math.min(interestCap(run), Math.floor(run.acorns / per));
};
/** The streak after a room: one more win or loss in a row, a new streak of 1 when it turns, 0 after a draw. */
export function nextStreak(streak: number, result: FightResult): number {
  if (result === "win") return streak > 0 ? streak + 1 : 1;
  if (result === "loss") return streak < 0 ? streak - 1 : -1;
  return 0;
}
/** What a streak pays after the room it was reached in, won or lost alike. */
export function streakPay(streak: number): number {
  const table = ECONOMY.streakAcorns;
  return table[Math.min(Math.abs(streak), table.length - 1)] ?? 0;
}
/** What an offer on the stall costs right now; 0 for an empty place. */
export function priceOf(run: Pick<Run, "stall" | "boons" | "bought" | "era">, offer: number): number {
  const kind = run.stall[offer];
  if (!kind) return 0;
  const off = run.bought === 0 ? boonOr(catalogOf(run), run.boons, "haggler", "off", 0) : 0;
  return Math.max(0, figureIn(catalogOf(run), kind).tier - off);
}
export const sellValue = (cat: Catalog, piece: Piece): number => sellPrice(figureIn(cat, piece.kind).tier, piece.stars);
/** What the next rustle costs. */
export const rustleCost = (run: Pick<Run, "rustles">): number => (run.rustles > 0 ? 0 : ECONOMY.rustle);
/** The party as it would go into a fight now. */
export function partyOf(run: Pick<Run, "board" | "boons" | "way">): Party {
  return {
    who: "You",
    title: "",
    figures: run.board.flatMap((p, seat) => (p ? [placedOf(run, p, seat)] : [])),
    boons: run.boons.filter((b) => FIGHT_BOONS.includes(b)),
    might: 100,
  };
}
/** The traits the fielded party has any of, with counts and steps, switched-on ones first. */
export const traitsNow = (run: Pick<Run, "board" | "era">): TraitState[] =>
  traitStates(catalogOf(run), pieces({ board: run.board, bench: [] }));

// ---------- the stall ----------

/** How many offers the stall has: more with A Wider Stall. */
export const stallSize = (run: Pick<Run, "boons" | "era">): number =>
  boonOr(catalogOf(run), run.boons, "widestall", "offers", ECONOMY.stall);
function restock(run: Run): void {
  run.stall = Array.from({ length: stallSize(run) }, () => drawOffer(run));
}

// ---------- choices ----------

/** The boons a run is offered after a room: three of those its catalogue has open (`cat`, its era's), one charm at most. */
export function boonOptions(run: Run, not: readonly BoonId[], cat = catalogOf(run)): BoonId[] {
  const owned = new Set(pieces(run).flatMap((p) => traitsOf(cat, p.kind)));
  // A charm only for a trait the party owns a figure of.
  const owns = (trait: TraitId | undefined): boolean => trait === undefined || owned.has(trait);
  const fits = (id: BoonId) => !run.boons.includes(id) && owns(giftsTrait(cat, id));
  const all = cat.ids.boons.filter(fits);
  const fresh = all.filter((id) => !not.includes(id));
  const left = fresh.length >= ECONOMY.boonOptions ? fresh : all;
  const out: BoonId[] = [];
  // One charm at most in any three, so there is always something else to take.
  let charm = false;
  while (out.length < ECONOMY.boonOptions) {
    const pool = left.filter((id) => !out.includes(id) && !(charm && boonIn(cat, id).sort === "charm"));
    if (pool.length === 0) break;
    const id = pick(run, pool);
    out.push(id);
    if (boonIn(cat, id).sort === "charm") charm = true;
  }
  return out;
}
export function newPiece(run: RunView, kind: FigureId): Piece {
  return { id: run.nextId++, kind, stars: 1, items: [], fed: 0 };
}
export function remember<T>(list: T[], v: T): void {
  if (!list.includes(v)) list.push(v);
}

// ---------- starting ----------

export interface RunOptions {
  /** The era it sets out in. */
  era: Era;
  /** How it sets out: by default on the first trail, with everyone's figures. */
  way?: Way;
}
/** Starts a run. It begins with a choice waiting: one of three one-acorn figures to set out with. */
export function startRun(seed: number, options: RunOptions): Run {
  const run: Run = {
    seed: seed >>> 0,
    rng: mix(seed >>> 0, 1),
    era: options.era,
    way: onTrailThere(options.way ?? onTrail(0)),
    room: 0,
    stage: { phase: "plan", picks: [] },
    resolve: ECONOMY.resolve,
    acorns: ECONOMY.startAcorns,
    streak: 0,
    level: 1,
    xp: 0,
    board: Array.from({ length: SEATS }, () => null),
    bench: Array.from({ length: ECONOMY.bench }, () => null),
    rack: {},
    stall: [],
    held: false,
    rustles: ECONOMY.freeRustles,
    bought: 0,
    boons: [],
    foe: { who: "", title: "", figures: [], boons: [], might: 100 },
    record: [],
    before: noRooms(),
    nextId: 1,
    last: null,
    wing: null,
    seen: { fielded: [], threeStars: [], forged: [], topped: [] },
  };
  run.stage = {
    phase: "plan",
    picks: [{ kind: "starter", options: starters(run) }],
  };
  restock(run);
  run.foe = foeOf(run, draw32(run));
  return run;
}

/**
 * Lays the room a run is in out afresh from a new seed, keeping what the player has (the trail, the
 * room, resolve, level and experience, acorns, the figures with their stars and items, the item
 * bench, the boons, what the run has done): the stall, who waits in the room and what each pick
 * waiting offers are drawn again, the room's rustles and buying start again, and a run in the
 * middle of a fight is put back to planning for that room. For a run that comes from outside the
 * rules (the one-off import of the old saves), whose draws cannot be trusted.
 */
export function layOutAfresh(run: Run, seed: number): void {
  run.seed = seed >>> 0;
  run.rng = mix(run.seed, 1);
  run.last = null;
  run.held = false;
  run.bought = 0;
  run.rustles = ECONOMY.freeRustles + boonOr(catalogOf(run), run.boons, "regular", "rustles", 0);
  const picks = picksOf(run).map((choice): Choice => {
    if (choice.kind === "starter") return { kind: "starter", options: starters(run) };
    if (choice.kind === "component") {
      const count = Math.min(ECONOMY.componentsWon, Math.max(ECONOMY.componentsLost, choice.options.length));
      return { kind: "component", options: componentOptions(run, count) };
    }
    if (choice.kind === "rule") return { kind: "rule", options: ruleOptions(run, null) };
    return { kind: "boon", options: boonOptions(run, []), redraws: Math.min(choice.redraws, ECONOMY.boonRedraws) };
  });
  run.stage = { phase: "plan", picks };
  restock(run);
  run.foe = foeOf(run, draw32(run));
}

/** Why nothing can be planned just now, or null if it can. */
export function notPlanning({ stage }: Pick<Run, "stage">): Why | null {
  if (stage.phase === "over") return "raid_over";
  if (stage.phase === "fight") return "fighting";
  const up = stage.picks[0];
  return up ? `pick_${up.kind}` : null;
}

/** Settles the choice that is waiting, by taking one of its options. */
export function choose(run: Run, option: number): Done {
  const { stage } = run;
  if (stage.phase === "over") return no("raid_over");
  const choice = picksOf(run)[0];
  if (stage.phase !== "plan" || !choice) return no("nothing_to_choose");
  const notes: Note[] = [];
  if (choice.kind === "starter") {
    const kind = choice.options[option];
    if (kind === undefined) return no("not_one_of_three");
    const piece = newPiece(run, kind);
    // Front row, in the middle.
    const seat = Math.floor(COLS / 2);
    run.board[seat] = piece;
    notes.push({ t: "starter", kind, piece: piece.id, to: { on: "board", at: seat } });
  } else if (choice.kind === "component") {
    const item = choice.options[option];
    if (item === undefined) return no("not_on_offer");
    run.rack = counted(run.rack, item, 1);
    notes.push({ t: "component", item });
  } else if (choice.kind === "rule") {
    const rule = choice.options[option];
    if (rule === undefined) return no("not_on_offer");
    notes.push(...takeRule(run, rule));
  } else {
    const boon = choice.options[option];
    if (boon === undefined) return no("not_on_offer");
    run.boons.push(boon);
    notes.push({ t: "boon", boon });
    const cat = catalogOf(run);
    if (boon === "windfall") {
      const amount = boonNumber(cat, boon, "acorns");
      run.acorns += amount;
      notes.push({ t: "acorns", why: "windfall", amount });
    } else if (boon === "basket") {
      const items = Array.from({ length: boonNumber(cat, boon, "components") }, () => pick(run, cat.ids.components));
      run.rack = withAll(run.rack, items);
      notes.push({ t: "items", why: "basket", items });
    } else if (boon === "blanket") {
      const back = Math.min(boonNumber(cat, boon, "now"), ECONOMY.resolve - run.resolve);
      run.resolve += back;
      notes.push({ t: "resolve", change: back, left: run.resolve });
    } else if (boon === "widestall") {
      while (run.stall.length < stallSize(run)) run.stall.push(drawOffer(run));
    } else if (boon === "regular") {
      run.rustles += boonNumber(cat, boon, "rustles");
    } else if (boonIn(cat, boon).gives) {
      // A charm gives its emblem, for one figure to hold.
      run.rack = withAll(run.rack, giftOf(cat, boon));
      notes.push({ t: "items", why: "charm", items: giftOf(cat, boon) });
    }
  }
  stage.picks.shift();
  const next = stage.picks[0];
  if (next) notes.push({ t: "choice", kind: next.kind });
  return yes(notes);
}
/** Swaps the three boons on offer for three others. Each offer of boons allows it once. */
export function redraw(run: Run): Done {
  if (run.stage.phase === "over") return no("raid_over");
  const choice = picksOf(run)[0];
  if (choice?.kind !== "boon") return no("no_boons");
  if (choice.redraws <= 0) return no("redrawn");
  choice.redraws--;
  choice.options = boonOptions(run, choice.options);
  return yes([{ t: "redrawn", options: choice.options.slice() }]);
}

// ---------- three of a kind ----------

/**
 * Wherever there are three of the same figure with the same stars, makes them one with a star more,
 * and again if that makes another three. The one furthest forward stays (board before bench); the
 * items of the other two go to it while it has room, and the rest back to the item bench. `loose`
 * is a figure just bought that has no place of its own yet.
 */
export function merge(run: RunView, loose: Piece | null, notes: Note[]): void {
  let spare = loose;
  for (;;) {
    const groups = new Map<string, Piece[]>();
    const all = pieces(run);
    if (spare) all.push(spare);
    let trio: Piece[] | undefined;
    for (const p of all) {
      if (p.stars >= 3) continue;
      const key = `${p.kind}:${p.stars}`;
      const group = groups.get(key) ?? [];
      group.push(p);
      groups.set(key, group);
      if (group.length >= 3) {
        trio = group;
        break;
      }
    }
    const [keep, a, b] = trio ?? [];
    if (!keep || !a || !b) return;
    const at = spotOf(run, keep.id);
    if (!at) return;
    const spilled: ItemId[] = [];
    for (const gone of [a, b]) {
      const from = spotOf(run, gone.id);
      if (from?.on === "board") run.board[from.at] = null;
      else if (from) run.bench[from.at] = null;
      else spare = null;
      for (const item of gone.items) if (!handOver(run, keep, item, notes)) spilled.push(item);
      keep.fed = Math.min(traitNumber(catalogOf(run), "greg", "most", 1), keep.fed + gone.fed);
    }
    keep.stars = keep.stars === 1 ? 2 : 3;
    run.rack = withAll(run.rack, spilled);
    if (keep.stars === 3) remember(run.seen.threeStars, keep.kind);
    notes.push({
      t: "merged",
      kind: keep.kind,
      stars: keep.stars,
      piece: keep.id,
      at,
      gone: [a.id, b.id],
      items: keep.items.slice(),
      spilled,
    });
  }
}

// ---------- planning ----------

/** Buys an offer from the stall onto the bench. With a full bench, only if it completes three of a kind. */
export function buy(run: RunView, offerAt: number): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  const kind = run.stall[offerAt];
  if (!kind) return no("stall_empty");
  const cost = priceOf(run, offerAt);
  if (run.acorns < cost) return no("not_enough_acorns");
  const slot = run.bench.indexOf(null);
  const twins = pieces(run).filter((p) => p.kind === kind && p.stars === 1).length;
  if (slot < 0 && twins < 2) return no("bench_full");
  run.acorns -= cost;
  run.stall[offerAt] = null;
  run.bought++;
  const piece = newPiece(run, kind);
  if (slot >= 0) run.bench[slot] = piece;
  const notes: Note[] = [
    { t: "bought", kind, piece: piece.id, offer: offerAt, cost, to: slot >= 0 ? { on: "bench", at: slot } : null },
  ];
  merge(run, slot >= 0 ? null : piece, notes);
  return yes(notes);
}
/** Sells a figure for acorns. What it was holding goes back to the item bench. */
export function sell(run: RunView, from: Spot): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  const piece = pieceAt(run, from);
  if (!piece) return no("nobody_there");
  if (pieces(run).length <= 1) return no("last_figure");
  const acorns = sellValue(catalogOf(run), piece);
  run.acorns += acorns;
  run.rack = withAll(run.rack, piece.items);
  put(run, from, null);
  return yes([
    { t: "sold", kind: piece.kind, stars: piece.stars, piece: piece.id, from, acorns, items: piece.items.slice() },
  ]);
}
/** Moves a figure to another spot, changing places with whoever is there. */
export function move(run: RunView, from: Spot, to: Spot): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  const piece = pieceAt(run, from);
  const there = pieceAt(run, to);
  if (piece === undefined || there === undefined) return no("no_such_place");
  if (!piece) return no("nobody_there");
  if (from.on === to.on && from.at === to.at) return no("already_there");
  if (to.on === "board" && closedNow(run).has(to.at)) return no("closed_hex");
  if (to.on === "board" && from.on === "bench" && overfills(run, piece, there)) {
    return no("field_full", fieldCap(run));
  }
  put(run, to, piece);
  put(run, from, there);
  return yes([{ t: "moved", piece: piece.id, from, to, swapped: there?.id ?? null }]);
}
/** Takes a figure off the board to the first free place on the bench. */
export function toBench(run: RunView, seat: number): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  if (!run.board[seat]) return no("nobody_there");
  const slot = run.bench.indexOf(null);
  if (slot < 0) return no("bench_full");
  return move(run, { on: "board", at: seat }, { on: "bench", at: slot });
}
/** New offers on the stall: free once a room, then for acorns. */
export function rustle(run: Run): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  const cost = rustleCost(run);
  if (run.acorns < cost) return no("not_enough_acorns");
  if (cost === 0) run.rustles--;
  run.acorns -= cost;
  run.held = false;
  restock(run);
  return yes([{ t: "rustled", cost, stall: run.stall.slice() }]);
}
/** Keeps the stall as it is for the next room, or lets it go again. */
export function hold(run: RunView, on: boolean = !run.held): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  run.held = on;
  return yes([{ t: "held", on }]);
}
/** Adds experience, and the levels it makes. */
export function gainXp(run: RunView, amount: number, notes: Note[]): void {
  if (run.level >= MAX_LEVEL) return;
  run.xp += amount;
  for (;;) {
    const need = ECONOMY.levelXp[run.level - 1];
    if (need === undefined || run.xp < need) break;
    run.xp -= need;
    run.level++;
    notes.push({ t: "level", level: run.level });
  }
  if (run.level >= MAX_LEVEL) run.xp = 0;
}
/** Buys experience with acorns. */
export function buyXp(run: RunView): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  if (run.level >= MAX_LEVEL) return no("top_level");
  if (run.acorns < ECONOMY.xpCost) return no("not_enough_acorns");
  run.acorns -= ECONOMY.xpCost;
  const notes: Note[] = [{ t: "xp", gained: ECONOMY.xpBought, cost: ECONOMY.xpCost }];
  gainXp(run, ECONOMY.xpBought, notes);
  return yes(notes);
}
/**
 * Hands one of a kind of item from the rack to a figure. Two items a recipe joins become what they
 * make (`holdItem`); nothing is given that grants a trait its holder carries already.
 */
export function giveItem(run: RunView, item: ItemId, to: Spot): Done {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  if (countOn(run.rack, item) === 0) return no("no_such_item");
  const piece = pieceAt(run, to);
  if (!piece) return no("nobody_there");
  const got = holdItem(catalogOf(run), piece, item);
  if ("refused" in got) return no(got.refused);
  const made = takeMade(run, got.made);
  if (!made) return no("boon_held");
  piece.items = got.held;
  run.rack = counted(run.rack, item, -1);
  return yes([{ t: "gave", item, piece: piece.id, forged: got.forged, holds: piece.items.slice() }, ...made]);
}

// ---------- the fight and the takings ----------

/**
 * Sends the party in: both boards are locked as they stand, the fight's seed is drawn from the run's
 * stream, and the fight is worked out to its end at once. The run keeps how it came out; the screen
 * gets the setup to play, which gives the same fight, and the run waits for `takeTakings`.
 */
export function beginFight(run: Run): Begun {
  const stop = notPlanning(run);
  if (stop) return no(stop);
  if (fielded(run) === 0) return no("board_empty");
  if (chairsOn(run) > fieldCap(run)) return no("too_many_fielded");
  for (const p of run.board) if (p) remember(run.seen.fielded, p.kind);
  for (const t of traitsNow(run)) if (t.step >= topStep(catalogOf(run), t.trait)) remember(run.seen.topped, t.trait);
  const sides: FightSetup["sides"] = [partyOf(run), structuredClone(run.foe)];
  const setup: FightSetup = { seed: draw32(run), era: run.era, sides, ...setupRules(roomOf(run)) };
  const outcome = resolveFight(setup);
  run.stage = { phase: "fight", fight: { setup, outcome } };
  return { ok: true, notes: [{ t: "fight", room: run.room, seed: setup.seed, setup, outcome }], setup };
}

/** What a room not won costs in resolve: a base and one more for each enemy left, a draw only the base; a win nothing. */
export function resolveLost(run: Pick<Run, "boons" | "era">, fight: FightSummary): number {
  if (fight.result === "win") return 0;
  const standing = fight.result === "draw" ? 0 : fight.standing[1];
  const less = boonOr(catalogOf(run), run.boons, "blanket", "less", 0);
  return Math.max(1, Math.min(ECONOMY.lossMost, ECONOMY.lossBase + standing) - less);
}

/**
 * The room the takings of the fight being fought move the run on to (`takeTakings`): the next one,
 * or the last again when it is not won. Null when they end the run (the last room won, or resolve
 * gone), and outside a fight. With `more` the last room won does not end it: the run stays there,
 * for whoever plays it to say what comes next (a sitting's rooms after the fifteenth).
 */
export function takenTo(run: RunView, more?: boolean): number | null {
  const fight = foughtOf(run);
  if (!fight || run.room > lastRoom(run)) return null;
  const won = !more && fight.outcome.result === "win" && run.room >= lastRoom(run);
  if (won || run.resolve - resolveLost(run, fight.outcome) <= 0) return null;
  return Math.min(run.room + 1, lastRoom(run));
}

/**
 * Ends the room: works out how the fight went, takes resolve for a loss, pays acorns and
 * experience, queues what there is to choose, and moves on to the next room (or ends the run).
 * It may be called at any point after `beginFight`, which is all "skip" is. In a sparring room
 * next, `met` is the board another member fought it with that Leaf picked (`opposition`). `more` is
 * `takenTo`'s: the last room won pays as any room and does not end the run.
 */
export function takeTakings(run: Run, met?: Met, more?: boolean): Taken {
  const { stage } = run;
  if (stage.phase !== "fight") return no(stage.phase === "over" ? "raid_over" : "no_fight");
  const { setup, outcome: fight } = stage.fight;
  if (run.room > lastRoom(run)) return no("no_such_room");
  const room = roomOf(run);
  const to = takenTo(run, more);
  const won = fight.result === "win";
  const last = run.room >= lastRoom(run);
  const notes: Note[] = [{ t: "result", room: run.room, result: fight.result, standing: fight.standing }];
  keepRoom(run, { room: run.room, kind: room.kind, ...across(run.foe, fight) });
  run.streak = nextStreak(run.streak, fight.result);
  run.last = setup;

  if (!won) {
    const cost = resolveLost(run, fight);
    run.resolve = Math.max(0, run.resolve - cost);
    notes.push({ t: "resolve", change: -cost, left: run.resolve });
  }
  if (to === null) {
    run.stage = { phase: "over", ending: won && last ? "won" : "lost" };
    notes.push({ t: "over", won: won && last });
    return { ok: true, notes, fight };
  }

  // Acorns: the room's pay, the streak, interest on what was held before any of it; then what the traits do (the gnomes').
  const cat = catalogOf(run);
  const paid: [AcornsWhy, number][] = [
    ["room", ECONOMY.roomAcorns],
    ["win", won ? ECONOMY.winAcorns : 0],
    ["streak", streakPay(run.streak)],
    ["interest", interestNow(run)],
  ];
  for (const [why, amount] of paid) {
    if (amount <= 0) continue;
    notes.push({ t: "acorns", why, amount });
    run.acorns += amount;
  }
  notes.push(...afterRoom(run, stage.fight, traitSteps(cat, partyOf(run))));
  const xp = boonOr(cat, run.boons, "quickstudy", "xp", ECONOMY.xpRoom);
  notes.push({ t: "xp", gained: xp, cost: 0 });
  gainXp(run, xp, notes);

  // Things to choose: a Wilds rule after a boss, then the room's picks (`Room.picks`): components, and a boon after some rooms.
  const picks: Choice[] = [...rulePicks(run, run.room), ...roomPicks(run, room, won)];
  if (room.picks.boon) picks.push({ kind: "boon", options: boonOptions(run, []), redraws: ECONOMY.boonRedraws });

  // On to the next room. The last one is fought again until it is won or resolve runs out.
  run.room = to;
  run.stage = { phase: "plan", picks };
  run.bought = 0;
  run.rustles = ECONOMY.freeRustles + boonOr(cat, run.boons, "regular", "rustles", 0);
  if (run.held) run.held = false;
  else restock(run);
  notes.push(...enterRoom(run, draw32(run), met));
  notes.push({ t: "room", room: run.room, kind: roomOf(run).kind, who: run.foe.who, title: run.foe.title });
  if (picks[0]) notes.push({ t: "choice", kind: picks[0].kind });
  return { ok: true, notes, fight };
}

/** Walks home early. The run is over, and is still paid for the rooms it cleared. */
export function abandon(run: RunView): Done {
  if (run.stage.phase === "over") return no("raid_over");
  run.stage = { phase: "over", ending: "left" };
  return yes([{ t: "over", won: false }]);
}

// ---------- when it is over ----------

/** What a run amounted to: what the payout and the almanac are worked out from. */
export interface RunSummary {
  trail: number;
  /** How it ended; null for a run not over. */
  ending: Ending | null;
  /** Rooms won. */
  cleared: number;
  /** The furthest room met, counting from 1. */
  reached: number;
  /** Bosses beaten. */
  bosses: BossId[];
  fielded: FigureId[];
  threeStars: FigureId[];
  forged: FinishedId[];
  /** Traits switched on at their top step. */
  topped: TraitId[];
}
export function summariseRun(run: RunView): RunSummary {
  // Bosses and the furthest room count only as far as the course's rooms pay (`RoomTotals`).
  const { paysThrough } = courseOf(run.way);
  const rooms = totalsOf(run);
  return {
    trail: trailOf(run.way),
    ending: endingOf(run),
    cleared: rooms.cleared.length,
    reached: Math.min(paysThrough, Math.max(run.room + 1, rooms.furthest)),
    bosses: rooms.bosses.slice(),
    fielded: run.seen.fielded.slice(),
    threeStars: run.seen.threeStars.slice(),
    forged: run.seen.forged.slice(),
    topped: run.seen.topped.slice(),
  };
}
