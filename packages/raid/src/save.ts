/**
 * A run in progress read back from plain data: as Leaf stored it in a table, or as the page is shown
 * it. A run is plain data, so keeping it is writing it out. Reading is the careful half, done in two
 * layers.
 *
 * The first reads the shape every run of this version has, field by field into a fresh run, and
 * refuses anything else with a word about what was wrong: figures, items and boons the content does
 * not have, numbers that are no numbers, parts that contradict each other. It names none of the
 * numbers that tune the game. The second (`settle`) brings a run of that shape under today's
 * numbers, and refuses nothing: experience past a step makes its levels, the stall and the bench
 * are today's size, a figure holds what a figure may hold now, and the rest is clamped or carried.
 * What the run drew (the stall, who waits in the room, what the picks offer, the fight being
 * fought) and no longer reads is drawn again: the room is laid out afresh, as `layOutAfresh` does.
 *
 * A run saved by an older game of the same version is brought up to date as it is read, each change
 * where its field is read: a field it did not keep yet gets what a new run starts with, and a charm
 * taken before charms were emblems gets its emblem on the item bench.
 */
import { mix } from "@sequoia-leaf/core";

import { BOON_IDS, type BoonId, isBoonId } from "./content/boons.ts";
import { FIGURE_IDS, type FigureId, isBossId, isFigureId, isStars, isUnitKind } from "./content/figures.ts";
import {
  carries,
  EMBLEMS,
  FINISHED_IDS,
  HOLDS,
  isComponentId,
  isEmblemId,
  isFinishedId,
  isItemId,
  type ItemId,
} from "./content/items.ts";
import { ECONOMY, MAX_LEVEL, ROOM_COUNT, TRAIL_COUNT } from "./content/rooms.ts";
import { isTraitId, TRAIT_IDS, traitNumber } from "./content/traits.ts";
import type { FightResult, FightSetup, FightSummary, Tally } from "./fight/types.ts";
import { SEATS } from "./hex.ts";
import { readRoster, type Roster } from "./own.ts";
import { isParty, type Party } from "./party.ts";
import {
  type Choice,
  fielded,
  type Fought,
  gainXp,
  layOutAfresh,
  picksOf,
  type Piece,
  pieces,
  type RoomRecord,
  type Run,
  type RunView,
  sellValue,
  type Stage,
  stallSize,
} from "./run.ts";

/** Thrown by the readers below on the first thing that is wrong, with what it was. */
export class Nonsense extends Error {}
const bad = (what: string): never => {
  throw new Nonsense(what);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const record = (v: unknown, what: string): Record<string, unknown> => (isRecord(v) ? v : bad(what));
const whole = (v: unknown, least: number, most: number, what: string): number =>
  typeof v === "number" && Number.isInteger(v) && v >= least && v <= most ? v : bad(what);
const flag = (v: unknown, what: string): boolean => (typeof v === "boolean" ? v : bad(what));
const list = (v: unknown, most: number, what: string): unknown[] =>
  Array.isArray(v) && v.length <= most ? v : bad(what);
const one = <T>(v: unknown, is: (x: unknown) => x is T, what: string): T => (is(v) ? v : bad(what));
const each = <T>(v: unknown, is: (x: unknown) => x is T, most: number, what: string): T[] =>
  list(v, most, what).map((x) => one(x, is, what));
function unique<T>(items: T[], what: string): T[] {
  return new Set(items).size === items.length ? items : bad(what);
}
const UINT = 0xffffffff;
/** The most of anything a run could keep, whatever the numbers: room for them to grow. */
const ROOMY = 999;

// ---------- the shape ----------

/** What a figure holds, or a note says it holds. */
const readItems = (v: unknown, what: string): ItemId[] => each(v, isItemId, 8, what);
function readPiece(v: unknown, nextId: number): Piece | null {
  if (v === null) return null;
  const p = record(v, "a figure");
  return {
    id: whole(p.id, 1, nextId - 1, "a figure's number"),
    kind: one(p.kind, isFigureId, "a figure's kind"),
    stars: one(p.stars, isStars, "a figure's stars"),
    items: readItems(p.items, "what a figure holds"),
    fed: whole(p.fed, 0, ROOMY, "how much Greg has eaten"),
  };
}
/** A run's roster. A run saved before there were runs with the member's own figures is one on the main way. */
const readOwn = (v: unknown): Roster | null =>
  v === undefined || v === null ? null : (readRoster(v) ?? bad("the roster"));
const isChoiceKind = (v: unknown): v is Choice["kind"] => v === "starter" || v === "component" || v === "boon";
/** A pick waiting, with nothing on offer: as it is shown behind the first, and before it is drawn again. */
function blankChoice(v: unknown): Choice {
  const c = record(v, "a choice");
  const kind = one(c.kind, isChoiceKind, "a choice");
  return kind === "boon"
    ? { kind, options: [], redraws: whole(c.redraws, 0, ROOMY, "the boon redraws") }
    : { kind, options: [] };
}
/** A pick waiting, with what it offers. */
function readChoice(v: unknown): Choice {
  const c = record(v, "a choice");
  if (c.kind === "starter") {
    const options = unique(each(c.options, isFigureId, 8, "the starters"), "the starters");
    return options.length === 0 ? bad("the starters") : { kind: "starter", options };
  }
  if (c.kind === "component") {
    const options = each(c.options, isComponentId, 8, "the components on offer");
    return options.length === 0 ? bad("the components on offer") : { kind: "component", options };
  }
  const blank = blankChoice(c);
  if (blank.kind !== "boon") return bad("a choice");
  const options = unique(each(c.options, isBoonId, 8, "the boons on offer"), "the boons on offer");
  return options.length === 0 ? bad("the boons on offer") : { ...blank, options };
}
const isRoomKind = (v: unknown): v is RoomRecord["kind"] => v === "trouble" || v === "spar" || v === "boss";
function readRecord(v: unknown, room: number): RoomRecord {
  const r = record(v, "the record");
  const result = r.result === "win" || r.result === "loss" || r.result === "draw" ? r.result : bad("the record");
  const standing = list(r.standing, 2, "the record");
  return {
    room: whole(r.room, 0, room, "the record"),
    kind: one(r.kind, isRoomKind, "the record"),
    result,
    standing: [whole(standing[0], 0, 99, "the record"), whole(standing[1], 0, 99, "the record")],
    boss: r.boss === null ? null : one(r.boss, isBossId, "the record"),
  };
}

/** A fight's setup: a seed and two parties. */
function readSetup(v: unknown, what: string): FightSetup {
  const r = record(v, what);
  const sides = list(r.sides, 2, what);
  const ours = one(sides[0], isParty, what);
  const theirs = one(sides[1], isParty, what);
  return { seed: whole(r.seed, 0, UINT, what), sides: [ours, theirs] };
}
/** The last fight's setup. A run saved before it was kept has none. */
const readLast = (v: unknown): FightSetup | null =>
  v === undefined || v === null ? null : readSetup(v, "the last fight");
const isResult = (v: unknown): v is FightResult => v === "win" || v === "loss" || v === "draw";
/** A count kept as a fraction: health, damage. */
const amount = (v: unknown, what: string): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : bad(what);
function readTally(v: unknown, what: string): Tally {
  const t = record(v, what);
  return {
    id: whole(t.id, 0, 10_000, what),
    side: t.side === 0 || t.side === 1 ? t.side : bad(what),
    kind: one(t.kind, isUnitKind, what),
    stars: one(t.stars, isStars, what),
    summoned: flag(t.summoned, what),
    alive: flag(t.alive, what),
    hp: amount(t.hp, what),
    maxHp: amount(t.maxHp, what),
    dealt: amount(t.dealt, what),
    taken: amount(t.taken, what),
    healed: amount(t.healed, what),
    casts: whole(t.casts, 0, 1_000_000, what),
  };
}
/** How a fight came out, as Leaf decided it: read as it was kept, never worked out again. */
function readOutcome(v: unknown, what: string): FightSummary {
  const o = record(v, what);
  const standing = list(o.standing, 2, what);
  return {
    result: one(o.result, isResult, what),
    ticks: whole(o.ticks, 0, 10_000_000, what),
    seconds: amount(o.seconds, what),
    standing: [whole(standing[0], 0, 99, what), whole(standing[1], 0, 99, what)],
    dusk: flag(o.dusk, what),
    units: list(o.units, 400, what).map((u) => readTally(u, what)),
  };
}
/** The fight being fought: its setup, and how Leaf decided it came out. */
function readFought(v: unknown): Fought {
  const fight = record(v, "the fight");
  const setup = readSetup(fight.setup, "the fight");
  if (setup.sides[0].figures.length === 0 || setup.sides[1].figures.length === 0) bad("the fight");
  return { setup, outcome: readOutcome(fight.outcome, "the fight") };
}
function readFoe(v: unknown): Party {
  const foe = one(v, isParty, "who is waiting in the room");
  return foe.figures.length === 0 ? bad("who is waiting in the room") : foe;
}

/** Reading one part of a run: as it is, or what to put in its place if it does not read (`drawn`). */
type Drawn = <T>(read: () => T, otherwise: T, again?: boolean) => T;

/** The picks waiting: the first with what it offers, and (`shown`) the rest by their kind alone. */
const readPicks = (v: unknown, shown: boolean, drawn: Drawn): Choice[] =>
  list(v, 8, "the choices").map((c, i) =>
    shown && i > 0 ? blankChoice(c) : drawn(() => readChoice(c), blankChoice(c)),
  );

/**
 * Where the run stands. A table of version 1 kept it as a phase, the picks, two flags for the ending
 * and the fight beside them; from version 2 it is one value.
 */
function readStage(r: Record<string, unknown>, old: boolean, shown: boolean, drawn: Drawn): Stage {
  const s = old ? r : record(r.stage, "the stage");
  const phase = s.phase === "plan" || s.phase === "fight" || s.phase === "over" ? s.phase : bad("the phase");
  if (phase === "plan") return { phase, picks: readPicks(old ? s.choices : s.picks, shown, drawn) };
  if (phase === "fight") {
    const fight = drawn(() => readFought(s.fight), null);
    return fight ? { phase, fight } : { phase: "plan", picks: [] };
  }
  if (!old)
    return {
      phase,
      ending: s.ending === "won" || s.ending === "lost" || s.ending === "left" ? s.ending : bad("the ending"),
    };
  return { phase, ending: flag(s.won, "the ending") ? "won" : flag(s.left, "the ending") ? "left" : "lost" };
}

/**
 * Everything of a run but its streams. What the run drew and does not read is left to be drawn again
 * (`afresh`), but for a run as the page is shown it, which has no stream to draw it from: that is refused.
 */
function readParts(r: Record<string, unknown>, old: boolean, shown: boolean): { run: RunView; afresh: boolean } {
  let afresh = false;
  const drawn: Drawn = (read, otherwise, again = true) => {
    try {
      return read();
    } catch (err) {
      if (shown || !(err instanceof Nonsense)) throw err;
      afresh ||= again;
      return otherwise;
    }
  };
  const boons: BoonId[] = unique(each(r.boons, isBoonId, BOON_IDS.length, "the boons"), "the boons");
  const room = whole(r.room, 0, ROOMY, "the room");
  const nextId = whole(r.nextId, 1, 1_000_000, "the figures' numbers");
  const board = list(r.board, SEATS, "the board").map((x) => readPiece(x, nextId));
  const bench = list(r.bench, ROOMY, "the bench").map((x) => readPiece(x, nextId));
  if (board.length !== SEATS) bad("the board");
  const ids = [...board, ...bench].flatMap((p) => (p ? [p.id] : []));
  unique(ids, "the figures' numbers");
  const items = each(r.items, isItemId, 400, "the item bench");
  const held = [...board, ...bench].flatMap((p) => p?.items ?? []);
  // A charm taken before a charm was an emblem has none anywhere: it is put on the item bench.
  for (const boon of boons) if (isEmblemId(boon) && !items.includes(boon) && !held.includes(boon)) items.push(boon);
  // Every emblem is its charm's, and there is one of it.
  const emblems = [...items, ...held].filter(isEmblemId);
  if (emblems.some((emblem) => !boons.includes(emblem))) bad("the emblems");
  unique(emblems, "the emblems");
  // A run saved while some figures were locked lists the ones its stall could offer; every figure can now.
  const seen = record(r.seen, "the almanac notes");
  const run: RunView = {
    trail: whole(r.trail, 0, ROOMY, "the trail"),
    room,
    stage: readStage(r, old, shown, drawn),
    resolve: whole(r.resolve, 0, ROOMY, "the resolve"),
    acorns: whole(r.acorns, 0, 100_000, "the acorns"),
    // A run saved before streaks were kept has none.
    streak: r.streak === undefined ? 0 : whole(r.streak, -400, 400, "the streak"),
    level: whole(r.level, 1, ROOMY, "the level"),
    xp: whole(r.xp, 0, 100_000, "the experience"),
    board,
    bench,
    items,
    stall: drawn(
      () =>
        list(r.stall, ROOMY, "the stall").map((x): FigureId | null =>
          x === null ? null : one(x, isFigureId, "the stall"),
        ),
      [],
    ),
    held: flag(r.held, "the held stall"),
    rustles: whole(r.rustles, 0, ROOMY, "the free rustles"),
    bought: whole(r.bought, 0, 10_000, "the figures bought"),
    boons,
    foe: drawn(() => readFoe(r.foe), { who: "", title: "", figures: [], boons: [], might: 100 }),
    record: list(r.record, 400, "the record").map((x) => readRecord(x, room)),
    nextId,
    last: drawn(() => readLast(r.last), null, false),
    own: readOwn(r.own),
    seen: {
      fielded: unique(each(seen.fielded, isFigureId, FIGURE_IDS.length, "the almanac notes"), "the almanac notes"),
      threeStars: unique(
        each(seen.threeStars, isFigureId, FIGURE_IDS.length, "the almanac notes"),
        "the almanac notes",
      ),
      forged: unique(each(seen.forged, isFinishedId, FINISHED_IDS.length, "the almanac notes"), "the almanac notes"),
      topped: unique(each(seen.topped, isTraitId, TRAIT_IDS.length, "the almanac notes"), "the almanac notes"),
    },
  };
  // The parts have to agree with each other, too.
  const picks = picksOf(run);
  if (run.stage.phase === "fight" && fielded(run) === 0) bad("who is fighting");
  if (run.stage.phase !== "over" && run.resolve <= 0) bad("the ending");
  if (run.stage.phase !== "over" && ids.length === 0 && picks[0]?.kind !== "starter") bad("the party");
  if (picks.some((c, i) => c.kind === "starter" && (i > 0 || ids.length > 0))) bad("the choices");
  // A streak is no longer than the rooms fought, and runs the way the last one went.
  const lastResult = run.record.at(-1)?.result;
  if (Math.abs(run.streak) > run.record.length) bad("the streak");
  if (run.streak > 0 && lastResult !== "win") bad("the streak");
  if (run.streak < 0 && lastResult !== "loss") bad("the streak");
  return { run, afresh };
}

/** A run as Leaf keeps it, of table version 1 (`old`) or since: with its streams, under today's numbers. */
function readRun(v: unknown, old: boolean): Run {
  const r = record(v, "the run");
  const { run: parts, afresh } = readParts(r, old, false);
  const run: Run = {
    seed: whole(r.seed, 0, UINT, "the seed"),
    rng: whole(r.rng, 0, UINT, "the random stream"),
    ...parts,
  };
  if (afresh && run.stage.phase !== "over") layOutAfresh(run, mix(run.rng, 0xa7e5));
  settle(run);
  return run;
}

// ---------- today's numbers ----------

/**
 * Brings a run of the right shape under today's numbers, and refuses nothing. The trail, the room,
 * the level and resolve go no higher than they go now; experience past a level's step makes the
 * levels it makes; the stall is today's size, cut or filled out with empty places; the bench is
 * today's size, its figures past the end moved up into empty places or, with none, sold for what
 * they are worth; a figure holds what a figure may hold now (as many, one loose component, no
 * emblem of a kin it is), and the rest goes to the item bench; Greg has eaten no more than he eats,
 * and nobody else anything; a pick of boons has no more redraws than one has now.
 */
function settle(run: Run): void {
  run.trail = Math.min(run.trail, TRAIL_COUNT - 1);
  run.room = Math.min(run.room, ROOM_COUNT - 1);
  run.resolve = Math.min(run.resolve, ECONOMY.resolve);
  run.level = Math.min(run.level, MAX_LEVEL);
  gainXp(run, 0, []);
  if (run.level >= MAX_LEVEL) run.xp = 0;
  const offers = stallSize(run);
  run.stall = Array.from({ length: offers }, (_, i) => run.stall[i] ?? null);
  const bench = Array.from({ length: ECONOMY.bench }, (_, i) => run.bench[i] ?? null);
  for (const piece of run.bench.slice(ECONOMY.bench)) {
    if (!piece) continue;
    const free = bench.indexOf(null);
    if (free >= 0) bench[free] = piece;
    else {
      run.acorns += sellValue(piece);
      run.items.push(...piece.items);
    }
  }
  run.bench = bench;
  for (const piece of pieces(run)) {
    const held: ItemId[] = [];
    for (const item of piece.items) {
      const fits =
        held.length < HOLDS &&
        !(isComponentId(item) && held.some(isComponentId)) &&
        !(isEmblemId(item) && carries(piece.kind, held, EMBLEMS[item]));
      (fits ? held : run.items).push(item);
    }
    piece.items = held;
    piece.fed = piece.kind === "greg" ? Math.min(piece.fed, traitNumber("greg", "most", 1)) : 0;
  }
  for (const choice of picksOf(run)) {
    if (choice.kind === "boon") choice.redraws = Math.min(choice.redraws, ECONOMY.boonRedraws);
  }
}

export type Loaded = { ok: true; run: Run } | { ok: false; why: string };

/** A run as Leaf keeps it in a table of version 1 (`old`) or since; or the reason the data is not one. */
export function checkRun(v: unknown, old = false): Loaded {
  try {
    return { ok: true, run: readRun(v, old) };
  } catch (err) {
    if (err instanceof Nonsense) return { ok: false, why: `That raid does not add up: ${err.message} is wrong.` };
    throw err;
  }
}

/** A run as the page is shown it (no streams, only the first pick's options), or null for one these rules could not have made. */
export function readRunView(v: unknown): RunView | null {
  try {
    return readParts(record(v, "the run"), false, true).run;
  } catch (err) {
    if (err instanceof Nonsense) return null;
    throw err;
  }
}

/** The readers above, for reading other plain data the same way: each throws `Nonsense` naming what was wrong. */
export const fields = {
  record,
  whole,
  flag,
  list,
  one,
  each,
  unique,
  items: readItems,
  setup: readSetup,
  outcome: readOutcome,
  bad,
};
