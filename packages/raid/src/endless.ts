/**
 * The endless runs: a run that does not stop at the fifteenth room. After it the rooms come round
 * again (`CYCLE`), the forest in them growing room by room, every boss beaten adds a chair, and a
 * regular is as strong as a member could be that deep. Its two courses differ only in who waits in
 * a sparring room: in the Wilds a regular; in the Deep Woods the member who holds the room (its
 * way's `lanes().held`, handed over by Leaf as `met`; `foe.ts` seats them), or a regular while
 * nobody does. Everything here reads the run's way through its course's row (`content/ways.ts`); a
 * run on a trail is the fifteen rooms it always was. What binds the room a run is in is `room.ts`'s
 * (`roomOf`), which reads these.
 */
import { boonNumber } from "./content/boons.ts";
import { catalogOf } from "./content/catalog.ts";
import { ENDLESS } from "./content/endless.ts";
import { MAX_LEVEL, ROOM_COUNT, type SparStrength } from "./content/rooms.ts";
import { roomAt } from "./content/ways.ts";
import type { RoomRecord, Run } from "./run.ts";
import { courseOf, type Way } from "./way.ts";

export type { EndlessWay } from "./content/endless.ts";
export { grownAt, roomAt } from "./content/ways.ts";

/** What of a run says how it set out. */
interface OnWay {
  readonly way: Way;
}

/** The last room of a run, counting from 0: the fifteenth, or none for an endless run. */
export const lastRoom = (run: OnWay): number => courseOf(run.way).last;

/** How many boss rooms come after the fifteenth and before a room: the chairs a party that beat them all has there. */
function bossesBefore(room: number): number {
  let n = 0;
  for (let at = ROOM_COUNT; at < room && n < ENDLESS.chairs; at++) if (roomAt(at)?.kind === "boss") n++;
  return n;
}

/** The chairs a run has earned, as its course gives them: on an endless run a boss beaten after the fifteenth room, each, `ENDLESS.chairs` at most. */
export const chairsOf = (run: OnWay & { readonly record: readonly RoomRecord[] }): number =>
  courseOf(run.way).chairs(run.record);

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

/** Whether a room of a run is held by a member: a sparring room of a course whose rooms are held, from the room its row says on (the Deep Woods, from `ENDLESS.heldFrom`). */
export function isHeld(run: OnWay, room: number): boolean {
  const { across, rooms } = courseOf(run.way);
  return typeof across === "object" && room >= across.held.from && rooms(room)?.kind === "spar";
}

/** How many figures a run's chairs add to what may be fielded, beside An Extra Chair's. */
export const extraChairs = (run: Pick<Run, "boons" | "record" | "era"> & OnWay): number =>
  (run.boons.includes("extrachair") ? boonNumber(catalogOf(run), "extrachair", "more") : 0) + chairsOf(run);
