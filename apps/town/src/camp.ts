/**
 * The member's camp as the town page keeps it today, by places in a list: setting out, moving,
 * turning, putting away, things arriving, who lives there, and how somebody else's camp is laid out
 * from nothing but a number. The ground rules (what may stand where) are the town package's
 * (`@sequoia-leaf/town/camp.ts`). `campscene.ts` shows it; `save.ts` keeps it.
 */

import { rng } from "@sequoia-leaf/kit/util.ts";
import {
  boxOf,
  type Camp as Kept,
  campFull,
  canPlace,
  freeSpot,
  newCamp as newKept,
  type PetId,
  PETS,
  readCamp,
  type Verdict,
  YARD,
} from "@sequoia-leaf/town/camp.ts";
import { footprint, isThing, thingOf, THINGS, turnsOf } from "@sequoia-leaf/town/things.ts";

export {
  allReached,
  boxOf,
  campFull,
  canPlace,
  CGH,
  CGW,
  ENTRY,
  freeSpot,
  isPet,
  MOST_OWNED,
  MOST_PARCELS,
  MOST_PLACED,
  owned,
  type PetId,
  PETS,
  standsBy,
  taken,
  TRAIL,
  type Verdict,
  walkable,
  WHY_NOT,
  YARD,
} from "@sequoia-leaf/town/camp.ts";

/** A thing standing in a camp: which thing, the top-left square of the ground it takes, and how it is turned. */
export interface Placed {
  id: string;
  x: number;
  y: number;
  /** Which way round. */
  t: number;
  /** A little of its own state: lit or not, which colour. */
  s: number;
}

/** A present the member has left at somebody else's camp. */
export interface Gave {
  to: string;
  what: string;
}

export interface Camp extends Omit<Kept, "placed"> {
  placed: Placed[];
  gave: Gave[];
}

/**
 * Sets a thing out of the tray onto the ground. Says why not if it may not go there; while the
 * camp is full it stays in the tray.
 */
export function setOut(camp: Camp, id: string, x: number, y: number, t = 0): Verdict {
  if ((camp.tray[id] ?? 0) < 1) return "off";
  if (campFull(camp.placed)) return "full";
  const v = canPlace(camp.placed, id, x, y, t);
  if (v !== "ok") return v;
  takeFromTray(camp, id);
  camp.placed.push({ id, x, y, t, s: 0 });
  return "ok";
}

/** Moves a thing already standing in the camp, turning it if asked. */
export function move(camp: Camp, index: number, x: number, y: number, t: number): Verdict {
  const p = camp.placed[index];
  if (!p) return "off";
  const v = canPlace(camp.placed, p.id, x, y, t, index);
  if (v !== "ok") return v;
  p.x = x;
  p.y = y;
  p.t = t;
  return "ok";
}

/** The next way round for a thing, where it stands; `null` if it cannot be turned there. */
export function turned(camp: Camp, index: number): Placed | null {
  const p = camp.placed[index];
  const thing = p ? thingOf(p.id) : null;
  if (!p || !thing || turnsOf(thing) < 2) return null;
  const t = (p.t + 1) % turnsOf(thing);
  // It turns about its middle, and shuffles over if that is the only way it fits.
  const [w, d] = footprint(thing, p.t);
  const [nw, nd] = footprint(thing, t);
  const x = p.x + Math.floor((w - nw) / 2);
  const y = p.y + (d - nd);
  if (canPlace(camp.placed, p.id, x, y, t, index) === "ok") return { ...p, x, y, t };
  const spot = freeSpot(camp.placed, p.id, { x: p.x + Math.floor(w / 2), y: p.y + Math.floor(d / 2) }, t, index);
  return spot && Math.hypot(spot.x - x, spot.y - y) <= 3 ? { ...p, ...spot, t } : null;
}

/** Whether a thing may be put away at all. */
export function mayPutAway(camp: Camp, index: number): boolean {
  const p = camp.placed[index];
  const thing = p ? thingOf(p.id) : null;
  return Boolean(thing && !thing.rooted);
}

/** Puts a thing away into the tray. Says whether it went. */
export function putAway(camp: Camp, index: number): boolean {
  const p = camp.placed[index];
  if (!p || !mayPutAway(camp, index)) return false;
  camp.placed.splice(index, 1);
  camp.tray[p.id] = (camp.tray[p.id] ?? 0) + 1;
  return true;
}

function takeFromTray(camp: Camp, id: string): void {
  const left = (camp.tray[id] ?? 0) - 1;
  if (left > 0) camp.tray[id] = left;
  else delete camp.tray[id];
}

// ---------- things arriving ----------

/**
 * Sets a thing down at a spot, or puts it in the tray when there is no spot or the camp is full.
 * Gives what was set down, or `null` if it went into the tray.
 */
export function setDown(
  camp: Pick<Camp, "placed" | "tray">,
  id: string,
  spot: { x: number; y: number } | null,
): Placed | null {
  if (!spot || campFull(camp.placed)) {
    camp.tray[id] = (camp.tray[id] ?? 0) + 1;
    return null;
  }
  const at: Placed = { id, x: spot.x, y: spot.y, t: 0, s: 0 };
  camp.placed.push(at);
  return at;
}

/**
 * Opens the first parcel waiting by the trail. What was in it goes from the parcels into the camp
 * in this one step, at the spot `room` finds for it (or into the tray when there is none, or the
 * camp is full), before anybody sees it arrive: a reload, or leaving, while it is in the air loses
 * nothing. Gives the thing and what was set down, or `null` when no parcel is waiting.
 */
export function unpackParcel(
  camp: Camp,
  room: (id: string) => { x: number; y: number } | null,
): { id: string; at: Placed | null } | null {
  const id = camp.parcels.shift();
  if (id === undefined) return null;
  return { id, at: setDown(camp, id, campFull(camp.placed) ? null : room(id)) };
}

/** The tray as a list, in the catalogue's order. */
export function trayList(camp: Camp): { id: string; n: number }[] {
  return THINGS.flatMap((t) => {
    const n = camp.tray[t.id] ?? 0;
    return n > 0 ? [{ id: t.id, n }] : [];
  });
}

// ---------- who lives there ----------

/** How many things must be set out before somebody else moves in: a new camp starts with nine. */
export const COSY = 24;
/**
 * How many of the town's own who drop by must be greeted before somebody follows them in to stay.
 * (Leaving presents at as many members' camps did the same, and still does for whoever did.)
 */
export const KIND = 3;

/** Whether the camp has been welcoming enough for somebody else to move in. */
export const welcoming = (camp: Camp): boolean => camp.greeted >= KIND || camp.gave.length >= KIND;

/** The pets that live in the camp, in the order they came: the first chosen, then one for each thing done. */
export function petsOf(camp: Camp): PetId[] {
  if (!camp.first) return [];
  const rest = PETS.filter((p) => p !== camp.first);
  const more = (camp.placed.length >= COSY ? 1 : 0) + (welcoming(camp) ? 1 : 0);
  return [camp.first, ...rest.slice(0, more)];
}

// ---------- a new camp, and somebody else's ----------

const put = (id: string, x: number, y: number, t = 0): Placed => ({ id, x, y, t, s: 0 });

/** A camp as the page keeps it: its things without ids of their own, and the presents left elsewhere. */
const pageCamp = (camp: Kept, gave: Gave[]): Camp => ({
  ...camp,
  placed: camp.placed.map(({ id, x, y, t, s }) => ({ id, x, y, t, s })),
  gave,
});

/** The camp a new member finds: a cabin, a fire with two logs by it, a mailbox, a signpost, a shelf, and room. */
export const newCamp = (): Camp => pageCamp(newKept(), []);

const CABIN_AT = [5, 20, 34] as const;

/**
 * Somebody else's camp (for when members' camps can be visited), laid out from a number: the same number always gives the same camp. `taste`
 * is what they like to have about (said more than once, liked more), and `count` how much of it.
 */
export function layout(seed: number, taste: readonly string[], count: number): Placed[] {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)];
  const placed: Placed[] = [];
  const tryPut = (id: string, x: number, y: number, t = 0): boolean => {
    if (canPlace(placed, id, x, y, t) !== "ok") return false;
    placed.push(put(id, x, y, t));
    return true;
  };
  const near = (id: string, x: number, y: number, t = 0): void => {
    const spot = freeSpot(placed, id, { x, y }, t);
    if (spot) placed.push(put(id, spot.x, spot.y, t));
  };

  const cabinX = pick(CABIN_AT) ?? 5;
  tryPut("cabin", cabinX, 13);
  near("mailbox", 41, random() < 0.5 ? 23 : 30);
  near("signpost", 40, placed.some((p) => p.id === "mailbox" && p.y < 26) ? 30 : 23);

  // The fire, somewhere in the middle, with its logs either above and below or to the sides.
  const fx = 12 + Math.floor(random() * 18);
  const fy = 21 + Math.floor(random() * 6);
  near("fire-ring", fx, fy);
  const fire = placed.find((p) => p.id === "fire-ring");
  if (fire) {
    if (random() < 0.6) {
      near("log-seat", fire.x + 1, fire.y - 2);
      near("log-seat", fire.x + 1, fire.y + 3);
    } else {
      near("log-seat", fire.x - 2, fire.y, 1);
      near("log-seat", fire.x + 4, fire.y, 1);
    }
  }
  if (random() < 0.8) near("trophy-shelf", cabinX + (cabinX > 20 ? -3 : 11), 15);

  for (let i = 0; i < count; i++) {
    const id = pick(taste);
    const thing = id ? thingOf(id) : null;
    if (!id || !thing) continue;
    const t = Math.floor(random() * turnsOf(thing));
    for (let tries = 0; tries < 24; tries++) {
      const x = YARD.x0 + Math.floor(random() * (YARD.x1 - YARD.x0));
      const y = YARD.y0 + 1 + Math.floor(random() * (YARD.y1 - YARD.y0));
      // A little air round whatever is already there, so that nothing looks stacked.
      const crowded = placed.some((p) => {
        const other = thingOf(p.id);
        if (!other || other.flat !== thing.flat) return false;
        const b = boxOf(p, other);
        const [w, d] = footprint(thing, t);
        return x <= b.x1 + 1 && x + w - 1 >= b.x0 - 1 && y <= b.y1 + 1 && y + d - 1 >= b.y0 - 1;
      });
      if (!crowded && tryPut(id, x, y, t)) break;
    }
  }
  return placed;
}

// ---------- keeping it ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isHandle = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z '-]{0,23}$/.test(v);

/**
 * Reads a kept camp back, as the town package reads one (`readCamp`): anything that is not a camp
 * gives `null` (a new camp is made); inside one, a part that makes no sense is put back to how a new
 * member has it, and a thing standing where it cannot stand is put away in the tray instead of lost.
 * The presents left at other camps are read here.
 */
export function parseCamp(raw: unknown): Camp | null {
  const camp = readCamp(raw);
  if (!camp || !isRecord(raw)) return null;
  const gave: Gave[] = [];
  if (Array.isArray(raw.gave))
    for (const g of raw.gave.slice(0, 40)) {
      if (!isRecord(g) || !isHandle(g.to) || !isThing(g.what) || gave.some((h) => h.to === g.to)) continue;
      gave.push({ to: g.to, what: g.what });
    }
  return pageCamp(camp, gave);
}
