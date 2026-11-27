/**
 * A room fought, as Leaf keeps it for the staff's analysis (`raid_fight`, Leaf's `raid_fights`): which
 * run and room, who was across, how it came out, and both parties as they fought. One is written for
 * every fight decided, on either way of setting out; nothing a player sees reads it.
 */
import { type BoonId, isBoonId } from "./content/boons.ts";
import { ENDLESS_WAYS, type EndlessWay } from "./content/endless.ts";
import { nowCalled, regularOf, type RoomKind } from "./content/rooms.ts";
import { isTraitId, renamedTrait, type TraitId } from "./content/traits.ts";
import { roomAt } from "./endless.ts";
import type { FightResult, FightSummary } from "./fight/types.ts";
import { isPlaced, type Party, type Placed, traitSteps } from "./party.ts";
import { type Fought, resolveLost, type Run } from "./run.ts";

/** A party as it fought: its figures as they stood, the traits they switched on with their steps, and its boons. */
export type FoughtSide = {
  figures: Placed[];
  traits: Partial<Record<TraitId, number>>;
  boons: BoonId[];
};

export type FightRecord = {
  /** The run's number at its table. */
  run: number;
  /** How the run set out: the main way, the member's own figures, or one of the endless ways. */
  way: "main" | "own" | EndlessWay;
  trail: number;
  /** The room, counting from 0 as `ROOMS` does (an endless run's go on past the fifteenth: `roomAt`). */
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

function acrossOf(room: number, foe: Party): string {
  if (foe.by !== undefined) return `member:${foe.by}`;
  const regular = regularOf(foe);
  if (regular) return `regular:${regular.kind}`;
  return `plan:${roomAt(room)?.plans.findIndex((plan) => plan.name === nowCalled(foe.title)) ?? -1}`;
}

const sideOf = (party: Party, boons: readonly BoonId[]): FoughtSide => ({
  figures: party.figures,
  traits: traitSteps(party),
  boons: [...boons],
});

/** The record of the fight a run (its `runs`th at the table) is fighting, as Leaf decided it. */
export function fightRecord(runs: number, run: Run, { setup, outcome }: Fought): FightRecord {
  const [ours, theirs] = setup.sides;
  const kind = roomAt(run.room)?.kind ?? "spar";
  return {
    run: runs,
    way: run.endless ?? (run.own ? "own" : "main"),
    trail: run.trail,
    room: run.room,
    kind,
    across: acrossOf(run.room, theirs),
    result: outcome.result,
    margin: Math.round(margin(outcome) * 1000) / 1000,
    seconds: Math.round(outcome.seconds * 10) / 10,
    resolve: Math.max(0, run.resolve - resolveLost(run, outcome)),
    level: run.level,
    acorns: run.acorns,
    party: sideOf(ours, run.boons),
    against: kind === "spar" ? sideOf(theirs, theirs.boons) : null,
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

/** Where a record's fight was and who was across, read back. */
function whereOf(
  v: Record<string, unknown>,
): Pick<FightRecord, "run" | "way" | "trail" | "room" | "kind" | "across"> | null {
  const { run, way, trail, room, kind, across } = v;
  if (!whole(run) || !oneOf(way, ["main", "own", ...ENDLESS_WAYS]) || !whole(trail) || !whole(room)) return null;
  if (!oneOf(kind, ["trouble", "spar", "boss"]) || typeof across !== "string" || across.length > 80) return null;
  return { run, way, trail, room, kind, across };
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

/** A fight's record read back, as Leaf stores it or a report reads it, checked as the rules have it; null for anything else. */
export function readFight(v: unknown): FightRecord | null {
  if (!isRecord(v)) return null;
  const where = whereOf(v);
  const how = howOf(v);
  const party = readSide(v.party);
  const against = v.against === null ? null : readSide(v.against);
  if (where === null || how === null || party === null || (against === null && v.against !== null)) return null;
  return { ...where, ...how, party, against };
}
