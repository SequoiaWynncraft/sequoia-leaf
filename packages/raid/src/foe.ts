/**
 * Who is waiting in a room: the forest's trouble as the room plans it, or for sparring a regular's
 * party (`spar.ts`) or the board another member fought that room with, as Leaf hands it over
 * (`Ctx.met`). Each is a plain `Party`, from the room's seed, drawn from the run's stream.
 */
import { below, type Met, mix, pick } from "@sequoia-leaf/core";

import { boonNumber, FIGHT_BOONS } from "./content/boons.ts";
import { type Catalog, catalogOf } from "./content/catalog.ts";
import { ENDLESS } from "./content/endless.ts";
import { type BossId, isBossId, isFigureId } from "./content/figures.ts";
import { isMemberId } from "./content/members.ts";
import { LEVELS, MAX_LEVEL, ROOMS, type RoomSpec, type SparStrength, TRAILS } from "./content/rooms.ts";
import { shut } from "./content/rules.ts";
import { isHeld, sparAt } from "./endless.ts";
import type { FightResult, FightSummary } from "./fight/types.ts";
import { COLS } from "./hex.ts";
import { chairsUsed, isParty, type Party, type Placed } from "./party.ts";
import { roomOf, type RoomRun } from "./room.ts";
import type { Run } from "./run.ts";
import { sparParty } from "./spar.ts";
import { counts, courseOf, trailOf } from "./way.ts";
import { seatOpen } from "./wing.ts";

/** The most figures any member can field, as the run's `fieldCap` has it: the top level, and more with An Extra Chair. */
const mostFielded = (cat: Catalog): number => MAX_LEVEL + boonNumber(cat, "extrachair", "more");

/**
 * One figure of a board met, as it stands across the table. Its level stands only in a run with
 * the member's own figures (`levels`), and no higher than levels go.
 */
function asMet(p: Placed, levels: boolean): Placed {
  const level = levels ? Math.min(LEVELS.most, p.level ?? 0) : 0;
  return {
    kind: p.kind,
    stars: p.stars,
    seat: p.seat,
    items: p.items.slice(),
    fed: p.fed,
    ...(level > 0 && { level }),
  };
}

/**
 * Another member's board as Leaf hands it over (`Ctx.met`), as the party across the table: only one
 * a member could have fielded (of the stall's own figures, taking one chair to `mostFielded`, and
 * `chairs` more for a board of an endless run), every figure of it open in the era of the run that
 * meets it (`cat`), signed with the member's name and id. A banner's member stands only on a board
 * met by a run with the member's own figures (`levels`). Null for anything else: the regular stays.
 */
export function boardMet(cat: Catalog, met: Met, levels = false, chairs = 0): Party | null {
  const { data } = met;
  if (!isParty(data) || data.figures.length === 0) return null;
  const fits = (kind: string): boolean =>
    isFigureId(kind) && cat.figures[kind] !== undefined && (levels || !isMemberId(kind));
  if (!data.figures.every((p) => fits(p.kind))) return null;
  if (chairsUsed(cat, data.figures) > mostFielded(cat) + chairs) return null;
  const board: Party = {
    who: met.name,
    by: met.player,
    title: "their board at this room",
    figures: data.figures.map((p) => asMet(p, levels)),
    boons: data.boons.filter((b) => FIGHT_BOONS.includes(b)),
    might: 100,
  };
  // Signed so, it has to be a party still: a name or an id longer than a party allows is not one.
  return isParty(board) ? board : null;
}

/** A regular's party for a sparring room, from the room's seed: as strong as the room says, or as `strength` says; off the `closed` seats. */
export const regularAt = (
  cat: Catalog,
  seed: number,
  roomIndex: number,
  trailIndex: number,
  strength?: SparStrength,
  closed?: ReadonlySet<number>,
): Party => sparParty(cat, mix(seed, 700 + roomIndex), roomIndex, trailIndex, strength, closed);

/** Who is waiting in a sparring room: a regular, or the board Leaf handed over (`met`), the regular being one of the crowd. */
function sparring(
  cat: Catalog,
  seed: number,
  roomIndex: number,
  trailIndex: number,
  met: Met | undefined,
  levels: boolean,
): Party {
  const regular = regularAt(cat, seed, roomIndex, trailIndex);
  const board = met === undefined ? null : boardMet(cat, met, levels);
  if (board === null || met === undefined) return regular;
  return below({ rng: mix(seed, 900 + roomIndex) }, met.of + 1) < met.of ? board : regular;
}

/**
 * Who is waiting in a room: the forest's trouble as planned, or for sparring a regular's party, or
 * the board another member fought the room with (`met`, `boardMet`). The regular is one of the crowd
 * of members who left a board there: one draw from the room's stream makes it the member's board
 * `met.of` times in `met.of + 1`. The regular's party is the same for a seed whatever is met.
 */
export function opposition(
  cat: Catalog,
  seed: number,
  roomIndex: number,
  trailIndex: number,
  met?: Met,
  levels = false,
): Party {
  const room = ROOMS[roomIndex];
  if (!room || room.kind === "spar") return sparring(cat, seed, roomIndex, trailIndex, met, levels);
  return forest(seed, roomIndex, room, trailIndex);
}

/**
 * Who is waiting in the room a run is in, from the room's seed. On a course whose sparring rooms
 * meet boards left there (`Across` "met": a trail), as `opposition` has it. On any other, the forest
 * as strong as the room says (`Room.might`); in a sparring room a regular as strong as `sparAt`
 * says, but in a room held (`isHeld`) the board of the member who holds it, when Leaf hands one over
 * (`met`) and it is one a member could have fielded (`boardMet`). A board met keeps its levels only
 * on a way that meets levels (`counts`). Nobody sits on a seat the room closes (`Room.rules`): the
 * regular is seated round them, and the forest's plan moves anyone on one to the nearest open seat
 * (`seatOpen`).
 */
export function foeOf(run: Pick<Run, "era"> & RoomRun, seed: number, met?: Met): Party {
  const course = courseOf(run.way);
  const trail = trailOf(run.way);
  const { levelsMet } = counts(run.way);
  if (course.across === "met") return opposition(catalogOf(run), seed, run.room, trail, met, levelsMet);
  const room = roomOf(run);
  const closed = shut(room.rules);
  const spec = course.rooms(run.room);
  if (spec && room.kind !== "spar") {
    const party = forest(seed, run.room, spec, trail, room.might);
    return { ...party, figures: seatOpen(party.figures, closed) };
  }
  const regular = regularAt(catalogOf(run), seed, run.room, trail, sparAt(run.room), closed);
  const held = isHeld(run, run.room) && met ? boardMet(catalogOf(run), met, levelsMet, ENDLESS.chairs) : null;
  return held ?? regular;
}

/** The most a party's might can be (`isParty`). */
const MIGHT_MOST = 1000;

/**
 * The forest's trouble or boss in a room, at the trail's strength, and `grown` percent of that
 * (an endless run's rooms after the fifteenth).
 */
export function forest(seed: number, roomIndex: number, room: RoomSpec, trailIndex: number, grown = 100): Party {
  const trail = TRAILS[trailIndex] ?? TRAILS[0];
  const plan = pick({ rng: mix(seed, 300 + roomIndex) }, room.plans);
  const figures: Placed[] = [];
  for (const [kind, stars, col, row, from] of plan.party) {
    if ((from ?? 0) > trailIndex) continue;
    figures.push({ kind, stars, seat: row * COLS + col, items: [], fed: 0 });
  }
  return {
    who: "The forest",
    title: plan.name,
    figures,
    boons: [],
    might: Math.min(
      MIGHT_MOST,
      Math.round((((room.kind === "boss" ? trail?.boss : trail?.trouble) ?? 100) * grown) / 100),
    ),
  };
}

/**
 * What a room's record keeps of its fight (`RoomRecord`): how it came out, the boss among those
 * across, and whose board it was when it was a member's.
 */
export function across(
  foe: Party,
  fight: Pick<FightSummary, "result" | "standing">,
): { result: FightResult; standing: [number, number]; boss: BossId | null; met?: string } {
  const { result, standing } = fight;
  const boss = foe.figures.map((p) => p.kind).find(isBossId) ?? null;
  return foe.by === undefined ? { result, standing, boss } : { result, standing, boss, met: foe.by };
}

/** How many of the members met lately are not met again: one member's board at most once in three met in a row. */
export const MET_APART = 2;
/**
 * The members whose boards a run met in its last `MET_APART` rooms against one, most lately last:
 * those its record keeps, and the one across now (`now`), whose room is not in the record until it
 * is taken (Leaf asks `Game.meets` before the take).
 */
export const metLately = (record: readonly { readonly met?: string }[], now: Party): string[] =>
  [...record, now.by === undefined ? {} : { met: now.by }]
    .flatMap((r) => (r.met === undefined ? [] : [r.met]))
    .slice(-MET_APART);
