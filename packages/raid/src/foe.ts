/**
 * Who is waiting in a room: the forest's trouble as the room plans it, or for sparring a regular's
 * party (`spar.ts`) or the board another member fought that room with, as Leaf hands it over
 * (`Ctx.met`). Each is a plain `Party`, from the room's seed, drawn from the run's stream.
 */
import { below, type Met, mix, pick } from "@sequoia-leaf/core";

import { boonNumber, FIGHT_BOONS } from "./content/boons.ts";
import { isFigureId } from "./content/figures.ts";
import { MAX_LEVEL, ROOMS, TRAILS } from "./content/rooms.ts";
import { COLS } from "./hex.ts";
import { isParty, type Party, type Placed } from "./party.ts";
import { sparParty } from "./spar.ts";

/**
 * Where a member's board for a room is left for other members to meet (`Done.keep`, `Ctx.met`): its
 * trail, and the room's place in `ROOMS`.
 */
export const boardSlot = (trail: number, room: number): string => `board:${trail}:${room}`;

/** The most figures any member can field, as the run's `fieldCap` has it: the top level, and one more with An Extra Chair. */
const MOST_FIELDED = MAX_LEVEL + boonNumber("extrachair", "more");

/**
 * Another member's board as Leaf hands it over (`Ctx.met`), as the party across the table: only one
 * a member could have fielded (a party of one to `MOST_FIELDED` of the stall's own figures), signed
 * with the member's name and id. Null for anything else.
 */
export function boardMet(met: Met): Party | null {
  const { data } = met;
  if (!isParty(data) || data.figures.length === 0 || data.figures.length > MOST_FIELDED) return null;
  if (!data.figures.every((p) => isFigureId(p.kind))) return null;
  const board: Party = {
    who: met.name,
    by: met.player,
    title: "their board at this room",
    figures: data.figures.map((p) => ({
      kind: p.kind,
      stars: p.stars,
      seat: p.seat,
      items: p.items.slice(),
      fed: p.fed,
    })),
    boons: data.boons.filter((b) => FIGHT_BOONS.includes(b)),
    might: 100,
  };
  // Signed so, it has to be a party still: a name or an id longer than a party allows is not one.
  return isParty(board) ? board : null;
}

/**
 * Who is waiting in a room: the forest's trouble as planned, or for sparring a regular's party, or
 * the board another member fought the room with (`met`, `boardMet`). The regular is one of the crowd
 * of members who left a board there: one draw from the room's stream makes it the member's board
 * `met.of` times in `met.of + 1`. The regular's party is the same for a seed whatever is met.
 */
export function opposition(seed: number, roomIndex: number, trailIndex: number, met?: Met): Party {
  const room = ROOMS[roomIndex];
  const trail = TRAILS[trailIndex] ?? TRAILS[0];
  if (!room || room.kind === "spar") {
    const regular = sparParty(mix(seed, 700 + roomIndex), roomIndex, trailIndex);
    const board = met === undefined ? null : boardMet(met);
    if (board === null || met === undefined) return regular;
    return below({ rng: mix(seed, 900 + roomIndex) }, met.of + 1) < met.of ? board : regular;
  }
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
    might: (room.kind === "boss" ? trail?.boss : trail?.trouble) ?? 100,
  };
}
