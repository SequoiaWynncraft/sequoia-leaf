import { BOON_IDS, isBoonId } from "./content/boons.ts";
/**
 * Reading back what Leaf sends the page: the table's view and the notes of each command, field by
 * field, into the game's own types. Anything that does not read is a view or a note this version of
 * the rules could not have made: the page was built for other rules than Leaf's, and loads again.
 * A fight's outcome is not read but worked out again from its setup, which gives the same.
 */
import { BOSS_IDS, FIGURE_IDS, isBossId, isFigureId, isStars } from "./content/figures.ts";
import { FINISHED_IDS, isComponentId, isFinishedId, isItemId } from "./content/items.ts";
import { baseOf, clothOf, isLookKind, lanternOf, readLooks } from "./content/looks.ts";
import { ECONOMY, MAX_LEVEL, ROOM_COUNT, TRAIL_COUNT } from "./content/rooms.ts";
import { isTraitId, TRAIT_IDS } from "./content/traits.ts";
import { resolveFight } from "./fight/engine.ts";
import { type RaidNote, type RunView, runView, type TableView } from "./game.ts";
import { type News, type Payout, readAlmanac, trailOpen } from "./outside.ts";
import { ACORNS_WHYS, type AcornsWhy, type Note, type RunSummary, type Spot } from "./run.ts";
import { checkRun, fields, Nonsense } from "./save.ts";

const { record, whole, flag, list, one, each, items, setup, bad } = fields;
const UINT = 0xffffffff;
const MOST = 1_000_000;

const isRoomKind = (v: unknown): v is "trouble" | "spar" | "boss" => v === "trouble" || v === "spar" || v === "boss";
const text = (v: unknown, what: string): string => (typeof v === "string" && v.length <= 200 ? v : bad(what));

/** A run as the page is shown it. */
function runOf(v: unknown, what: string): RunView {
  const read = checkRun(v, true);
  return read.ok ? runView(read.run) : bad(what);
}

/** The table as Leaf shows it to the page, or null for anything this version could not have sent. */
export function readView(v: unknown): TableView | null {
  try {
    const r = record(v, "the table");
    const almanac = readAlmanac(r.almanac) ?? bad("the almanac");
    const looks = readLooks(r.looks) ?? bad("the looks");
    const trail = whole(r.trail, 0, TRAIL_COUNT - 1, "the trail");
    if (!trailOpen(almanac, trail)) bad("the trail");
    const run = r.run === null ? null : runOf(r.run, "the run");
    if (run?.phase === "over") bad("the run");
    return { runs: whole(r.runs, 0, 1_000_000_000, "the runs"), run, almanac, trail, looks };
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
    won: flag(s.won, what),
    left: flag(s.left, what),
    cleared: whole(s.cleared, 0, ROOM_COUNT, what),
    reached: whole(s.reached, 0, ROOM_COUNT, what),
    bosses: each(s.bosses, isBossId, BOSS_IDS.length, what),
    fielded: each(s.fielded, isFigureId, FIGURE_IDS.length, what),
    threeStars: each(s.threeStars, isFigureId, FIGURE_IDS.length, what),
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

const isAcornsWhy = (v: unknown): v is AcornsWhy => ACORNS_WHYS.some((why) => why === v);
const isResult = (v: unknown): v is "win" | "loss" | "draw" => v === "win" || v === "loss" || v === "draw";
const isChoiceKind = (v: unknown): v is "starter" | "component" | "boon" =>
  v === "starter" || v === "component" || v === "boon";

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
      if (n.why !== "basket") return bad(what);
      return { t: "items", why: "basket", items: each(n.items, isItemId, 8, what) };
    case "resolve":
      return {
        t: "resolve",
        change: whole(n.change, -ECONOMY.resolve, ECONOMY.resolve, what),
        left: whole(n.left, 0, ECONOMY.resolve, what),
      };
    case "fight": {
      const fought = setup(n.setup, what);
      return {
        t: "fight",
        room: whole(n.room, 0, ROOM_COUNT - 1, what),
        seed: whole(n.seed, 0, UINT, what),
        setup: fought,
        outcome: resolveFight(fought),
      };
    }
    case "result": {
      const standing = list(n.standing, 2, what);
      return {
        t: "result",
        room: whole(n.room, 0, ROOM_COUNT - 1, what),
        result: one(n.result, isResult, what),
        standing: [whole(standing[0], 0, 99, what), whole(standing[1], 0, 99, what)],
      };
    }
    case "fed":
      return { t: "fed", piece: piece(n.piece), fed: whole(n.fed, 0, 99, what) };
    case "choice":
      return { t: "choice", kind: one(n.kind, isChoiceKind, what) };
    case "room":
      return {
        t: "room",
        room: whole(n.room, 0, ROOM_COUNT - 1, what),
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
      };
    case "trail":
      return { t: "trail", trail: whole(n.trail, 0, TRAIL_COUNT - 1, "a note") };
    case "look": {
      const kind = one(n.kind, isLookKind, "a note");
      const id = kind === "cloth" ? clothOf(n.id) : kind === "lantern" ? lanternOf(n.id) : baseOf(n.id);
      return id === null ? bad("a note") : { t: "look", kind, id };
    }
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
