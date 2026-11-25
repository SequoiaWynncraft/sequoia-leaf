/**
 * A camp, as rules: the clearing's squares, what stands where, what may be set down and what may
 * not, the tray of things not set out (a player reads "Storage"), and who lives there. Each thing
 * standing in a camp has an id of its own (`n`), so a command names the thing it means and never a
 * place in a list. Nothing stands in a camp that its member did not set there: whatever they get
 * goes into the tray (`store`).
 */

import type { Letter } from "./mail.ts";
import { footprint, type Thing, thingOf, THINGS, turnsOf } from "./things.ts";

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

/** Where a thing stands: which thing, the top-left square of the ground it takes, and which way round. */
export interface Spot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** A thing standing in a camp: its own id, never used again in the camp, where it stands, and a little state of its own (lit or not, which colour). */
export interface Placed {
  n: number;
  id: string;
  x: number;
  y: number;
  t: number;
  s: number;
}

export interface Camp {
  /** The pet the member chose to begin with; empty until they have chosen. */
  first: PetId | "";
  placed: Placed[];
  /**
   * The things the member has that are not set out, and how many of each. A player reads "Storage"
   * wherever it is named; in the code, and in what Leaf stores, its one name is `tray`.
   */
  tray: Record<string, number>;
  /**
   * The things that came into the tray since the member last looked in it, oldest first, and how
   * many arrivals they have looked at in all (`looked`). A page says how far it has shown by that
   * count, so looking twice, or from two pages, never takes the mark off what came after.
   */
  fresh: string[];
  looked: number;
  letters: Letter[];
  /** How many of the town's own who dropped by the member has greeted. */
  greeted: number;
  /** Trophies already handed over, so that each arrives once. */
  earned: string[];
}

// ---------- the ground a thing takes ----------

export function boxOf(p: Spot, t: Thing): Box {
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
export function standsBy(p: Spot, t: Thing): { x: number; y: number }[] {
  const b = boxOf(p, t);
  if (t.id === "cabin") return [{ x: b.x0 + DOOR, y: b.y1 + 1 }];
  const out: { x: number; y: number }[] = [];
  for (let x = b.x0; x <= b.x1; x++) out.push({ x, y: b.y1 + 1 }, { x, y: b.y0 - 1 });
  for (let y = b.y0; y <= b.y1; y++) out.push({ x: b.x0 - 1, y }, { x: b.x1 + 1, y });
  return out;
}

interface Taken {
  /** Which placed thing (by its place in the list) stands on each square, and which lies on it; -1 for none. */
  stand: Int16Array;
  floor: Int16Array;
  /** 1 where a walker is stopped. */
  solid: Uint8Array;
}

/** What is on every square, leaving out one thing (the one being moved, by its place in the list) if asked. */
export function taken(placed: readonly Spot[], skip = -1): Taken {
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
export function allReached(placed: readonly Spot[]): boolean {
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

/** The things a camp cannot do without, by name, as a list: "cabin, mailbox or signpost". */
const ROOTED = THINGS.filter((t) => t.rooted).map((t) => t.name.toLowerCase());
const rooted = `${ROOTED.slice(0, -1).join(", ")}${ROOTED.length > 1 ? " or " : ""}${ROOTED.at(-1) ?? ""}`;

export const WHY_NOT: Readonly<Record<Exclude<Verdict, "ok">, string>> = {
  off: "Not in the trees.",
  trail: "The trail stays clear.",
  taken: "Something is there already.",
  shut: `That would block the way to the ${rooted}.`,
  full: "The camp is full. Put something away first.",
};

/** How many things may be set out in a camp: with that many standing, more stays in the tray. */
export const MOST_PLACED = 300;

/** Whether a camp has as many things set out as may be. */
export const campFull = (placed: readonly Spot[]): boolean => placed.length >= MOST_PLACED;

/** Whether a thing may be set down with its ground starting at a square. `skip` is the thing being moved, by its place in the list. */
export function canPlace(placed: readonly Spot[], id: string, x: number, y: number, t: number, skip = -1): Verdict {
  const thing = thingOf(id);
  if (!thing) return "off";
  const mine: Spot = { id, x, y, t };
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
  placed: readonly Spot[],
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
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        // Squared, so that it is a whole number and ties fall the same everywhere.
        const far = dx * dx + dy * dy;
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
 * Where a thing goes turned the next way round: about its middle, or else the nearest spot within
 * 3 squares; null if it does not turn, or fits nowhere near. The page sends it as a `move`.
 */
export function turned(placed: readonly Placed[], n: number): { x: number; y: number; t: number } | null {
  const i = placed.findIndex((p) => p.n === n);
  const p = placed[i];
  const thing = p ? thingOf(p.id) : null;
  if (!p || !thing || turnsOf(thing) < 2) return null;
  const t = (p.t + 1) % turnsOf(thing);
  const [w, d] = footprint(thing, p.t);
  const [nw, nd] = footprint(thing, t);
  const x = p.x + Math.floor((w - nw) / 2);
  const y = p.y + (d - nd);
  if (canPlace(placed, p.id, x, y, t, i) === "ok") return { x, y, t };
  const spot = freeSpot(placed, p.id, { x: p.x + Math.floor(w / 2), y: p.y + Math.floor(d / 2) }, t, i);
  return spot && (spot.x - x) ** 2 + (spot.y - y) ** 2 <= 9 ? { ...spot, t } : null;
}

/** The tray as a list, in the catalogue's order. */
export function trayList(camp: Pick<Camp, "tray">): { id: string; n: number }[] {
  return THINGS.flatMap((t) => {
    const n = camp.tray[t.id] ?? 0;
    return n > 0 ? [{ id: t.id, n }] : [];
  });
}

// ---------- who lives there ----------

/** How many things must be set out before somebody else moves in: a new camp starts with nine. */
export const COSY = 24;
/** How many of the town's own who drop by must be greeted before somebody follows them in to stay. */
export const KIND = 3;

/** The pets that live in the camp, in the order they came: the first chosen, then one for each thing done. */
export function petsOf(camp: Pick<Camp, "first" | "placed" | "greeted">): PetId[] {
  if (!camp.first) return [];
  const rest = PETS.filter((p) => p !== camp.first);
  const more = (camp.placed.length >= COSY ? 1 : 0) + (camp.greeted >= KIND ? 1 : 0);
  return [camp.first, ...rest.slice(0, more)];
}

/** What anybody at a camp sees there, its owner or a visitor: the pet chosen first, what stands there, and who lives there. */
export interface PublicCamp {
  readonly first: Camp["first"];
  readonly placed: readonly Placed[];
  readonly pets: readonly PetId[];
}

/** A camp's public part, worked out from the whole camp: a visitor is never given what it is worked out from. */
export const publicCamp = (camp: Camp): PublicCamp => ({ first: camp.first, placed: camp.placed, pets: petsOf(camp) });

/** A camp as a visitor is given it: its public part, and none of the owner's own (no tray, letters, callers greeted or things won). */
export function visitorsCamp(camp: Camp): Camp {
  const { first, placed } = publicCamp(camp);
  return {
    first,
    placed: placed.map(({ n, id, x, y, t, s }) => ({ n, id, x, y, t, s })),
    tray: {},
    fresh: [],
    looked: 0,
    letters: [],
    greeted: 0,
    earned: [],
  };
}

/** Who lives in a camp, as a view off the wire says: each pet once, or null for anything else. */
export function readPets(v: unknown): PetId[] | null {
  if (!Array.isArray(v) || v.length > PETS.length) return null;
  const pets: PetId[] = [];
  for (const p of v) {
    if (!isPet(p) || pets.includes(p)) return null;
    pets.push(p);
  }
  return pets;
}

/**
 * How many of any one thing a member may have, standing in the camp and in the tray together:
 * nothing more of it is kept while they have that many.
 */
export const MOST_OWNED = 999;

/** How many of a thing the member has, wherever it is. */
export const owned = (camp: Pick<Camp, "placed" | "tray">, id: string): number =>
  camp.placed.filter((p) => p.id === id).length + (camp.tray[id] ?? 0);

/**
 * One more of a thing goes into the tray, new to the member: the one way anything they get (bought,
 * won, taken out of a letter) arrives. False, and nothing kept, when they have as many as may be had.
 */
export function store(camp: Pick<Camp, "placed" | "tray" | "fresh" | "looked">, id: string): boolean {
  if (owned(camp, id) >= MOST_OWNED) return false;
  camp.tray[id] = (camp.tray[id] ?? 0) + 1;
  camp.fresh.push(id);
  // Past `MOST_NEW` the oldest counts as looked at.
  if (camp.fresh.length > MOST_NEW) lookedThrough(camp, camp.looked + 1);
  return true;
}

/** How many arrivals are kept as new at once. */
export const MOST_NEW = 500;

/** The member has looked at every arrival up to the `through`th: those are new no more. */
export function lookedThrough(camp: Pick<Camp, "fresh" | "looked">, through: number): void {
  const seen = Math.min(camp.fresh.length, through - camp.looked);
  if (seen <= 0) return;
  camp.fresh.splice(0, seen);
  camp.looked += seen;
}

// ---------- a new camp ----------

const put = (id: string, x: number, y: number): Spot => ({ id, x, y, t: 0 });

/** The camp a new member finds: a cabin, a fire with two logs by it, a mailbox, a signpost, a shelf, and room. */
export const NEW_CAMP: readonly Spot[] = [
  put("cabin", 7, 13),
  put("trophy-shelf", 18, 15),
  put("fire-ring", 23, 24),
  put("log-seat", 22, 22),
  put("log-seat", 22, 27),
  put("lantern-post", 13, 18),
  put("mailbox", 41, 23),
  put("signpost", 41, 30),
  put("stump", 28, 25),
];

/** A new member's camp, its things numbered from 0. */
export const newCamp = (): Camp => ({
  first: "",
  placed: NEW_CAMP.map(({ id, x, y, t }, n) => ({ n, id, x, y, t, s: 0 })),
  tray: {},
  fresh: [],
  looked: 0,
  letters: [],
  greeted: 0,
  earned: [],
});
