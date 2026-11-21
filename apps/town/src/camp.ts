/**
 * A camp, as rules with no page in them: the clearing's squares, what stands where, what may be
 * set down and what may not, the tray of things put away, who lives there, and how a guild-mate's
 * camp is laid out from nothing but a number. `campscene.ts` shows it; `save.ts` keeps it.
 */

import { rng } from "@sequoia-leaf/kit/util.ts";

import { isLetter, type Letter } from "./mail.ts";
import { footprint, isThing, type Thing, thingOf, THINGS, turnsOf } from "./things.ts";

/** The clearing in squares: fifty-two across and forty down, eight art pixels to the square. */
export const CGW = 52;
export const CGH = 40;

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The yard: the squares that can be walked on and built on. */
export const YARD: Box = { x0: 4, y0: 13, x1: 47, y1: 36 };
/** The way in off the trail, on the east side. It is kept clear, so nobody is ever shut out. */
export const TRAIL: Box = { x0: 43, y0: 25, x1: 51, y1: 28 };
/** The square a walker stands on once they are in off the trail. */
export const ENTRY = { x: 44, y: 27 } as const;

const within = (b: Box, x: number, y: number): boolean => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

/** Whether anybody may stand on a square, before anything is set down. */
export const walkable = (x: number, y: number): boolean => within(YARD, x, y) || within(TRAIL, x, y);

export const PETS = ["glorp", "cat", "fox"] as const;
export type PetId = (typeof PETS)[number];
export const isPet = (v: unknown): v is PetId => PETS.some((p) => p === v);

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

/** A present the member has left at a guild-mate's camp. */
export interface Gave {
  to: string;
  what: string;
}

export interface Camp {
  /** The pet the member chose to begin with; empty until they have chosen. */
  first: PetId | "";
  placed: Placed[];
  /** Things put away, and how many of each. */
  tray: Record<string, number>;
  /** Things bought or won that have not yet been unpacked in the camp. */
  parcels: string[];
  letters: Letter[];
  gave: Gave[];
  /** Trophies already handed over, so that each arrives once. */
  earned: string[];
}

// ---------- the ground a thing takes ----------

export function boxOf(p: Placed, t: Thing): Box {
  const [w, d] = footprint(t, p.t);
  return { x0: p.x, y0: p.y, x1: p.x + w - 1, y1: p.y + d - 1 };
}

/** Whether a square of a thing's ground stops a walker. */
function stops(t: Thing, b: Box, x: number, y: number): boolean {
  if (t.solid === "all") return true;
  if (t.solid === "none") return false;
  // Only its two ends: along whichever way it runs.
  return b.x1 - b.x0 >= b.y1 - b.y0 ? x === b.x0 || x === b.x1 : y === b.y0 || y === b.y1;
}

/** The cabin's door is this many squares along its front; the square before it must be clear. */
const DOOR = 6;

/** The squares somebody could stand on to use a thing: before the cabin's door, or beside anything else. */
export function standsBy(p: Placed, t: Thing): { x: number; y: number }[] {
  const b = boxOf(p, t);
  if (t.id === "cabin") return [{ x: b.x0 + DOOR, y: b.y1 + 1 }];
  const out: { x: number; y: number }[] = [];
  for (let x = b.x0; x <= b.x1; x++) out.push({ x, y: b.y1 + 1 }, { x, y: b.y0 - 1 });
  for (let y = b.y0; y <= b.y1; y++) out.push({ x: b.x0 - 1, y }, { x: b.x1 + 1, y });
  return out;
}

interface Taken {
  /** Which placed thing stands on each square, and which lies on it; -1 for none. */
  stand: Int16Array;
  floor: Int16Array;
  /** 1 where a walker is stopped. */
  solid: Uint8Array;
}

/** What is on every square, leaving out one thing (the one being moved) if asked. */
export function taken(placed: readonly Placed[], skip = -1): Taken {
  const stand = new Int16Array(CGW * CGH).fill(-1);
  const floor = new Int16Array(CGW * CGH).fill(-1);
  const solid = new Uint8Array(CGW * CGH);
  placed.forEach((p, i) => {
    const t = thingOf(p.id);
    if (!t || i === skip) return;
    const b = boxOf(p, t);
    for (let y = Math.max(0, b.y0); y <= Math.min(CGH - 1, b.y1); y++) {
      for (let x = Math.max(0, b.x0); x <= Math.min(CGW - 1, b.x1); x++) {
        const n = y * CGW + x;
        if (t.flat) floor[n] = i;
        else stand[n] = i;
        if (stops(t, b, x, y)) solid[n] = 1;
      }
    }
  });
  return { stand, floor, solid };
}

/** Every square a walker can get to from the trail, with these squares stopped up. */
function reach(solid: Uint8Array): Uint8Array {
  const seen = new Uint8Array(CGW * CGH);
  const queue = [ENTRY.y * CGW + ENTRY.x];
  seen[queue[0] ?? 0] = 1;
  for (let at = 0; at < queue.length; at++) {
    const n = queue[at] ?? 0;
    const x = n % CGW;
    const y = Math.floor(n / CGW);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const m = ny * CGW + nx;
      if (!walkable(nx, ny) || solid[m] || seen[m]) continue;
      seen[m] = 1;
      queue.push(m);
    }
  }
  return seen;
}

/** Whether everything the camp cannot do without can still be walked up to. */
export function allReached(placed: readonly Placed[]): boolean {
  const seen = reach(taken(placed).solid);
  return placed.every((p) => {
    const t = thingOf(p.id);
    if (!t?.rooted) return true;
    return standsBy(p, t).some((c) => walkable(c.x, c.y) && seen[c.y * CGW + c.x] === 1);
  });
}

// ---------- setting things down ----------

/** Why a thing may not go somewhere, or that it may. */
export type Verdict = "ok" | "off" | "trail" | "taken" | "shut" | "full";

export const WHY_NOT: Readonly<Record<Exclude<Verdict, "ok">, string>> = {
  off: "Not in the trees.",
  trail: "The trail stays clear.",
  taken: "Something is there already.",
  shut: "That would shut something in.",
  full: "The camp is full. Put something away first.",
};

/** How many things may be set out in a camp: with that many standing, more stays in the tray. */
export const MOST_PLACED = 300;

/** Whether a camp has as many things set out as may be. */
export const campFull = (placed: readonly Placed[]): boolean => placed.length >= MOST_PLACED;

/** Whether a thing may be set down with its ground starting at a square. `skip` is the thing being moved. */
export function canPlace(placed: readonly Placed[], id: string, x: number, y: number, t: number, skip = -1): Verdict {
  const thing = thingOf(id);
  if (!thing) return "off";
  const mine: Placed = { id, x, y, t, s: 0 };
  const b = boxOf(mine, thing);
  const on = taken(placed, skip);
  for (let cy = b.y0; cy <= b.y1; cy++) {
    for (let cx = b.x0; cx <= b.x1; cx++) {
      if (!within(YARD, cx, cy)) return "off";
      if (within(TRAIL, cx, cy)) return "trail";
      const n = cy * CGW + cx;
      if ((thing.flat ? on.floor[n] : on.stand[n]) !== -1) return "taken";
    }
  }
  const after = placed.filter((_p, i) => i !== skip);
  after.push(mine);
  return allReached(after) ? "ok" : "shut";
}

/** The nearest square to `near` where a thing may be set down, looking outwards in rings. */
export function freeSpot(
  placed: readonly Placed[],
  id: string,
  near: { x: number; y: number },
  t = 0,
  skip = -1,
): { x: number; y: number } | null {
  const thing = thingOf(id);
  if (!thing) return null;
  const [w, d] = footprint(thing, t);
  const ox = near.x - Math.floor(w / 2);
  const oy = near.y - Math.floor(d / 2);
  for (let r = 0; r < Math.max(CGW, CGH); r++) {
    let best: { x: number; y: number } | null = null;
    let bestD = 1e9;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const far = Math.hypot(dx, dy);
        if (far >= bestD || canPlace(placed, id, ox + dx, oy + dy, t, skip) !== "ok") continue;
        bestD = far;
        best = { x: ox + dx, y: oy + dy };
      }
    }
    if (best) return best;
  }
  return null;
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

/** How many parcels may wait by the trail at once: nothing more is sent while that many are there. */
export const MOST_PARCELS = 200;

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

/**
 * How many of any one thing a member may have, standing in the camp, in the tray and waiting by
 * the trail together: nothing more of it is sent while they have that many.
 */
export const MOST_OWNED = 999;

/** How many of a thing the member has, wherever it is. */
export function owned(camp: Camp, id: string): number {
  return (
    camp.placed.filter((p) => p.id === id).length + (camp.tray[id] ?? 0) + camp.parcels.filter((p) => p === id).length
  );
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
/** At how many guild-mates' camps a present must be left before somebody follows the member home. */
export const KIND = 3;

/** The pets that live in the camp, in the order they came: the first chosen, then one for each thing done. */
export function petsOf(camp: Camp): PetId[] {
  if (!camp.first) return [];
  const rest = PETS.filter((p) => p !== camp.first);
  const more = (camp.placed.length >= COSY ? 1 : 0) + (camp.gave.length >= KIND ? 1 : 0);
  return [camp.first, ...rest.slice(0, more)];
}

// ---------- a new camp, and a guild-mate's ----------

const put = (id: string, x: number, y: number, t = 0): Placed => ({ id, x, y, t, s: 0 });

/** The camp a new member finds: a cabin, a fire with two logs by it, a mailbox, a signpost, a shelf, and room. */
export function newCamp(): Camp {
  return {
    first: "",
    placed: [
      put("cabin", 7, 13),
      put("trophy-shelf", 18, 15),
      put("fire-ring", 23, 24),
      put("log-seat", 22, 22),
      put("log-seat", 22, 27),
      put("lantern-post", 13, 18),
      put("mailbox", 41, 23),
      put("signpost", 41, 30),
      put("stump", 28, 25),
    ],
    tray: {},
    parcels: [],
    letters: [],
    gave: [],
    earned: [],
  };
}

const CABIN_AT = [5, 20, 34] as const;

/**
 * A guild-mate's camp, laid out from a number: the same number always gives the same camp. `taste`
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
const whole = (v: unknown, most: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(most, Math.floor(v)) : 0;
const things = (v: unknown, most: number): string[] => (Array.isArray(v) ? v.filter(isThing).slice(0, most) : []);
const isHandle = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z '-]{0,23}$/.test(v);

/** The most of anything a record may hold. */
const MOST = { placed: MOST_PLACED, each: MOST_OWNED, parcels: MOST_PARCELS, letters: 24, gave: 40 };

/**
 * Reads a kept camp back. Anything that is not a camp gives `null` (a new camp is made); inside
 * one, a part that makes no sense is put back to how a new member has it, and a thing standing
 * where it cannot stand is put away in the tray instead of lost.
 */
export function parseCamp(raw: unknown): Camp | null {
  if (!isRecord(raw) || !Array.isArray(raw.placed)) return null;
  const camp: Camp = {
    first: isPet(raw.first) ? raw.first : "",
    placed: [],
    tray: {},
    parcels: things(raw.parcels, MOST.parcels),
    letters: Array.isArray(raw.letters) ? raw.letters.filter(isLetter).slice(-MOST.letters) : [],
    gave: [],
    earned: [...new Set(things(raw.earned, 64))],
  };
  if (isRecord(raw.tray))
    for (const [id, n] of Object.entries(raw.tray))
      if (isThing(id) && whole(n, MOST.each) > 0) camp.tray[id] = whole(n, MOST.each);
  for (const p of raw.placed.slice(0, MOST.placed)) {
    if (!isRecord(p) || !isThing(p.id)) continue;
    const thing = thingOf(p.id);
    if (!thing) continue;
    const t = whole(p.t, 3) % turnsOf(thing);
    const x = whole(p.x, CGW);
    const y = whole(p.y, CGH);
    if (canPlace(camp.placed, p.id, x, y, t) === "ok") camp.placed.push({ id: p.id, x, y, t, s: whole(p.s, 7) });
    else camp.tray[p.id] = Math.min(MOST.each, (camp.tray[p.id] ?? 0) + 1);
  }
  // A camp is never without the things it cannot do without.
  for (const fresh of newCamp().placed) {
    const thing = thingOf(fresh.id);
    if (!thing?.rooted || camp.placed.some((p) => p.id === fresh.id)) continue;
    delete camp.tray[fresh.id];
    const spot = freeSpot(camp.placed, fresh.id, fresh);
    if (spot) camp.placed.push({ ...fresh, ...spot });
  }
  if (Array.isArray(raw.gave))
    for (const g of raw.gave.slice(0, MOST.gave)) {
      if (!isRecord(g) || !isHandle(g.to) || !isThing(g.what) || camp.gave.some((h) => h.to === g.to)) continue;
      camp.gave.push({ to: g.to, what: g.what });
    }
  return camp;
}
