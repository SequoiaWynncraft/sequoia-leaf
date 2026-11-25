/**
 * Real members, and only real members, in their own skins, each where Leaf's list and Leaf's clock
 * have them (the rules are `@sequoia-leaf/town/clock.ts`), so the same on every page. Nobody here
 * walks: only those who move their own figure (the member, the players live in town) and the town's
 * own do. Somebody comes by fading in where they are put, goes by fading out where they are, and is
 * put somewhere else by fading out there and in at the new place (`FADE`).
 *
 * - **Visitors**, in one of the games just now, busy at it in place, each at a spot of their own
 *   (`spots.ts`): at the Works working at a crate beside them, at the raid table sitting on the
 *   stump's free log over its board or standing round it, in the Grove standing before its stone
 *   while a light rises from it now and then.
 *   Away (Leaf's rule) they have sat down in their spot and nodded off: eyes closed, a "z" now and
 *   then. They never speak, and their card has their name and rank, and what they are about.
 * - **Dozers**, gone in the last day and happy to be left in town: each on a seat for where they
 *   were (`dozing`), eyes closed, a small "z" drifting up. They never speak or move. Whoever goes
 *   from a game stays on their feet in their spot until `SITS_AFTER` after Leaf last saw them, and is
 *   then on their seat, or gone if they do not stay or no seat is left. Nobody awake sits down on a
 *   dozer (`seatFree`), so a dozer keeps their seat while somebody sits down anywhere else; but
 *   somebody at the raid table has the stump's free log before a dozer does.
 *
 * A raid party home is cheered where its members are (`events.ts`): nobody is drawn for it.
 * Whoever is about the town is there live (`players.ts`), where they really are, and nobody live is
 * drawn here as well.
 */

import { away } from "@sequoia-leaf/core";
import { BARK, CREAM, LEAF, PAPER, STONE } from "@sequoia-leaf/kit/palette.ts";
import { R } from "@sequoia-leaf/kit/pix.ts";
import { bake, type Body, lookFor, paintSkin, SIT, skinOf } from "@sequoia-leaf/kit/skin.ts";
import { type Ctx, makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";
import { dozing, SITS_AFTER, zAt } from "@sequoia-leaf/town/clock.ts";
import { piece, type Spot, TOWN } from "@sequoia-leaf/town/map/map.ts";
import type { Stand } from "@sequoia-leaf/town/map/rows.ts";

import { feet, makeActor, onScreen, putAs, sitsOn, stepPassing } from "./actors.ts";
import { bit, float } from "./fx.ts";
import { type Actor, G, type Seat, SEATS, SEED } from "./game.ts";
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
  sits,
  strings,
} from "./spots.ts";
import { props } from "./town.ts";

/** How long somebody takes to fade in or out, in seconds. */
export const FADE = 0.5;

/** Where somebody drawn here is put: busy in their spot at one of the games (its number there), or dozing on a seat. */
type Put = { at: Stand; n: number; spot: Spot } | { seat: Seat };

/** Whether two puts are the same place. */
const samePut = (a: Put, b: Put): boolean =>
  "seat" in a ? "seat" in b && a.seat === b.seat : !("seat" in b) && a.at === b.at && a.n === b.n;

/**
 * Somebody drawn here: their figure, eyes open (a look of their own until their skin arrives) and
 * shut, the "z" they last breathed, a seat of their own for sitting in their spot (at the stump, or
 * nodded off), where they are put, the last blow of their hammer, and what of theirs stands on the
 * ground there (a crate, a hammer), kept while they fade out.
 */
interface Visiting {
  a: Actor;
  open: Body;
  shut: Body | null;
  z: number;
  seat: Seat;
  put: Put;
  blow: number;
  kit: Standing[];
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

/** Somebody's figure here, made (and their skin asked for) the first time they are put anywhere: faded out, to fade in. */
function figure(p: { id: string; name: string; rank?: string | null }, put: Put): Visiting {
  const had = here.get(p.id);
  if (had) {
    if (p.rank) had.a.who = { ...had.a.who, rank: p.rank };
    return had;
  }
  const a = makeActor({ name: p.name, rank: p.rank ?? "", level: 0, voice: 0 }, null, 0, 0);
  a.id = p.id;
  a.alpha = 0;
  const v: Visiting = {
    a,
    open: bake(paintSkin(lookFor(p.name))),
    shut: null,
    z: 0,
    seat: { x: 0, y: 0, dir: 0, from: { x: 0, y: 0 }, at: "table", taken: false },
    put,
    blow: 0,
    kit: [],
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

/** Sitting where they are, on a seat of their own there (`v.seat`), facing as `at` does. */
function sitAt(v: Visiting, at: Spot): void {
  const a = v.a;
  const s = v.seat;
  if (a.seat !== s || s.x !== at.x || s.y !== at.y || s.dir !== at.dir) {
    Object.assign(s, { x: at.x, y: at.y, dir: at.dir, from: { x: at.x, y: at.y } });
    a.sat = -9;
  }
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
  if (a.alpha > 0.5 && onScreen(at.x, at.y)) float(at.x + 4, at.y - 20, "z", CREAM, 1.4);
}

/** Away from the keys, though still in the game: sat down in their spot, facing as `at` says (`poseAt`), nodded off. */
function nap(v: Visiting, at: Spot): void {
  sitAt(v, at);
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
  const stone = piece("grove");
  if (!onScreen(stone.x, stone.y)) return;
  bit({ x: stone.x - 2 + (k % 5), y: stone.y - 10, vx: 0, vy: -9, drag: 0.3, ttl: 1.9, col: LEAF, glow: true });
}

/** Asleep on a seat since the game last saw them (`seen`): eyes closed, a "z" now and then; sitting already, never seen to sit down. */
function asleep(v: Visiting, s: Seat, seen: number): void {
  const a = v.a;
  if (a.seat !== s) a.sat = -9;
  putAs(a, s);
  a.x = s.from.x;
  a.y = s.from.y;
  a.dir = s.dir;
  a.moving = false;
  a.dozing = seen;
  a.doing = "home";
  a.carry = false;
  a.body = v.shut ??= dozy(v.open);
  breathe(v);
}

// ---------- the spots ----------

/** The town's seat at a point, if one is: a spot at the stump that is one of its logs. */
const seatAt = (p: Pt): Seat | undefined => SEATS.find((s) => s.x === p.x && s.y === p.y);

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
function work(v: Visiting, n: number, s: Spot, w: NonNullable<ReturnType<typeof poseAt>["work"]>): void {
  standAt(v, s, w.dir);
  v.a.carry = w.held;
  if (!w.held) v.kit.push(crateOf(s));
  if (w.hammer) {
    const up = w.hammer === "up";
    const a = v.a;
    v.kit.push({
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
    if (!first && !w.held && v.a.alpha > 0.5 && onScreen(s.x, s.y))
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

/** Somebody busy at a place in their spot, as `poseAt` has them by Leaf's clock: at work, sitting at the stump, standing at the stone, or nodded off there if they are away. */
function busy(v: Visiting, at: Stand, got: { spot: Spot; n: number }, isAway: boolean): void {
  const pose = poseAt({ id: v.a.id, at, spot: got.spot, n: got.n, away: isAway, now: G.now });
  v.a.carry = false;
  if (pose.dozing) {
    nap(v, { ...got.spot, dir: pose.dir });
    if (at === "works") v.kit.push(crateOf(got.spot));
  } else {
    v.a.body = v.open;
    if (pose.work) work(v, got.n, got.spot, pose.work);
    else if (pose.seated) sitAt(v, got.spot);
    else standAt(v, got.spot, pose.dir);
  }
  v.a.doing = at;
}

/** Somebody gone from a game, not yet dozing or gone: still on their log at the stump, else on their feet in their spot, their crate by them at the Works. */
function lingers(v: Visiting, at: Stand, got: { spot: Spot; n: number }): void {
  const s = got.spot;
  if (sits(at, got.n)) sitAt(v, s);
  else standAt(v, s, s.dir);
  v.a.carry = false;
  v.a.doing = at;
  if (at === "works") v.kit.push(crateOf(s));
}

/** Somebody to draw this moment: who, where they are put, and how they are there. */
interface Wanted {
  who: { id: string; name: string; rank?: string | null };
  put: Put;
  pose: (v: Visiting) => void;
}

/**
 * Puts every visitor and dozer where Leaf's list and Leaf's clock (`G.now`) have them, `dt` seconds
 * on for their hops and fades. `awake` is everybody else who may be sitting on one of the town's
 * seats (the member, the town's own, the other players): a seat one of them sits on, or one kept
 * for somebody on the way to it, is passed over as dozers are given theirs (`dozing`). Whoever is put where they were last fades in there; whoever
 * is put somewhere else, or nowhere, fades out where they are first, and is then put there, or
 * taken away.
 */
export function stepVisitors(dt: number, awake: readonly Actor[]): void {
  const now = G.now;
  tools = [];
  for (const v of here.values()) stepPassing(v.a, dt);
  const liveNow = live.ids();
  const wanted = new Map<string, Wanted>();

  const visitors = guild.visitors().filter((w) => !liveNow.has(w.id));
  const resting = guild.resting().filter((r) => !liveNow.has(r.id));
  // Who has which spot at each place: those busy there, and those gone from it still there. Nobody
  // new is given a log somebody awake sits on or has set off for.
  const held = (p: Pt): boolean => {
    const seat = seatAt(p);
    return seat !== undefined && (seat.taken || awake.some((a) => sitsOn(a, seat)));
  };
  const placed = new Map(
    STANDS.map((at) => [
      at,
      spots.place(
        at,
        [
          ...visitors.filter((w) => w.at === at).map((w) => w.id),
          ...resting.filter((r) => r.at === at && now < r.seen + SITS_AFTER).map((r) => r.id),
        ],
        held,
      ),
    ]),
  );
  // The seats somebody at a game sits on, which nobody dozes on.
  const sat = [...placed].flatMap(([at, got]) => [...got.values()].filter((g) => sits(at, g.n)).map((g) => g.spot));

  let atStone = false;
  for (const w of visitors) {
    const got = placed.get(w.at)?.get(w.id);
    if (!got) continue;
    const isAway = away(w.acted, now);
    wanted.set(w.id, { who: w, put: { at: w.at, ...got }, pose: (v) => busy(v, w.at, got, isAway) });
    if (w.at === "grove") atStone = true;
  }
  if (atStone) stoneLight();

  // Not a seat somebody here sits on or is on the way to (`taken`), one a player live in town sits
  // on, nor one somebody at a game sits on.
  const seats = dozing(
    resting.filter((r) => r.stays),
    SEATS.filter((s) => !s.taken && awake.every((a) => !sitsOn(a, s)) && sat.every((p) => seatAt(p) !== s)),
  );
  for (const r of resting) {
    const at = r.at;
    if (now < r.seen + SITS_AFTER) {
      // Gone, and not yet dozing: on their feet in their spot. Whoever was about the town was there live, and is next seen on their seat.
      const got = at === "town" ? undefined : placed.get(at)?.get(r.id);
      if (at !== "town" && got) wanted.set(r.id, { who: r, put: { at, ...got }, pose: (v) => lingers(v, at, got) });
      continue;
    }
    const seat = seats.get(r.id);
    if (seat) wanted.set(r.id, { who: r, put: { seat }, pose: (v) => asleep(v, seat, r.seen) });
  }

  const by = dt / FADE;
  for (const [id, w] of wanted) if (!here.has(id)) figure(w.who, w.put);
  for (const [id, v] of here) {
    const w = wanted.get(id);
    if (w && samePut(v.put, w.put)) {
      figure(w.who, w.put);
      v.a.alpha = Math.min(1, v.a.alpha + by);
      v.kit = [];
      w.pose(v);
      tools.push(...v.kit);
      continue;
    }
    // Wanted somewhere else, or nowhere: out where they are first, as they were.
    v.a.alpha = Math.max(0, v.a.alpha - by);
    tools.push(...v.kit);
    if (v.a.alpha > 0) continue;
    if (w) {
      v.put = w.put;
      v.kit = [];
      w.pose(v);
      continue;
    }
    here.delete(id);
    G.visitors = G.visitors.filter((a) => a !== v.a);
  }
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
 * whether they are dozing on a seat (gone) or nodded off in their spot (away), moving (never: only
 * those live in town walk), carrying a crate, how far faded in, and the spot they have at one of the
 * games (its place and number) or their seat.
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
  alpha: number;
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
      alpha: Math.round(a.alpha * 100) / 100,
      spot: "seat" in v.put ? `seat ${v.put.seat.at} ${SEATS.indexOf(v.put.seat)}` : `${v.put.at} ${v.put.n}`,
    };
  });
}
