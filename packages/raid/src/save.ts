/**
 * A run in progress as plain data and as text, and back. A run is plain data, so saving is writing
 * it out with a version on it. Reading is the careful half, done in two layers.
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
import { FIGURE_IDS, type FigureId, isBossId, isFigureId, isStars } from "./content/figures.ts";
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
import { resolveFight } from "./fight/engine.ts";
import type { FightSetup } from "./fight/types.ts";
import { SEATS } from "./hex.ts";
import { isParty, type Party } from "./party.ts";
import {
  type Choice,
  fielded,
  type Fought,
  gainXp,
  layOutAfresh,
  type Piece,
  pieces,
  type RoomRecord,
  type Run,
  sellValue,
  stallSize,
} from "./run.ts";

/** The version a run is written with: 2 keeps the fight being fought. */
export const SAVE_VERSION = 2;
const GAME = "little-raid";

/** A run as text. */
export const saveRun = (run: Run): string => JSON.stringify({ game: GAME, v: SAVE_VERSION, run });

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
/** The fight being fought, while there is one: its setup, and how it comes out, worked out again from that. */
function readFought(v: unknown, fighting: boolean): Fought | null {
  if (!fighting) return v === undefined || v === null ? null : bad("the fight");
  const setup = readSetup(v === undefined || v === null ? bad("the fight") : record(v, "the fight").setup, "the fight");
  if (setup.sides[0].figures.length === 0 || setup.sides[1].figures.length === 0) bad("the fight");
  return { setup, outcome: resolveFight(setup) };
}
function readFoe(v: unknown): Party {
  const foe = one(v, isParty, "who is waiting in the room");
  return foe.figures.length === 0 ? bad("who is waiting in the room") : foe;
}

/**
 * A run, or (`shown`) a run as the page is shown it: with no streams, and only the first pick's
 * options. What the run drew and no longer reads is drawn again; a run as shown has no stream to
 * draw it from, and is refused.
 */
function readRun(v: unknown, shown = false): Run {
  const r = record(v, "the run");
  let afresh = false;
  /** A part the run drew: read, or (on Leaf) `otherwise`, and drawn again unless it is only looked back on. */
  const drawn = <T>(read: () => T, otherwise: T, again = true): T => {
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
  const phase = r.phase === "plan" || r.phase === "fight" || r.phase === "over" ? r.phase : bad("the phase");
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
  const run: Run = {
    seed: shown ? 0 : whole(r.seed, 0, UINT, "the seed"),
    rng: shown ? 0 : whole(r.rng, 0, UINT, "the random stream"),
    trail: whole(r.trail, 0, ROOMY, "the trail"),
    room,
    phase,
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
    choices: list(r.choices, 8, "the choices").map((c, i) =>
      shown && i > 0 ? blankChoice(c) : drawn(() => readChoice(c), blankChoice(c)),
    ),
    foe: drawn(() => readFoe(r.foe), { who: "", title: "", figures: [], boons: [], might: 100 }),
    record: list(r.record, 400, "the record").map((x) => readRecord(x, room)),
    nextId,
    won: flag(r.won, "the ending"),
    left: flag(r.left, "the ending"),
    last: drawn(() => readLast(r.last), null, false),
    fight: drawn(() => readFought(r.fight, phase === "fight"), null),
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
  if (run.phase === "fight" && fielded(run) === 0) bad("who is fighting");
  if (run.phase !== "over" && (run.won || run.left || run.resolve <= 0)) bad("the ending");
  if (run.won && (run.left || run.resolve <= 0)) bad("the ending");
  if (run.phase !== "over" && ids.length === 0 && run.choices[0]?.kind !== "starter") bad("the party");
  if (run.choices.some((c, i) => c.kind === "starter" && (i > 0 || ids.length > 0))) bad("the choices");
  // A streak is no longer than the rooms fought, and runs the way the last one went.
  const lastResult = run.record.at(-1)?.result;
  if (Math.abs(run.streak) > run.record.length) bad("the streak");
  if (run.streak > 0 && lastResult !== "win") bad("the streak");
  if (run.streak < 0 && lastResult !== "loss") bad("the streak");
  if (afresh && run.phase !== "over") layOutAfresh(run, mix(run.rng, 0xa7e5));
  if (!shown) settle(run);
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
  for (const choice of run.choices) {
    if (choice.kind === "boon") choice.redraws = Math.min(choice.redraws, ECONOMY.boonRedraws);
  }
}

export type Loaded = { ok: true; run: Run } | { ok: false; why: string };

/**
 * A run from plain data, as `JSON.parse` gives it back; or the reason the data is not one. `shown`
 * reads a run as the page is shown it, with no streams (they come back as 0) and nothing of what the
 * picks after the first will offer.
 */
export function checkRun(v: unknown, shown = false): Loaded {
  try {
    return { ok: true, run: readRun(v, shown) };
  } catch (err) {
    if (err instanceof Nonsense) return { ok: false, why: `That raid does not add up: ${err.message} is wrong.` };
    throw err;
  }
}

/** A run from text, exactly as it was saved; or the reason the text is not one. */
export function loadRun(text: string): Loaded {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: "That is not a saved raid." };
  }
  if (!isRecord(raw) || raw.game !== GAME) return { ok: false, why: "That is not a saved raid." };
  if (raw.v !== SAVE_VERSION) return { ok: false, why: "That raid was saved by a different version of the game." };
  try {
    return { ok: true, run: readRun(raw.run) };
  } catch (err) {
    if (err instanceof Nonsense) return { ok: false, why: `That saved raid does not add up: ${err.message} is wrong.` };
    throw err;
  }
}

/** The readers above, for reading other plain data the same way: each throws `Nonsense` naming what was wrong. */
export const fields = { record, whole, flag, list, one, each, unique, items: readItems, setup: readSetup, bad };
