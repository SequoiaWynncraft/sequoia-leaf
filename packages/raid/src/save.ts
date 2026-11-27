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
 * taken before charms were emblems gets its emblem on the item bench. A run kept when Greg ate a meal
 * after every fight (`meals`: a table before version 5, a sitting before version 2) has each meal
 * counted as the share of health it gave him (`MEAL`). A run kept before it kept its way (a table
 * before version 8, a sitting before version 4) has it read from its trail, roster and endless way.
 */
import { mix } from "@sequoia-leaf/core";

import { BOON_IDS, type BoonId, isBoonId } from "./content/boons.ts";
import { catalogOf, everyFigure } from "./content/catalog.ts";
import { type FigureId, isBossId, isFigureId, isStars, isUnitKind } from "./content/figures.ts";
import { FINISHED_IDS, isComponentId, isEmblemId, isFinishedId, isItemId, type ItemId } from "./content/items.ts";
import { holdItem } from "./content/recipes.ts";
import { type Era, isEra, LEGACY_ERA } from "./content/releases.ts";
import { ECONOMY, MAX_LEVEL } from "./content/rooms.ts";
import { type FightRules, ROOM_RULES, ruled } from "./content/rules.ts";
import { isTraitId, renamedTitle, renamedTraits, TRAIT_IDS, traitNumber } from "./content/traits.ts";
import { isRuleId, RULE_IDS } from "./content/wilds.ts";
import { lastRoom } from "./endless.ts";
import type { FightResult, FightSetup, FightSummary, Tally } from "./fight/types.ts";
import { SEATS } from "./hex.ts";
import { isParty, type Party } from "./party.ts";
import { setupRules } from "./room.ts";
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
import { oldRunWay, onTrailThere, readWay, type Way } from "./way.ts";
import { pickAgain } from "./wilds.ts";
import type { Wing } from "./wing.ts";

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

/** The share of his health one of Greg's meals gave him, when he ate one after every fight (before `feed`). */
const MEAL = 3;
/** What Greg has eaten, as a share of his health: kept as that, or (`meals`) as meals of `MEAL` each. */
const fedOf = (v: unknown, meals: boolean): number =>
  whole(v, 0, ROOMY, "how much Greg has eaten") * (meals ? MEAL : 1);

/** What a figure holds, or a note says it holds. */
const readItems = (v: unknown, what: string): ItemId[] => each(v, isItemId, 8, what);
function readPiece(v: unknown, nextId: number, meals: boolean): Piece | null {
  if (v === null) return null;
  const p = record(v, "a figure");
  return {
    id: whole(p.id, 1, nextId - 1, "a figure's number"),
    kind: one(p.kind, isFigureId, "a figure's kind"),
    stars: one(p.stars, isStars, "a figure's stars"),
    items: readItems(p.items, "what a figure holds"),
    fed: fedOf(p.fed, meals),
  };
}
/**
 * How a run set out: as it keeps it (`way`); or for a run kept before it kept one, as its trail, its
 * roster (`own`, kept only with the member's own figures) and its endless way (kept only on an
 * endless run) said it. That is a run of an older table or sitting, and one an older Leaf said in a
 * note its answer was kept with: a command retried across a deploy is answered as it was then.
 */
const readWayOf = (r: Record<string, unknown>): Way =>
  (r.way === undefined ? oldRunWay(r.trail, r.own, r.endless) : readWay(r.way)) ?? bad("the way");
const isChoiceKind = (v: unknown): v is Choice["kind"] =>
  v === "starter" || v === "component" || v === "boon" || v === "rule";
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
  if (c.kind === "rule") {
    const options = unique(each(c.options, isRuleId, RULE_IDS.length, "the rules on offer"), "the rules on offer");
    return options.length === 0 ? bad("the rules on offer") : { kind: "rule", options };
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
    ...(r.met === undefined ? {} : { met: one(r.met, isMemberRef, "the record") }),
  };
}
/** A member's Leaf id as a record keeps it: a short string. */
const isMemberRef = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

const isSeat = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < SEATS;
/** Seats, each once. */
const readSeats = (v: unknown, what: string): number[] => unique(each(v, isSeat, SEATS, what), what);
/** What binds a fight as its setup keeps it (`FightSetup.rules`): the seats it closes, and the numbers it sets apart from plain. */
function readRules(v: unknown, what: string): Partial<FightRules> {
  const r = record(v, what);
  const set: { -readonly [K in keyof FightRules]?: FightRules[K] } = {};
  if (r.closed !== undefined) set.closed = readSeats(r.closed, what);
  if (r.closedToSit !== undefined) set.closedToSit = readSeats(r.closedToSit, what);
  if (r.reach !== undefined) set.reach = whole(r.reach, 0, ROOMY, what);
  if (r.dusk !== undefined) set.dusk = whole(r.dusk, 0, ROOMY, what);
  if (r.alone !== undefined) set.alone = whole(r.alone, 0, ROOMY, what);
  return set;
}
/**
 * What binds a fight and the rules named, as its setup keeps them. One kept before a setup kept its
 * rules by what they set (a table before version 7) names its one rule by id and its stumps: it is
 * read as that rule's row sets it from them. One set up before there were rules has neither.
 */
function readRuled(r: Record<string, unknown>, what: string): Pick<FightSetup, "rules" | "named"> {
  if (r.rule !== undefined) {
    const rule = record(r.rule, what);
    const id = one(rule.id, isRuleId, what);
    return setupRules({ rules: ruled(ROOM_RULES[id].sets(readSeats(rule.stumps, what))), named: [id] });
  }
  return {
    ...(r.rules !== undefined && { rules: readRules(r.rules, what) }),
    ...(r.named !== undefined && { named: unique(each(r.named, isRuleId, RULE_IDS.length, what), what) }),
  };
}
/** An era as a run or a setup keeps it; one kept before there were eras is of the era live then. */
const readEra = (v: unknown, what: string): Era => (v === undefined ? LEGACY_ERA : one(v, isEra, what));
/** A fight's setup: a seed, its era and two parties, and what binds its room (`readRuled`). */
function readSetup(v: unknown, what: string): FightSetup {
  const r = record(v, what);
  const sides = list(r.sides, 2, what);
  const ours = one(sides[0], isParty, what);
  const theirs = one(sides[1], isParty, what);
  return {
    seed: whole(r.seed, 0, UINT, what),
    era: readEra(r.era, what),
    sides: [ours, theirs],
    ...readRuled(r, what),
  };
}
/**
 * The rule a run of the Wilds picked for a wing. A run kept before there were rules has none. So
 * does one whose rule these rules no longer have, and Leaf's run picks again (`pickAgain`); a run
 * shown to the page never has one.
 */
function readWing(v: unknown, shown: boolean): Wing | null {
  if (v === undefined || v === null) return null;
  const w = record(v, "the wing's rule");
  if (!isRuleId(w.rule)) return shown ? bad("the wing's rule") : null;
  return {
    rule: w.rule,
    at: whole(w.at, 0, ROOMY, "the wing's rule"),
    stumps: readSeats(w.stumps, "the stumps"),
  };
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
  return foe.figures.length === 0 ? bad("who is waiting in the room") : { ...foe, title: renamedTitle(foe.title) };
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
function readParts(
  r: Record<string, unknown>,
  old: boolean,
  shown: boolean,
  meals: boolean,
): { run: RunView; afresh: boolean } {
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
  const board = list(r.board, SEATS, "the board").map((x) => readPiece(x, nextId, meals));
  const bench = list(r.bench, ROOMY, "the bench").map((x) => readPiece(x, nextId, meals));
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
    era: readEra(r.era, "the era"),
    way: readWayOf(r),
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
    wing: readWing(r.wing, shown),
    seen: {
      fielded: unique(each(seen.fielded, isFigureId, everyFigure().length, "the almanac notes"), "the almanac notes"),
      threeStars: unique(
        each(seen.threeStars, isFigureId, everyFigure().length, "the almanac notes"),
        "the almanac notes",
      ),
      forged: unique(each(seen.forged, isFinishedId, FINISHED_IDS.length, "the almanac notes"), "the almanac notes"),
      topped: unique(
        each(renamedTraits(seen.topped), isTraitId, TRAIT_IDS.length, "the almanac notes"),
        "the almanac notes",
      ),
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

/**
 * A party kept when Greg ate a meal after every fight: each Greg's meals read as the share of his
 * health they gave him (`MEAL` each). Any other party, as it is.
 */
export const partyAsShare = (p: Party): Party => ({
  ...p,
  figures: p.figures.map((x) => (x.kind === "greg" ? { ...x, fed: x.fed * MEAL } : x)),
});
const setupAsShare = (s: FightSetup): FightSetup => ({
  ...s,
  sides: [partyAsShare(s.sides[0]), partyAsShare(s.sides[1])],
});
/**
 * A run's Gregs that sit in its parties rather than on its board (who waits in the room, the last
 * fight's and the fight being fought's), read as shares when the run was kept as meals (`meals`), as
 * its own pieces are (`readPiece`). A fight being fought then plays again as Leaf decided it.
 */
function partiesAsShare(run: RunView, meals: boolean): void {
  if (!meals) return;
  run.foe = partyAsShare(run.foe);
  if (run.last) run.last = setupAsShare(run.last);
  if (run.stage.phase === "fight") {
    const fight = run.stage.fight;
    run.stage = { phase: "fight", fight: { ...fight, setup: setupAsShare(fight.setup) } };
  }
}

/** A run as Leaf keeps it, of table version 1 (`old`) or since, kept as meals or not: with its streams, under today's numbers. */
function readRun(v: unknown, old: boolean, meals: boolean): Run {
  const r = record(v, "the run");
  const { run: parts, afresh } = readParts(r, old, false, meals);
  partiesAsShare(parts, meals);
  const run: Run = {
    seed: whole(r.seed, 0, UINT, "the seed"),
    rng: whole(r.rng, 0, UINT, "the random stream"),
    ...parts,
  };
  if (afresh && run.stage.phase !== "over") layOutAfresh(run, mix(run.rng, 0xa7e5));
  settle(run);
  pickAgain(run, r.wing);
  return run;
}

// ---------- today's numbers ----------

/**
 * Brings a run of the right shape under today's numbers, and refuses nothing. Its trail, the room,
 * the level and resolve go no higher than they go now; experience past a level's step makes the
 * levels it makes; the stall is today's size, cut or filled out with empty places; the bench is
 * today's size, its figures past the end moved up into empty places or, with none, sold for what
 * they are worth; a figure holds what a figure may hold now (as many, no two that make something,
 * nothing granting a trait it carries), and the rest goes to the item bench; Greg has gained no
 * more than he may, and nobody else anything; a pick of boons has no more redraws than one has now.
 */
function settle(run: Run): void {
  run.way = onTrailThere(run.way);
  run.room = Math.min(run.room, lastRoom(run));
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
      run.acorns += sellValue(catalogOf(run), piece);
      run.items.push(...piece.items);
    }
  }
  run.bench = bench;
  for (const piece of pieces(run)) {
    const held: ItemId[] = [];
    for (const item of piece.items) {
      // It keeps what it could have been handed as it is: with a place, making nothing, granting nothing it carries.
      const got = holdItem(catalogOf(run), { kind: piece.kind, items: held }, item);
      (!("refused" in got) && got.made === null ? held : run.items).push(item);
    }
    piece.items = held;
    piece.fed = piece.kind === "greg" ? Math.min(piece.fed, traitNumber(catalogOf(run), "greg", "most", 1)) : 0;
  }
  for (const choice of picksOf(run)) {
    if (choice.kind === "boon") choice.redraws = Math.min(choice.redraws, ECONOMY.boonRedraws);
  }
}

export type Loaded = { ok: true; run: Run } | { ok: false; why: string };

/**
 * A run as Leaf keeps it in a table of version 1 (`old`) or since, and with Greg's meals (`meals`:
 * kept before he was fed by hand) or not; or the reason the data is not one.
 */
export function checkRun(v: unknown, old = false, meals = false): Loaded {
  try {
    return { ok: true, run: readRun(v, old, meals) };
  } catch (err) {
    if (err instanceof Nonsense) return { ok: false, why: `That raid does not add up: ${err.message} is wrong.` };
    throw err;
  }
}

/** A run as the page is shown it (no streams, only the first pick's options), or null for one these rules could not have made. */
export function readRunView(v: unknown): RunView | null {
  try {
    return readParts(record(v, "the run"), false, true, false).run;
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
