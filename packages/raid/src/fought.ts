/**
 * A room fought, as Leaf keeps it for the staff's analysis (`raid_fight`, Leaf's `raid_fights`): which
 * run and room, how the run set out, who was across, how it came out, both parties as they fought,
 * and the fight's setup, from which it plays again exactly as it was decided (`replayOf`). One is
 * written for every fight decided, on every way of setting out.
 */
import { type BoonId, isBoonId } from "./content/boons.ts";
import { type Catalog, catalogOf } from "./content/catalog.ts";
import { type Era, eraAt, isEra, LEGACY_ERA } from "./content/releases.ts";
import { nowCalled, regularOf, type RoomKind, type RoomSpec } from "./content/rooms.ts";
import { isTraitId, renamedTrait, type TraitId } from "./content/traits.ts";
import type { FightResult, FightSetup, FightSummary } from "./fight/types.ts";
import { isPlaced, type Party, type Placed, traitSteps } from "./party.ts";
import { type Fought, resolveLost, type Run } from "./run.ts";
import { fields, Nonsense } from "./save.ts";
import { type CourseId, courseOf, type OldWay, oldWayOf, type Pool, wayLogged, wayOfLogged } from "./way.ts";

/** A party as it fought: its figures as they stood, the traits they switched on with their steps, and its boons. */
export type FoughtSide = {
  figures: Placed[];
  traits: Partial<Record<TraitId, number>>;
  boons: BoonId[];
};

export type FightRecord = {
  /** The run's number at its table. */
  run: number;
  /** How the run set out, as the first records said it: the main way, the member's own figures, or an endless way by name. */
  way: OldWay;
  /** How the run set out (`wayLogged`): its course, its trail (the first off a trail), and whose figures. */
  course: CourseId;
  trail: number;
  pool: Pool;
  /** The era the fight was set up in: what it is played by. */
  era: Era;
  /** The room, counting from 0 as its course counts them (an endless run's go on past the fifteenth). */
  room: number;
  kind: RoomKind;
  /** Who was across: `plan:<n>`, the room's nth plan in `ROOMS`; `regular:<figure>`; or `member:<Leaf id>`. */
  across: string;
  result: FightResult;
  /** Health left on the party's side less the other's, as `margin` measures it. */
  margin: number;
  seconds: number;
  /** Resolve once the room's takings are taken; the level and the acorns as the party set out. */
  resolve: number;
  level: number;
  acorns: number;
  /** The party's boons are every boon of the run, not only those that change the fight. */
  party: FoughtSide;
  /** A regular's or a member's party; null for the forest's. */
  against: FoughtSide | null;
  /**
   * What the fight was decided from, as a run keeps its last fight's: its seed, its era, both parties
   * whole, and what bound its room (`FightRules`, and the rules named). Null for a fight kept before
   * records kept it: that one cannot be played again.
   */
  setup: FightSetup | null;
};

/** Health left on one side as a share of what its own figures came with; the summoned are left out. */
function left(f: Pick<FightSummary, "units">, side: 0 | 1): number {
  let hp = 0;
  let max = 0;
  for (const u of f.units) {
    if (u.side !== side || u.summoned) continue;
    hp += u.hp;
    max += u.maxHp;
  }
  return max > 0 ? hp / max : 0;
}
/** How much better the party's side ended than the other: from -1 (they stand whole) to 1 (we do). */
export const margin = (f: Pick<FightSummary, "units">): number => left(f, 0) - left(f, 1);

function acrossOf(room: RoomSpec | undefined, foe: Party): string {
  if (foe.by !== undefined) return `member:${foe.by}`;
  const regular = regularOf(foe);
  if (regular) return `regular:${regular.kind}`;
  return `plan:${room?.plans.findIndex((plan) => plan.name === nowCalled(foe.title)) ?? -1}`;
}

const sideOf = (cat: Catalog, party: Party, boons: readonly BoonId[]): FoughtSide => ({
  figures: party.figures,
  traits: traitSteps(cat, party),
  boons: [...boons],
});

/** The record of the fight a run (its `runs`th at the table) is fighting, as Leaf decided it. */
export function fightRecord(runs: number, run: Run, { setup, outcome }: Fought): FightRecord {
  const [ours, theirs] = setup.sides;
  const room = courseOf(run.way).rooms(run.room);
  const kind = room?.kind ?? "spar";
  return {
    run: runs,
    way: oldWayOf(run.way),
    ...wayLogged(run.way),
    era: setup.era,
    room: run.room,
    kind,
    across: acrossOf(room, theirs),
    result: outcome.result,
    margin: Math.round(margin(outcome) * 1000) / 1000,
    seconds: Math.round(outcome.seconds * 10) / 10,
    resolve: Math.max(0, run.resolve - resolveLost(run, outcome)),
    level: run.level,
    acorns: run.acorns,
    party: sideOf(catalogOf(setup), ours, run.boons),
    against: kind === "spar" ? sideOf(catalogOf(setup), theirs, theirs.boons) : null,
    setup,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const oneOf = <T extends string>(v: unknown, all: readonly T[]): v is T => all.some((one) => one === v);

/** A side read back: figures as a party holds them, traits on at a step, boons the content has. */
function readSide(v: unknown): FoughtSide | null {
  if (!isRecord(v) || !Array.isArray(v.figures) || !v.figures.every(isPlaced) || !isRecord(v.traits)) return null;
  if (!Array.isArray(v.boons) || !v.boons.every(isBoonId)) return null;
  const traits: Partial<Record<TraitId, number>> = {};
  for (const [kept, step] of Object.entries(v.traits)) {
    const id = renamedTrait(kept);
    if (!isTraitId(id) || !whole(step) || step === 0) return null;
    traits[id] = step;
  }
  return { figures: v.figures, traits, boons: v.boons };
}

/**
 * Where a record's fight was, how its run set out and who was across, read back. A record with no
 * course, pool or era (one kept before records said them, or one an older Leaf wrote while a deploy
 * was under way: the row's columns empty) says its way by `way` alone (`wayOfLogged`), and was set up
 * in the era live at `at`, the moment its row was written, when the reader has it; else in the era
 * live before records said theirs (`LEGACY_ERA`).
 */
function whereOf(
  v: Record<string, unknown>,
  at: number | undefined,
): Pick<FightRecord, "run" | "way" | "course" | "trail" | "pool" | "era" | "room" | "kind" | "across"> | null {
  const { run, way, room, kind, across } = v;
  const said = wayOfLogged(v);
  const era = v.era == null ? (at === undefined ? LEGACY_ERA : eraAt(at)) : isEra(v.era) ? v.era : null;
  if (!whole(run) || !oneOf(way, ["main", "own", "wilds", "deep"]) || said?.trail == null || !whole(room)) return null;
  if (!oneOf(kind, ["trouble", "spar", "boss"]) || typeof across !== "string" || across.length > 80) return null;
  return era === null
    ? null
    : { run, way, course: said.course, trail: said.trail, pool: said.pool, era, room, kind, across };
}

/** How a record's fight came out, read back. */
function howOf(
  v: Record<string, unknown>,
): Pick<FightRecord, "result" | "margin" | "seconds" | "resolve" | "level" | "acorns"> | null {
  const { result, margin: by, seconds, resolve, level, acorns } = v;
  if (!oneOf(result, ["win", "loss", "draw"]) || typeof by !== "number" || !(Math.abs(by) <= 1)) return null;
  if (typeof seconds !== "number" || !(seconds >= 0) || !whole(resolve) || !whole(level) || !whole(acorns)) return null;
  return { result, margin: by, seconds, resolve, level, acorns };
}

/** A record's setup read back as a run's last fight is (`fields.setup`); none for one kept before records kept it; undefined for one that does not read. */
function setupOf(v: unknown): FightSetup | null | undefined {
  if (v === undefined || v === null) return null;
  try {
    return fields.setup(v, "the fight's setup");
  } catch (err) {
    if (err instanceof Nonsense) return undefined;
    throw err;
  }
}

/**
 * A fight's record read back, as Leaf stores it or a report reads it, checked as the rules have it;
 * null for anything else. `at` is when its row was written, where the reader has it.
 */
export function readFight(v: unknown, at?: number): FightRecord | null {
  if (!isRecord(v)) return null;
  const where = whereOf(v, at);
  const how = howOf(v);
  const party = readSide(v.party);
  const against = v.against === null ? null : readSide(v.against);
  const setup = setupOf(v.setup);
  if (where === null || how === null || party === null || (against === null && v.against !== null)) return null;
  return setup === undefined ? null : { ...where, ...how, party, against, setup };
}

/**
 * A fight's record (`readFight`: a row of `raid_fights` with its JSON columns decoded, as Leaf's
 * `fightLines` gives one, never the row's text as SQLite returns it), as the page plays it again: its
 * setup, which plays to the end Leaf decided while the rules are the ones it was decided by. Null for
 * a row kept before rows kept their setup (its record says `setup: null`), and for one that does not
 * read.
 */
export const replayOf = (row: unknown, at?: number): FightSetup | null => readFight(row, at)?.setup ?? null;
