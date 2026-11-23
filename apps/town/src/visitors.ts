/**
 * Real members, and only real members, in their own skins, each where Leaf's list and Leaf's clock
 * have them (the rules are `@sequoia-leaf/town/clock.ts`), so the same on every page:
 *
 * - **Visitors**, in one of the games just now, busy at it in place, each at a spot of their own
 *   (`spots.ts`): at the Works working at a crate beside them, at the raid table sitting at the stump
 *   over its board, in the Grove standing before its stone while a light rises from it now and then.
 *   Away (Leaf's rule) they have sat down in their spot and nodded off: eyes closed, a "z" now and
 *   then. Somebody the page sees go to one of them walks to their spot once, from where the page last
 *   drew them or the place's way in, and stops; anybody there when the page first hears of them is
 *   there already. They never speak, and their card has their name and rank, and what they are about.
 * - **Dozers**, gone in the last day and happy to be left in town: each on a seat for where they
 *   were (`dozing`), eyes closed, a small "z" drifting up. They never speak or move. Whoever goes
 *   from a game stays on their feet in their spot until `SITS_AFTER` after Leaf last saw them, then
 *   walks to their seat, or out through the gate if they do not stay or no seat is left.
 * - **A raid party home** (`homecoming`): those of it with no figure in town walk in through the
 *   gate, each in their own place in the party, and go again.
 *
 * Anybody drawn here whom the page no longer has anywhere to draw (gone to their camp, say) walks off
 * through the gate once. Whoever is about the town is there live (`players.ts`), where they really
 * are, and nobody live is drawn here as well.
 */

import { away } from "@sequoia-leaf/core";
import { BARK, CREAM, LEAF, PAPER, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bake, type Body, lookFor, paintSkin, SIT, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { type Ctx, makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";
import {
  dozing,
  GATE,
  GOES_FOR,
  homecoming,
  MUSTER,
  SITS_AFTER,
  type Spot,
  type Stand,
  type Walk,
  zAt,
} from "@sequoia-leaf/town/clock.ts";

import { feet, makeActor, onScreen, onWalk, putAs, sitsOn, stepPassing, walkAt } from "./actors.ts";
import { bit, float } from "./fx.ts";
import { type Actor, type Doing, G, SEED } from "./game.ts";
import { guild, type Person } from "./guild.ts";
import { VISITORS_MOST } from "./live.ts";
import { crate, type Standing } from "./props.ts";
import {
  type Box,
  clearOf,
  crateAt,
  further,
  keepClear,
  LAID,
  makeSpots,
  meet,
  poseAt,
  strings,
  WAY_IN,
} from "./spots.ts";
import { props } from "./town.ts";
import { GROVE, type Seat, SEATS, TOWN } from "./world.ts";

/** How fast a member strolls, in pixels a second. */
const STROLL = 32;

/**
 * Somebody drawn here: their figure, eyes open (a look of their own until their skin arrives) and
 * shut, the "z" they last breathed, whether they have been put anywhere yet, a seat of their own for
 * sitting where they are (at the stump, or nodded off), the spot they have at one of the games and
 * their one walk to it, the last blow of their hammer, and their walk off once they have nowhere.
 */
interface Visiting {
  a: Actor;
  open: Body;
  shut: Body | null;
  z: number;
  put: boolean;
  seat: Seat;
  at: { place: Stand; n: number; spot: Spot } | null;
  walk: Walk | null;
  blow: number;
  off: Walk | null;
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
export function dozy(body: Body): Body {
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
  const v: Visiting = {
    a,
    open: bake(paintSkin(lookFor(p.name))),
    shut: null,
    z: 0,
    put: false,
    seat: { x: 0, y: 0, dir: 0, from: { x: 0, y: 0 }, at: "table", taken: false },
    at: null,
    walk: null,
    blow: 0,
    off: null,
  };
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
  putAs(v.a, null);
  v.a.dozing = null;
  v.a.body = v.open;
  v.a.doing = onWalk(v.a, w) ? doing : "walk";
}

/** Sitting where they are, on a seat of their own there (`v.seat`), facing as `at` does. */
function sitAt(v: Visiting, at: Spot): void {
  const a = v.a;
  const s = v.seat;
  if (a.seat !== s || s.x !== at.x || s.y !== at.y || s.dir !== at.dir) {
    Object.assign(s, { x: at.x, y: at.y, dir: at.dir, from: { x: at.x, y: at.y } });
    a.sat = -9;
  }
  v.put = true;
  putAs(a, s);
  a.x = at.x;
  a.y = at.y;
  a.dir = at.dir;
  a.moving = false;
  a.dozing = null;
}

/** On their feet in their spot, facing `dir`. */
function standAt(v: Visiting, at: Pt, dir: Spot["dir"]): void {
  const a = v.a;
  v.put = true;
  putAs(a, null);
  a.dozing = null;
  a.body = v.open;
  a.x = at.x;
  a.y = at.y;
  a.dir = dir;
  a.moving = false;
}

/** A "z" drifting up from somebody asleep, every two seconds or so by Leaf's clock, the same moments on every page. */
function breathe(v: Visiting): void {
  const a = v.a;
  const z = zAt(SEED, a.id, G.now);
  if (z === v.z) return;
  v.z = z;
  const at = feet(a);
  if (onScreen(at.x, at.y)) float(at.x + 4, at.y - 20, "z", CREAM, 1.4);
}

/** Away from the keys, though still in the game: sat down in their spot, facing us, nodded off. */
function nap(v: Visiting, at: Spot): void {
  sitAt(v, { ...at, dir: 0 });
  v.a.body = v.shut ??= dozy(v.open);
  breathe(v);
}

/** How often a light rises from the Grove's stone while somebody is at it, by Leaf's clock. */
const MOTE_MS = 2400;
/** The last of them, by its number. */
let mote = 0;

/** A light rising from the Grove's stone, now and then while somebody is at it: the same moments on every page. */
function stoneLight(): void {
  const k = Math.floor(G.now / MOTE_MS);
  if (k === mote) return;
  mote = k;
  if (!onScreen(GROVE.x, GROVE.y)) return;
  bit({ x: GROVE.x - 2 + (k % 5), y: GROVE.y - 10, vx: 0, vy: -9, drag: 0.3, ttl: 1.9, col: LEAF, glow: true });
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
  putAs(a, s);
  a.x = s.from.x;
  a.y = s.from.y;
  a.dir = s.dir;
  a.moving = false;
  a.dozing = seen;
  a.doing = "home";
  a.body = v.shut ??= dozy(v.open);
  breathe(v);
}

// ---------- the spots ----------

/** The places that are busy, in the order their spots are given out. */
const STANDS: readonly Stand[] = ["works", "table", "grove"];

/** The most spots each place has: everybody the town draws at the games at once, and a few gone from them still on their feet. */
const MOST = VISITORS_MOST + 4;

/**
 * Each place's spots, worked out once the town stands: those laid by hand, then further ones a step
 * out (`further`), clear of everything in `keepClear`, of the strings of lights, of the things
 * standing (`clearOf`), and of the spots of the places worked out before.
 */
let spotsLaid: Map<Stand, readonly Spot[]> | null = null;
function spotsOf(at: Stand): readonly Spot[] {
  if (!spotsLaid) {
    const taken: Box[] = [...keepClear(), ...strings()];
    const offThings = clearOf(props.flatMap((p) => (p.hit ? [{ box: p.hit, z: p.z }] : [])));
    const out = new Map<Stand, readonly Spot[]>();
    for (const place of STANDS) {
      const others = taken.slice();
      const spots = further(
        place,
        MOST,
        (p) => !TOWN.footBlocked(p.x, p.y),
        (b) => offThings(b) && others.every((t) => !meet(b, t)),
      );
      out.set(place, spots);
      for (const s of spots)
        taken.push({ x: s.x - 5, y: s.y - 21, w: 10, h: 21 }, ...(place === "works" ? [crateAt(s)] : []));
    }
    spotsLaid = out;
  }
  return spotsLaid.get(at) ?? LAID[at];
}

/** Each place's spots, for looking at the town from outside: where each is, which way it faces, and whether it was laid by hand. */
export const spotsNow = (): { at: Stand; x: number; y: number; dir: number; laid: boolean }[] =>
  STANDS.flatMap((at) => spotsOf(at).map((s, n) => ({ at, x: s.x, y: s.y, dir: s.dir, laid: n < LAID[at].length })));

/** Who has which spot at each place, kept while they stay. */
const spots = makeSpots(spotsOf);

/** Where each was last drawn live in town, and when by Leaf's clock: whoever then goes into a game walks to their spot from there. */
const lastLive = new Map<string, { x: number; y: number; at: number }>();
/** How long after the page last drew somebody live their walk to a spot sets out from there, in milliseconds. */
const LIVE_FOR = 15_000;
/** Everybody the page had anywhere at the last step: whoever turns up at a game after that came from somewhere, and walks to their spot. */
let known = new Set<string>();

/** Crates on the ground and hammers in hand at the Works this moment, as they are drawn among the people. */
let tools: Standing[] = [];

/** A hammer, by the hand of somebody facing left or right (`dir`), raised or down on their crate. */
function hammer(g: Ctx, x: number, y: number, dir: Spot["dir"], up: boolean): void {
  const s = dir === 1 ? -1 : 1;
  const at = (dx: number, dy: number, w: number, h: number, col: string): void =>
    R(g, s > 0 ? x + dx : x - dx - w + 1, y + dy, w, h, col);
  if (up) {
    // Raised before their face.
    at(5, -16, 1, 4, BARK[3]);
    at(4, -18, 3, 2, STONE[2]);
  } else {
    at(2, -11, 1, 1, BARK[3]);
    at(3, -10, 1, 1, BARK[3]);
    at(4, -9, 1, 1, BARK[3]);
    at(4, -8, 3, 2, STONE[2]);
  }
}

/** Somebody at work at the Works: in their spot, their crate in their arms or beside them, their hammer raised or down, a chip off the crate at each blow. */
function work(v: Visiting, at: Stand, n: number, s: Spot, w: NonNullable<ReturnType<typeof poseAt>["work"]>): void {
  standAt(v, s, w.dir);
  v.a.carry = w.held;
  v.a.doing = at;
  if (!w.held) tools.push(crateOf(s));
  if (w.hammer) {
    const up = w.hammer === "up";
    const a = v.a;
    tools.push({
      z: s.y + 0.1,
      paint: (g, cx, cy) => {
        const f = feet(a);
        hammer(g, Math.round(f.x) - cx, Math.round(f.y) - cy, w.dir, up);
      },
    });
  }
  if (w.blow !== v.blow) {
    const first = v.blow === 0;
    v.blow = w.blow;
    const c = crateAt(s);
    if (!first && !w.held && onScreen(s.x, s.y))
      bit({
        x: c.x + 3,
        y: c.y,
        vx: (s.dir === 1 ? -1 : 1) * (6 + (n % 3) * 3),
        vy: -18,
        pull: 60,
        ttl: 0.5,
        col: PAPER[1],
      });
  }
}

/**
 * Puts every visitor, dozer and raid party walking in where Leaf's list, the guild's moments and
 * Leaf's clock (`G.now`) have them, `dt` seconds on for their hops, sends whoever they have nowhere
 * off through the gate, and takes them away once they are through. `awake` is everybody else who may
 * be sitting on one of the town's seats (the member, the town's own, the other players): a seat one
 * of them sits on is theirs, and whoever dozed there dozes on the next.
 */
export function stepVisitors(dt: number, awake: readonly Actor[]): void {
  const now = G.now;
  tools = [];
  for (const v of here.values()) stepPassing(v.a, dt);
  const liveNow = live.ids();
  for (const id of liveNow) {
    const a = live.actor(id);
    if (a) lastLive.set(id, { x: a.x, y: a.y, at: now });
  }
  const drawn = new Set<string>();
  /** Somebody to draw, unless they are in town live. */
  const draw = (p: { id: string; name: string; rank?: string | null }): Visiting | null => {
    if (liveNow.has(p.id)) return null;
    drawn.add(p.id);
    return figure(p);
  };

  const visitors = guild.visitors().filter((w) => !liveNow.has(w.id));
  const resting = guild.resting().filter((r) => !liveNow.has(r.id));
  // Who has which spot at each place: those busy there, and those gone from it still on their feet there.
  const placed = new Map(
    STANDS.map((at) => [
      at,
      spots.place(at, [
        ...visitors.filter((w) => w.at === at).map((w) => w.id),
        ...resting.filter((r) => r.at === at && now < r.seen + SITS_AFTER).map((r) => r.id),
      ]),
    ]),
  );
  /** Gives somebody their spot at a place, and the one walk there if they are new to it: from where they are, from where the page last drew them live, or the place's way in. */
  const toSpot = (v: Visiting, id: string, at: Stand, got: { spot: Spot; n: number }, fresh: boolean): void => {
    if (v.at?.place === at && v.at.n === got.n) return;
    const was = lastLive.get(id);
    const from: Pt | null = v.put
      ? v.a
      : fresh && known.has(id)
        ? was && now - was.at < LIVE_FOR
          ? was
          : WAY_IN[at]
        : null;
    v.at = { place: at, n: got.n, spot: got.spot };
    v.walk = from ? { from: { x: from.x, y: from.y, dir: v.a.dir }, to: got.spot, at: now } : null;
  };

  let atStone = false;
  for (const w of visitors) {
    const got = placed.get(w.at)?.get(w.id);
    if (!got) continue;
    const fresh = !here.has(w.id);
    const v = draw(w);
    if (!v) continue;
    v.off = null;
    v.a.carry = false;
    toSpot(v, w.id, w.at, got, fresh);
    const way = v.walk ? walkAt(v.walk, STROLL, now) : null;
    const pose = poseAt({ id: w.id, at: w.at, spot: got.spot, n: got.n, away: away(w.acted, now), now, way });
    if (pose.walking && v.walk) afoot(v, v.walk, w.at);
    else if (pose.dozing) {
      v.walk = null;
      nap(v, got.spot);
      v.a.doing = w.at;
      if (w.at === "works") tools.push(crateOf(got.spot));
    } else {
      v.walk = null;
      v.a.body = v.open;
      if (pose.work) work(v, w.at, got.n, got.spot, pose.work);
      else if (pose.seated) {
        sitAt(v, got.spot);
        v.a.doing = w.at;
      } else {
        standAt(v, got.spot, pose.dir);
        v.a.doing = w.at;
      }
    }
    if (w.at === "grove") atStone = true;
  }
  if (atStone) stoneLight();

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
      if (v) v.off = null;
      if (v && seat) asleep(v, seat, r.seen);
      continue;
    }
    if (!seat && now >= up + GOES_FOR) continue;
    const got = placed.get(r.at)?.get(r.id);
    if (now < up && !got) continue;
    const v = draw(r);
    if (!v) continue;
    v.off = null;
    v.a.carry = false;
    if (got) toSpot(v, r.id, r.at, got, false);
    const stood = v.at?.spot ?? { ...WAY_IN[r.at], dir: 0 };
    const walk: Walk = { from: stood, to: seat ? { ...seat.from, dir: seat.dir } : GATE, at: up };
    if (now < up) {
      // Gone, and not yet off: on their feet in their spot, their crate by them at the Works.
      afoot(v, still(stood), r.at);
      if (r.at === "works") tools.push(crateOf(stood));
    } else if (seat && walkAt(walk, STROLL, now).next === null) asleep(v, seat, r.seen);
    else afoot(v, walk, "walk");
  }

  for (const m of guild.deeds().moments) {
    if (m.kind !== "party" || now < m.at) continue;
    // Each has one place in the party from its start to its end; whoever has a figure in town already takes part where they are.
    m.who.slice(0, MUSTER.length).forEach((p, i) => {
      const walk = p.you || drawn.has(p.id) ? null : homecoming(SEED, m.at, i, now);
      const v = walk && draw(p);
      if (v && walk) {
        v.off = null;
        afoot(v, walk, "walk");
      }
    });
  }

  // Whoever the page has nowhere now walks off through the gate once, unless they are in town live.
  for (const [id, v] of here) {
    if (drawn.has(id)) continue;
    if (!liveNow.has(id) && v.put) {
      v.off ??= { from: { x: v.a.x, y: v.a.y, dir: v.a.dir }, to: GATE, at: now };
      v.at = null;
      v.walk = null;
      v.a.carry = false;
      if (walkAt(v.off, STROLL, now).next !== null && now < v.off.at + 4 * GOES_FOR) {
        afoot(v, v.off, "walk");
        continue;
      }
    }
    here.delete(id);
    G.visitors = G.visitors.filter((a) => a !== v.a);
  }
  known = new Set(guild.whereabouts().keys());
}

/** A crate on the ground beside somebody's spot at the Works. */
function crateOf(s: Spot): Standing {
  const c = crateAt(s);
  return { z: s.y - 0.1, paint: (g, cx, cy) => crate(g, c.x - cx, c.y - cy) };
}

/** Crates on the ground and hammers in hand at the Works this moment, to be drawn among the people. */
export const worksTools = (): readonly Standing[] => tools;

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

/**
 * Real members in town for looking at it from outside: where each is drawn and what they are doing,
 * whether they are dozing on a seat (gone) or nodded off in their spot (away), walking, carrying a
 * crate, and the spot they have at one of the games (its place and number), if any.
 */
export function members(): {
  name: string;
  x: number;
  y: number;
  doing: string;
  dozing: boolean;
  nodded: boolean;
  walking: boolean;
  carry: boolean;
  spot: string | null;
}[] {
  return [...here.values()].map((v) => {
    const { a } = v;
    const at = a.seat ?? a;
    return {
      name: a.who.name,
      x: Math.round(at.x),
      y: Math.round(at.y),
      doing: a.doing,
      dozing: a.dozing !== null,
      nodded: a.dozing === null && v.shut !== null && a.body === v.shut,
      walking: a.moving,
      carry: a.carry,
      spot: v.at ? `${v.at.place} ${v.at.n}` : null,
    };
  });
}
