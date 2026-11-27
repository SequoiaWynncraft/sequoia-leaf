import { BOON_IDS, isBoonId } from "./content/boons.ts";
import { everyFigure } from "./content/catalog.ts";
import { isEndlessWay } from "./content/endless.ts";
/**
 * Reading back what Leaf sends the page: the table's view and the notes of each command, field by
 * field, into the game's own types. Anything that does not read is a view or a note this version of
 * the rules could not have made: the page was built for other rules than Leaf's, and loads again.
 * A fight's outcome is read as Leaf decided it: the page plays the fight from its setup, and loads
 * again if its rules do not play it to that (`playsAsKept`).
 */
import { BOSS_IDS, isBossId, isFigureId, isStars } from "./content/figures.ts";
import { FINISHED_IDS, isComponentId, isFinishedId, isItemId } from "./content/items.ts";
import { isLookKind, lookOf, readLooks } from "./content/looks.ts";
import { isEra } from "./content/releases.ts";
import { ECONOMY, MAX_LEVEL, ROOM_COUNT, TRAIL_COUNT } from "./content/rooms.ts";
import { isTraitId, TRAIT_IDS } from "./content/traits.ts";
import { readApart, readWeek } from "./depths.ts";
import type { Fed } from "./feed.ts";
import type { RaidNote, RunView, TableView } from "./game.ts";
import { type News, type Payout, readAlmanac, trailOpen } from "./outside.ts";
import { readRoster } from "./own.ts";
import { ACORNS_WHYS, type AcornsWhy, type Ending, type Note, type RunSummary, type Spot } from "./run.ts";
import { fields, Nonsense, readRunView } from "./save.ts";
import { type Slot, slotOf } from "./way.ts";

const { record, whole, flag, list, one, each, items, setup, outcome, bad } = fields;
const UINT = 0xffffffff;
const MOST = 1_000_000;
/** The furthest room a note may name: an endless run's go past the fifteenth. */
const ROOMY = 9999;

const isRoomKind = (v: unknown): v is "trouble" | "spar" | "boss" => v === "trouble" || v === "spar" || v === "boss";
const text = (v: unknown, what: string): string => (typeof v === "string" && v.length <= 200 ? v : bad(what));

/** A run as the page is shown it. */
const runOf = (v: unknown, what: string): RunView => readRunView(v) ?? bad(what);
/** The run held in a slot of a table as the page is shown it, or none: one of another slot (`slotOf` its way), or over, is not. */
function heldOf(v: unknown, slot: Slot): RunView | null {
  const what = `the run held in ${slot}`;
  const run = v === null ? null : runOf(v, what);
  return run && (run.stage.phase === "over" || slotOf(run.way) !== slot) ? bad(what) : run;
}
const isEnding = (v: unknown): v is Ending => v === "won" || v === "lost" || v === "left";

/** The table as Leaf shows it to the page, or null for anything this version could not have sent. */
export function readView(v: unknown): TableView | null {
  try {
    const r = record(v, "the table");
    const almanac = readAlmanac(r.almanac) ?? bad("the almanac");
    const looks = readLooks(r.looks) ?? bad("the looks");
    const trail = whole(r.trail, 0, TRAIL_COUNT - 1, "the trail");
    if (!trailOpen(almanac, trail)) bad("the trail");
    const held = record(r.held, "the runs held");
    const begun = record(r.begun, "the runs begun");
    return {
      era: one(r.era, isEra, "the era"),
      begun: {
        main: whole(begun.main, 0, 1_000_000_000, "the runs"),
        endless: whole(begun.endless, 0, 1_000_000_000, "the endless runs"),
      },
      held: { main: heldOf(held.main, "main"), endless: heldOf(held.endless, "endless") },
      week: readWeek(r.week),
      apart: readApart(r.apart),
      almanac,
      trail,
      looks,
      roster: readRoster(r.roster) ?? bad("the roster"),
    };
  } catch (err) {
    if (err instanceof Nonsense) return null;
    throw err;
  }
}

function spot(v: unknown, what: string): Spot {
  const s = record(v, what);
  if (s.on !== "board" && s.on !== "bench") return bad(what);
  return { on: s.on, at: whole(s.at, 0, 63, what) };
}
const piece = (v: unknown): number => whole(v, 1, MOST, "a figure's number");

function summaryOf(v: unknown): RunSummary {
  const s = record(v, "what the run came to");
  const what = "what the run came to";
  return {
    trail: whole(s.trail, 0, TRAIL_COUNT - 1, what),
    ending: s.ending === null ? null : one(s.ending, isEnding, what),
    cleared: whole(s.cleared, 0, ROOM_COUNT, what),
    reached: whole(s.reached, 0, ROOM_COUNT, what),
    bosses: each(s.bosses, isBossId, BOSS_IDS.length, what),
    fielded: each(s.fielded, isFigureId, everyFigure().length, what),
    threeStars: each(s.threeStars, isFigureId, everyFigure().length, what),
    forged: each(s.forged, isFinishedId, FINISHED_IDS.length, what),
    topped: each(s.topped, isTraitId, TRAIT_IDS.length, what),
  };
}

const isWhy = (x: unknown): x is Payout["lines"][number]["why"] =>
  x === "rooms" || x === "bosses" || x === "win" || x === "trail" || x === "full";
function payoutOf(v: unknown): Payout {
  const p = record(v, "what the run paid");
  return {
    coins: whole(p.coins, 0, MOST, "what the run paid"),
    lines: list(p.lines, 8, "what the run paid").map((l) => {
      const line = record(l, "what the run paid");
      return { why: one(line.why, isWhy, "what the run paid"), coins: whole(line.coins, 0, MOST, "what the run paid") };
    }),
  };
}

function newsOf(v: unknown): News {
  const n = record(v, "what is new");
  const what = "what is new";
  switch (n.t) {
    case "fielded":
    case "threeStars":
      return { t: n.t, figure: one(n.figure, isFigureId, what) };
    case "forged":
      return { t: "forged", item: one(n.item, isFinishedId, what) };
    case "topped":
      return { t: "topped", trait: one(n.trait, isTraitId, what) };
    case "boss":
      return { t: "boss", boss: one(n.boss, isBossId, what), trail: whole(n.trail, 0, TRAIL_COUNT - 1, what) };
    case "best":
      return { t: "best", trail: whole(n.trail, 0, TRAIL_COUNT - 1, what), room: whole(n.room, 0, ROOM_COUNT, what) };
    case "trail":
      return { t: "trail", trail: whole(n.trail, 0, TRAIL_COUNT - 1, what) };
    default:
      return bad(what);
  }
}

/** Greg ate a figure from the bench. */
const fedOf = (n: Record<string, unknown>, what: string): Fed => ({
  t: "fed",
  piece: piece(n.piece),
  fed: whole(n.fed, 0, 99, what),
  gained: whole(n.gained, 0, 99, what),
  ate: piece(n.ate),
  kind: one(n.kind, isFigureId, what),
  stars: one(n.stars, isStars, what),
  from: spot(n.from, what),
  items: each(n.items, isItemId, 3, what),
});
const isAcornsWhy = (v: unknown): v is AcornsWhy => ACORNS_WHYS.some((why) => why === v);
const isResult = (v: unknown): v is "win" | "loss" | "draw" => v === "win" || v === "loss" || v === "draw";
const isChoiceKind = (v: unknown): v is "starter" | "component" | "boon" | "rule" =>
  v === "starter" || v === "component" || v === "boon" || v === "rule";

/** One of the run's own notes. */
function runNote(n: Record<string, unknown>): Note {
  const what = `a "${String(n.t)}" note`;
  switch (n.t) {
    case "starter":
      return { t: "starter", kind: one(n.kind, isFigureId, what), piece: piece(n.piece), to: spot(n.to, what) };
    case "component":
      return { t: "component", item: one(n.item, isComponentId, what) };
    case "boon":
      return { t: "boon", boon: one(n.boon, isBoonId, what) };
    case "redrawn":
      return { t: "redrawn", options: each(n.options, isBoonId, BOON_IDS.length, what) };
    case "bought":
      return {
        t: "bought",
        kind: one(n.kind, isFigureId, what),
        piece: piece(n.piece),
        offer: whole(n.offer, 0, 15, what),
        cost: whole(n.cost, 0, 99, what),
        to: n.to === null ? null : spot(n.to, what),
      };
    case "merged":
      return {
        t: "merged",
        kind: one(n.kind, isFigureId, what),
        stars: one(n.stars, isStars, what),
        piece: piece(n.piece),
        at: spot(n.at, what),
        gone: list(n.gone, 2, what).map(piece),
        items: items(n.items, what),
        spilled: each(n.spilled, isItemId, 9, what),
      };
    case "sold":
      return {
        t: "sold",
        kind: one(n.kind, isFigureId, what),
        stars: one(n.stars, isStars, what),
        piece: piece(n.piece),
        from: spot(n.from, what),
        acorns: whole(n.acorns, 0, 99, what),
        items: each(n.items, isItemId, 3, what),
      };
    case "moved":
      return {
        t: "moved",
        piece: piece(n.piece),
        from: spot(n.from, what),
        to: spot(n.to, what),
        swapped: n.swapped === null ? null : piece(n.swapped),
      };
    case "rustled":
      return {
        t: "rustled",
        cost: whole(n.cost, 0, 99, what),
        stall: list(n.stall, 8, what).map((k) => (k === null ? null : one(k, isFigureId, what))),
      };
    case "held":
      return { t: "held", on: flag(n.on, what) };
    case "xp":
      return { t: "xp", gained: whole(n.gained, 0, 99, what), cost: whole(n.cost, 0, 99, what) };
    case "level":
      return { t: "level", level: whole(n.level, 1, MAX_LEVEL, what) };
    case "gave":
      return {
        t: "gave",
        item: one(n.item, isItemId, what),
        piece: piece(n.piece),
        forged: n.forged === null ? null : one(n.forged, isFinishedId, what),
        holds: items(n.holds, what),
      };
    case "acorns":
      return { t: "acorns", why: one(n.why, isAcornsWhy, what), amount: whole(n.amount, 0, 999, what) };
    case "items":
      if (n.why !== "basket" && n.why !== "charm") return bad(what);
      return { t: "items", why: n.why, items: each(n.items, isItemId, 8, what) };
    case "resolve":
      return {
        t: "resolve",
        change: whole(n.change, -ECONOMY.resolve, ECONOMY.resolve, what),
        left: whole(n.left, 0, ECONOMY.resolve, what),
      };
    case "fight":
      return {
        t: "fight",
        room: whole(n.room, 0, ROOMY, what),
        seed: whole(n.seed, 0, UINT, what),
        setup: setup(n.setup, what),
        outcome: outcome(n.outcome, what),
      };
    case "result": {
      const standing = list(n.standing, 2, what);
      return {
        t: "result",
        room: whole(n.room, 0, ROOMY, what),
        result: one(n.result, isResult, what),
        standing: [whole(standing[0], 0, 99, what), whole(standing[1], 0, 99, what)],
      };
    }
    case "fed":
      return fedOf(n, what);
    case "choice":
      return { t: "choice", kind: one(n.kind, isChoiceKind, what) };
    case "room":
      return {
        t: "room",
        room: whole(n.room, 0, ROOMY, what),
        kind: one(n.kind, isRoomKind, what),
        who: text(n.who, what),
        title: text(n.title, what),
      };
    case "over":
      return { t: "over", won: flag(n.won, what) };
    default:
      return bad("a note");
  }
}

function noteOf(v: unknown): RaidNote {
  const n = record(v, "a note");
  switch (n.t) {
    case "started":
      return {
        t: "started",
        trail: whole(n.trail, 0, TRAIL_COUNT - 1, "a note"),
        run: whole(n.run, 1, 1_000_000_000, "a note"),
        ...(n.endless === undefined ? {} : { endless: one(n.endless, isEndlessWay, "a note") }),
      };
    case "trail":
      return { t: "trail", trail: whole(n.trail, 0, TRAIL_COUNT - 1, "a note") };
    case "look": {
      const kind = one(n.kind, isLookKind, "a note");
      const id = lookOf(kind, n.id);
      return id === null ? bad("a note") : { t: "look", kind, id };
    }
    case "made":
      return { t: "made", item: one(n.item, isFinishedId, "a note"), at: whole(n.at, 0, 399, "a note") };
    case "shifted":
      return { t: "shifted", piece: piece(n.piece), from: whole(n.from, 0, 63, "a note"), to: spot(n.to, "a note") };
    case "ended":
      return {
        t: "ended",
        run: runOf(n.run, "the run that ended"),
        summary: summaryOf(n.summary),
        paid: payoutOf(n.paid),
        news: list(n.news, 200, "what is new").map(newsOf),
      };
    default:
      return runNote(n);
  }
}

/** The notes of a command as Leaf sent them, or null for any this version could not have made. */
export function readNotes(v: unknown): RaidNote[] | null {
  try {
    return list(v, 400, "the notes").map(noteOf);
  } catch (err) {
    if (err instanceof Nonsense) return null;
    throw err;
  }
}
