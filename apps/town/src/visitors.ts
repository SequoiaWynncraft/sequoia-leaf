/**
 * Real members, and only real members, in their own skins, each where Leaf's list and Leaf's clock
 * have them (the rules are `@sequoia-leaf/town/clock.ts`), so the same on every page:
 *
 * - **Visitors**, in one of the games just now: standing by the Works' door or watching at the
 *   stump, at a spot that follows from their account. Leaf's list says nothing of when anybody
 *   came, so one is there from the moment the page hears of them. They never speak, and their card
 *   has only their name and rank.
 * - **Dozers**, gone in the last day and happy to be left in town: each on a seat for where they
 *   were (`dozing`), eyes closed, a small "z" drifting up. They never speak or move. Whoever goes
 *   from a game stays on their feet until `SITS_AFTER` after Leaf last saw them, then walks to
 *   their seat, or out through the gate if they do not stay or no seat is left.
 * - **A raid party home** (`homecoming`): those of it with no figure in town walk in through the
 *   gate, each in their own place in the party, and go again.
 *
 * Whoever is about the town is there live (`players.ts`), where they really are, and nobody live is
 * drawn here as well.
 */

import { CREAM } from "@sequoia-leaf/kit/palette.ts";
import { bake, type Body, lookFor, paintSkin, SIT, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import {
  dozing,
  GATE,
  GOES_FOR,
  homecoming,
  MUSTER,
  SITS_AFTER,
  standOf,
  type Walk,
  zAt,
} from "@sequoia-leaf/town/clock.ts";

import { feet, makeActor, onScreen, onWalk, sitsOn, stepPassing, walkAt } from "./actors.ts";
import { float } from "./fx.ts";
import { type Actor, type Doing, G, SEED } from "./game.ts";
import { guild, type Person } from "./guild.ts";
import { type Seat, SEATS } from "./world.ts";

/** How fast a member strolls, in pixels a second. */
const STROLL = 32;

/**
 * Somebody drawn here: their figure, eyes open (a look of their own until their skin arrives) and
 * shut, the "z" they last breathed, and whether they have been put anywhere yet.
 */
interface Visiting {
  a: Actor;
  open: Body;
  shut: Body | null;
  z: number;
  put: boolean;
}

const here = new Map<string, Visiting>();

/** Who is drawn in town live (fading away too), by their account, and their figure: told by `players.ts`; nobody until it does. */
let live: { ids(): ReadonlySet<string>; actor(id: string): Actor | null } = {
  ids: () => new Set(),
  actor: () => null,
};
/** Hears who is in town live, so that nobody is drawn twice. */
export function followLive(l: typeof live): void {
  live = l;
}

// ---------- eyes closed ----------

/** The colour of one pixel, as four numbers. */
function pixel(d: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];
}
const far = (a: readonly number[], b: readonly number[]): number =>
  Math.abs((a[0] ?? 0) - (b[0] ?? 0)) + Math.abs((a[1] ?? 0) - (b[1] ?? 0)) + Math.abs((a[2] ?? 0) - (b[2] ?? 0));

/**
 * A face seen from the front, its eyes closed. On a block-game face the eyes are one of rows three
 * to five, at columns one, two, five and six; the row taken is the one where those pixels stand out
 * most, from each other (a white and a pupil) and from the skin under the eye. Each of them is
 * painted the skin's colour a shade darker, so that each eye is a shut line.
 */
function shutEyes(c: HTMLCanvasElement, hx: number, hy: number): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height);
  out.g.drawImage(c, 0, 0);
  const img = out.g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const at = (x: number, y: number): [number, number, number, number] => pixel(d, c.width, hx + x, hy + y);
  const skin = at(2, 6);
  let row = 4;
  let most = -1;
  for (let r = 3; r <= 5; r++) {
    const [a, b, e, f] = [at(1, r), at(2, r), at(5, r), at(6, r)];
    const score = 3 * (far(a, b) + far(e, f)) + far(a, skin) + far(b, skin) + far(e, skin) + far(f, skin);
    if (score > most) {
      most = score;
      row = r;
    }
  }
  const [r, g, b, alpha] = skin;
  if (alpha < 200) return c;
  for (const x of [1, 2, 5, 6]) {
    const i = ((hy + row) * c.width + hx + x) * 4;
    d[i] = r * 0.6;
    d[i + 1] = g * 0.55;
    d[i + 2] = b * 0.6;
    d[i + 3] = 255;
  }
  out.g.putImageData(img, 0, 0);
  return out.c;
}

/** A member's figure dozing: sitting facing us with their eyes closed, and their face so on a card. */
function dozy(body: Body): Body {
  const frames = body.frames.map((row) => [...row]);
  const front = frames[0];
  const sat = front?.[SIT];
  // Seen from the front and sitting, the head is drawn at (2, 5); the side and back show no eyes.
  if (front && sat) front[SIT] = shutEyes(sat, 2, 5);
  return { frames, face: shutEyes(body.face, 0, 0) };
}

// ---------- where each is ----------

/** Somebody's figure here, made (and their skin asked for) the first time they are drawn. */
function figure(p: { id: string; name: string; rank?: string | null }): Visiting {
  const had = here.get(p.id);
  if (had) {
    if (p.rank) had.a.who = { ...had.a.who, rank: p.rank };
    return had;
  }
  const a = makeActor({ name: p.name, rank: p.rank ?? "", level: 0, voice: 0 }, null, 0, 0);
  a.id = p.id;
  a.speed = STROLL;
  const v: Visiting = { a, open: bake(paintSkin(lookFor(p.name))), shut: null, z: 0, put: false };
  here.set(p.id, v);
  G.visitors.push(a);
  const img = new Image();
  img.addEventListener("load", () => {
    try {
      v.open = bake(img);
      v.shut = null;
    } catch {
      // A picture that cannot be read: the look of their own stays.
    }
  });
  img.src = skinOf(p.id);
  return v;
}

/** Standing at a spot, as a walk that is over. */
const still = (to: Walk["to"]): Walk => ({ from: to, to, at: 0 });

/** On their feet: where a walk has them by Leaf's clock, or standing where it ends. */
function afoot(v: Visiting, w: Walk, doing: Doing): void {
  v.put = true;
  v.a.seat = null;
  v.a.dozing = null;
  v.a.body = v.open;
  v.a.doing = onWalk(v.a, w) ? doing : "walk";
}

/**
 * Asleep on a seat since the game last saw them (`seen`): eyes closed, a "z" now and then. Whoever
 * walked there, or is moved from another seat, is seen to sit down; whoever is first put here was
 * sitting already.
 */
function asleep(v: Visiting, s: Seat, seen: number): void {
  const a = v.a;
  if (a.seat !== s) a.sat = v.put ? G.t : -9;
  v.put = true;
  a.seat = s;
  a.x = s.from.x;
  a.y = s.from.y;
  a.dir = s.dir;
  a.moving = false;
  a.dozing = seen;
  a.doing = "home";
  a.body = v.shut ??= dozy(v.open);
  const z = zAt(SEED, a.id, G.now);
  if (z === v.z) return;
  v.z = z;
  if (onScreen(s.x, s.y)) float(feet(a).x + 4, feet(a).y - 20, "z", CREAM, 1.4);
}

/**
 * Puts every visitor, dozer and raid party walking in where Leaf's list, the guild's moments and
 * Leaf's clock (`G.now`) have them, `dt` seconds on for their hops, and takes away whoever they
 * have nowhere. `awake` is everybody else who may be sitting on one of the town's seats (the
 * member, the town's own, the other players): a seat one of them sits on is theirs, and whoever
 * dozed there dozes on the next.
 */
export function stepVisitors(dt: number, awake: readonly Actor[]): void {
  const now = G.now;
  for (const v of here.values()) stepPassing(v.a, dt);
  const liveNow = live.ids();
  const drawn = new Set<string>();
  /** Somebody to draw, unless they are in town live. */
  const draw = (p: { id: string; name: string; rank?: string | null }): Visiting | null => {
    if (liveNow.has(p.id)) return null;
    drawn.add(p.id);
    return figure(p);
  };

  for (const w of guild.visitors()) {
    const v = draw(w);
    if (v) afoot(v, still(standOf(w.id, w.at)), w.at);
  }

  const resting = guild.resting().filter((r) => !liveNow.has(r.id));
  const seats = dozing(
    resting.filter((r) => r.stays),
    SEATS.filter((s) => awake.every((a) => !sitsOn(a, s))),
  );
  for (const r of resting) {
    const up = r.seen + SITS_AFTER;
    const seat = seats.get(r.id);
    // Whoever was about the town was there live, and is next seen on their seat.
    if (r.at === "town") {
      const v = seat && now >= up ? draw(r) : null;
      if (v && seat) asleep(v, seat, r.seen);
      continue;
    }
    if (!seat && now >= up + GOES_FOR) continue;
    const v = draw(r);
    if (!v) continue;
    const stood = standOf(r.id, r.at);
    const walk: Walk = { from: stood, to: seat ? { ...seat.from, dir: seat.dir } : GATE, at: up };
    if (now < up) afoot(v, still(stood), r.at);
    else if (seat && walkAt(walk, STROLL, now).next === null) asleep(v, seat, r.seen);
    else afoot(v, walk, "walk");
  }

  for (const m of guild.deeds().moments) {
    if (m.kind !== "party" || now < m.at) continue;
    // Each has one place in the party from its start to its end; whoever has a figure in town already takes part where they are.
    m.who.slice(0, MUSTER.length).forEach((p, i) => {
      const walk = p.you || drawn.has(p.id) ? null : homecoming(SEED, m.at, i, now);
      const v = walk && draw(p);
      if (v && walk) afoot(v, walk, "walk");
    });
  }

  for (const [id, v] of here) {
    if (drawn.has(id)) continue;
    here.delete(id);
    G.visitors = G.visitors.filter((a) => a !== v.a);
  }
}

/** Whether somebody in town is a real member other than the member themself: visiting, or dozing. */
export const isVisitor = (a: Actor): boolean => G.visitors.includes(a);

/** The visitor somebody is, if they are in town and awake, or their figure if they are there live. */
export function visitorOf(p: Person): Actor | null {
  const v = here.get(p.id);
  return live.actor(p.id) ?? (v && v.a.dozing === null ? v.a : null);
}

/** Whoever somebody is drawn as in town, if anybody: their figure if they are there live, or the visitor they are, awake or dozing. */
export function drawnAs(id: string): Actor | null {
  return live.actor(id) ?? here.get(id)?.a ?? null;
}

/** Real members in town for looking at it from outside: where each is and what they are doing, and whether they are dozing. */
export function members(): { name: string; x: number; y: number; doing: string; dozing: boolean }[] {
  return [...here.values()].map(({ a }) => {
    const at = a.seat ?? a;
    return { name: a.who.name, x: Math.round(at.x), y: Math.round(at.y), doing: a.doing, dozing: a.dozing !== null };
  });
}
