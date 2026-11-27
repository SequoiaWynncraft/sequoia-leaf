/**
 * The endless runs: a run that does not stop at the fifteenth room. After it the rooms come round
 * again (`CYCLE`), the forest in them growing room by room, every boss beaten adds a chair, and a
 * regular is as strong as a member could be that deep. Its two ways (`EndlessWay`) differ only in
 * who waits in a sparring room: in the Wilds a regular; in the Deep Woods the member who holds the
 * room (`heldSlot`, handed over by Leaf as `met`), or a regular while nobody does. Everything here
 * reads the run's `endless`; a run without it is the fifteen rooms it always was.
 */
import type { Met } from "@sequoia-leaf/core";

import { boonNumber } from "./content/boons.ts";
import { CYCLE, ENDLESS, type EndlessWay } from "./content/endless.ts";
import { MAX_LEVEL, type Room, ROOM_COUNT, ROOMS, type SparStrength } from "./content/rooms.ts";
import { boardMet, forest, opposition, regularAt } from "./foe.ts";
import type { Party } from "./party.ts";
import type { RoomRecord, Run } from "./run.ts";

export type { EndlessWay } from "./content/endless.ts";

/** Which way a run set out: the main way, its own figures, or one of the endless ways. */
export interface Way {
  readonly own: unknown;
  readonly endless: EndlessWay | null;
}

/** The last room of a run, counting from 0: the fifteenth, or none for an endless run. */
export const lastRoom = (run: Pick<Way, "endless">): number => (run.endless ? Infinity : ROOM_COUNT - 1);

/** The room at a place, counting from 0: one of the fifteen, and after them the cycle, round and round. */
export const roomAt = (room: number): Room | undefined =>
  room < ROOM_COUNT ? ROOMS[room] : CYCLE[(room - ROOM_COUNT) % CYCLE.length];

/** The room a run is in; none past its last. */
export const roomOf = (run: Pick<Run, "room"> & Pick<Way, "endless">): Room | undefined =>
  run.room <= lastRoom(run) ? roomAt(run.room) : undefined;

/** How many boss rooms come after the fifteenth and before a room: the chairs a party that beat them all has there. */
function bossesBefore(room: number): number {
  let n = 0;
  for (let at = ROOM_COUNT; at < room && n < ENDLESS.chairs; at++) if (roomAt(at)?.kind === "boss") n++;
  return n;
}

/** The chairs an endless run has: a boss beaten after the fifteenth room, each, `ENDLESS.chairs` at most. */
export const chairsOf = (run: Pick<Way, "endless"> & { readonly record: readonly RoomRecord[] }): number =>
  run.endless
    ? Math.min(
        ENDLESS.chairs,
        run.record.filter((r) => r.room >= ROOM_COUNT && r.kind === "boss" && r.result === "win").length,
      )
    : 0;

/** How strong the forest is in a room, in percent: 100 to the fifteenth, then `ENDLESS.grows` more for each room past it. */
export const grownAt = (room: number): number =>
  room < ROOM_COUNT ? 100 : 100 * (1 + ENDLESS.grows / 100) ** (room - ROOM_COUNT + 1);

/**
 * A regular's strength in a room: the room's own to the fifteenth; after it the top level and a
 * chair for each boss on the way, and what it has spent and holds growing room by room.
 */
export function sparAt(room: number): SparStrength {
  const own = roomAt(room)?.spar;
  if (room < ROOM_COUNT && own) return own;
  const past = room - ROOM_COUNT;
  const { spar } = ENDLESS;
  return {
    level: MAX_LEVEL + bossesBefore(room),
    spent: spar.spent + spar.spentGrows * past,
    components: spar.components + Math.floor(past / spar.componentsEvery),
    anyStars: true,
  };
}

/** Whether a room of a run is held by a member: a sparring room of the Deep Woods, from `ENDLESS.heldFrom` on. */
export const isHeld = (run: Pick<Way, "endless">, room: number): boolean =>
  run.endless === "deep" && room >= ENDLESS.heldFrom && roomAt(room)?.kind === "spar";

/** Where the member who holds a sparring room of the Deep Woods keeps their board: the room, counting from 0. */
export const heldSlot = (room: number): string => `deep:${room}`;
/** The room a slot of the Deep Woods is (`heldSlot`), counting from 0; null for any other slot. */
export function heldRoom(slot: string): number | null {
  const m = /^deep:(\d{1,4})$/.exec(slot);
  return m ? Number(m[1]) : null;
}

/**
 * Who is waiting in the room a run is in, from the room's seed: for a run that is not endless, as
 * `opposition` has it. In an endless run, the forest grown for the room (`grownAt`); in a sparring
 * room a regular as strong as `sparAt` says, but in a room held (`isHeld`) the board of the member
 * who holds it, when Leaf hands one over (`met`) and it is one a member could have fielded (`boardMet`).
 */
export function foeOf(run: Pick<Run, "room" | "trail"> & Way, seed: number, met?: Met): Party {
  if (!run.endless) return opposition(seed, run.room, run.trail, met, run.own !== null);
  const room = roomAt(run.room);
  if (room && room.kind !== "spar") return forest(seed, run.room, room, run.trail, grownAt(run.room));
  const regular = regularAt(seed, run.room, run.trail, sparAt(run.room));
  const held = isHeld(run, run.room) && met ? boardMet(met, false, ENDLESS.chairs) : null;
  return held ?? regular;
}

/** How many figures an endless run's chairs add to what may be fielded, beside An Extra Chair's. */
export const extraChairs = (run: Pick<Run, "boons" | "record"> & Pick<Way, "endless">): number =>
  (run.boons.includes("extrachair") ? boonNumber("extrachair", "more") : 0) + chairsOf(run);
