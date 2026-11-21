/**
 * A run in progress as text, and back. A run is plain data, so saving is writing it out with a
 * version on it. Loading is the careful half: the text is read field by field into a fresh run,
 * and anything that is not a run this version of the game could have made is refused, with a word
 * about what was wrong. A fight in progress is not saved; a run saved mid-fight loads back to the
 * start of that fight, which plays out the same from its seed.
 */
import { BOON_IDS, type BoonId, boonNumber, isBoonId } from "./content/boons.ts";
import { type FigureId, FIGURES, isBossId, isFigureId, isStars } from "./content/figures.ts";
import { HOLDS, isComponentId, isFinishedId, isItemId, type ItemId } from "./content/items.ts";
import { ECONOMY, MAX_LEVEL, ROOM_COUNT, ROOMS, TRAIL_COUNT } from "./content/rooms.ts";
import { isTraitId, traitNumber } from "./content/traits.ts";
import { SEATS } from "./hex.ts";
import { isParty } from "./party.ts";
import { type Choice, fieldCap, fielded, type Piece, type RoomRecord, type Run } from "./run.ts";

export const SAVE_VERSION = 1;
const GAME = "little-raid";

/** A run as text. */
export const saveRun = (run: Run): string => JSON.stringify({ game: GAME, v: SAVE_VERSION, run });

class Nonsense extends Error {}
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

function readItems(v: unknown, what: string): ItemId[] {
  const items = each(v, isItemId, HOLDS, what);
  // A figure never holds two loose components: the second would have forged with the first.
  return items.filter(isComponentId).length > 1 ? bad(what) : items;
}
function readPiece(v: unknown, nextId: number): Piece | null {
  if (v === null) return null;
  const p = record(v, "a figure");
  const kind = one(p.kind, isFigureId, "a figure's kind");
  return {
    id: whole(p.id, 1, nextId - 1, "a figure's number"),
    kind,
    stars: one(p.stars, isStars, "a figure's stars"),
    items: readItems(p.items, "what a figure holds"),
    fed: whole(p.fed, 0, kind === "greg" ? traitNumber("greg", "most", 1) : 0, "how much Greg has eaten"),
  };
}
function readChoice(v: unknown): Choice {
  const c = record(v, "a choice");
  if (c.kind === "starter") {
    const options = unique(each(c.options, isFigureId, 8, "the starters"), "the starters");
    if (options.length === 0 || options.some((id) => FIGURES[id].tier !== 1)) bad("the starters");
    return { kind: "starter", options };
  }
  if (c.kind === "component") {
    const options = each(c.options, isComponentId, 8, "the components on offer");
    return options.length === 0 ? bad("the components on offer") : { kind: "component", options };
  }
  if (c.kind === "boon") {
    const options = unique(each(c.options, isBoonId, 8, "the boons on offer"), "the boons on offer");
    if (options.length === 0) bad("the boons on offer");
    return { kind: "boon", options, redraws: whole(c.redraws, 0, ECONOMY.boonRedraws, "the boon redraws") };
  }
  return bad("a choice");
}
function readRecord(v: unknown, room: number): RoomRecord {
  const r = record(v, "the record");
  const at = whole(r.room, 0, room, "the record");
  const kind = ROOMS[at]?.kind ?? bad("the record");
  if (r.kind !== kind) bad("the record");
  const result = r.result === "win" || r.result === "loss" || r.result === "draw" ? r.result : bad("the record");
  const standing = list(r.standing, 2, "the record");
  return {
    room: at,
    kind,
    result,
    standing: [whole(standing[0], 0, 99, "the record"), whole(standing[1], 0, 99, "the record")],
    boss: r.boss === null ? null : one(r.boss, isBossId, "the record"),
  };
}

function readRun(v: unknown): Run {
  const r = record(v, "the run");
  const boons: BoonId[] = unique(each(r.boons, isBoonId, BOON_IDS.length, "the boons"), "the boons");
  const level = whole(r.level, 1, MAX_LEVEL, "the level");
  const need = level >= MAX_LEVEL ? 1 : (ECONOMY.levelXp[level - 1] ?? 1);
  const room = whole(r.room, 0, ROOM_COUNT - 1, "the room");
  const nextId = whole(r.nextId, 1, 1_000_000, "the figures' numbers");
  const phase = r.phase === "plan" || r.phase === "fight" || r.phase === "over" ? r.phase : bad("the phase");
  const stallSize = boons.includes("widestall") ? boonNumber("widestall", "offers") : ECONOMY.stall;
  const stall = list(r.stall, stallSize, "the stall").map((x): FigureId | null =>
    x === null ? null : one(x, isFigureId, "the stall"),
  );
  if (stall.length !== stallSize) bad("the stall");
  const board = list(r.board, SEATS, "the board").map((x) => readPiece(x, nextId));
  const bench = list(r.bench, ECONOMY.bench, "the bench").map((x) => readPiece(x, nextId));
  if (board.length !== SEATS) bad("the board");
  if (bench.length !== ECONOMY.bench) bad("the bench");
  const ids = [...board, ...bench].flatMap((p) => (p ? [p.id] : []));
  unique(ids, "the figures' numbers");
  const open = unique(each(r.open, isFigureId, 64, "the open figures"), "the open figures");
  if (!open.some((id) => FIGURES[id].tier === 1)) bad("the open figures");
  const seen = record(r.seen, "the almanac notes");
  const foe = one(r.foe, isParty, "who is waiting in the room");
  if (foe.figures.length === 0) bad("who is waiting in the room");
  const run: Run = {
    seed: whole(r.seed, 0, UINT, "the seed"),
    rng: whole(r.rng, 0, UINT, "the random stream"),
    trail: whole(r.trail, 0, TRAIL_COUNT - 1, "the trail"),
    room,
    phase,
    resolve: whole(r.resolve, 0, ECONOMY.resolve, "the resolve"),
    acorns: whole(r.acorns, 0, 100_000, "the acorns"),
    level,
    xp: whole(r.xp, 0, need - 1, "the experience"),
    board,
    bench,
    items: each(r.items, isItemId, 400, "the item bench"),
    stall,
    held: flag(r.held, "the held stall"),
    rustles: whole(r.rustles, 0, 8, "the free rustles"),
    bought: whole(r.bought, 0, 10_000, "the figures bought"),
    boons,
    choices: list(r.choices, 8, "the choices").map(readChoice),
    foe,
    record: list(r.record, 400, "the record").map((x) => readRecord(x, room)),
    nextId,
    open,
    won: flag(r.won, "the ending"),
    left: flag(r.left, "the ending"),
    seen: {
      fielded: unique(each(seen.fielded, isFigureId, 64, "the almanac notes"), "the almanac notes"),
      threeStars: unique(each(seen.threeStars, isFigureId, 64, "the almanac notes"), "the almanac notes"),
      forged: unique(each(seen.forged, isFinishedId, 64, "the almanac notes"), "the almanac notes"),
      topped: unique(each(seen.topped, isTraitId, 64, "the almanac notes"), "the almanac notes"),
    },
  };
  // The parts have to agree with each other, too.
  if (fielded(run) > fieldCap(run)) bad("how many are on the board");
  if (run.phase === "fight" && fielded(run) === 0) bad("who is fighting");
  if (run.phase !== "over" && (run.won || run.left || run.resolve <= 0)) bad("the ending");
  if (run.won && (run.left || run.resolve <= 0)) bad("the ending");
  if (run.phase !== "over" && ids.length === 0 && run.choices[0]?.kind !== "starter") bad("the party");
  if (run.choices.some((c, i) => c.kind === "starter" && (i > 0 || ids.length > 0))) bad("the choices");
  return run;
}

export type Loaded = { ok: true; run: Run } | { ok: false; why: string };
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
