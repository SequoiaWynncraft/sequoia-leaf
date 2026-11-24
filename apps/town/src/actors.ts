/**
 * People: how anyone walks, hops, sits and speaks, and how the town's own (`folk.ts`) are put
 * where Leaf's clock has them (`clock.ts`). A member is drawn from their skin; the town's own from
 * their own sprites.
 */

import { EARTH } from "@sequoia-leaf/kit/palette.ts";
import type { Body } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { dist, pick, type Pt } from "@sequoia-leaf/kit/util.ts";
import { folkAt, roll, type Walk } from "@sequoia-leaf/town/clock.ts";
import { PACE, type Townsperson } from "@sequoia-leaf/town/folk.ts";
import type { Ground } from "@sequoia-leaf/town/map/grid.ts";
import { KEEPERS, TOWN } from "@sequoia-leaf/town/map/map.ts";

import { beside, crowds, type Placed } from "./apart.ts";
import { folkArt } from "./folkart.ts";
import { puff } from "./fx.ts";
import { type Actor, G, type Move, type Seat, SEATS, SEED, type Who } from "./game.ts";
import type { Steer } from "./stage.ts";

export const HOP = 0.3;

const STILL: Move = { kind: "still" };
const NOWHERE: readonly Pt[] = [];

/** The seat somebody's feet are on, the one kept for them, and the way still to walk, from what they are doing. */
const seatOf = (m: Move): Seat | null => (m.kind === "seated" || m.kind === "puppet" ? m.seat : null);
const goalOf = (m: Move): Seat | null => (m.kind === "toSeat" ? m.seat : null);
const pathOf = (m: Move): readonly Pt[] => (m.kind === "walking" || m.kind === "toSeat" ? m.path : NOWHERE);

function blank(who: Who, body: Body | null, x: number, y: number, you: boolean): Actor {
  return {
    id: "",
    who,
    body,
    folk: null,
    lift: 0,
    dozing: null,
    you,
    x,
    y,
    aside: { x: 0, y: 0 },
    dir: 0,
    side: -1,
    speed: you ? 64 : 30 + Math.random() * 10,
    move: STILL,
    get seat() {
      return seatOf(this.move);
    },
    get goal() {
      return goalOf(this.move);
    },
    get path() {
      return pathOf(this.move);
    },
    walked: 0,
    moving: false,
    sat: -9,
    hold: 0,
    hop: 0,
    hops: 0,
    say: "",
    sayFor: 0,
    alpha: 1,
    away: false,
    doing: "walk",
    carry: false,
    greeted: -99,
    named: -99,
  };
}

/** A member: the player, or a real member about the town, drawn from their skin (none: not drawn yet). */
export function makeActor(who: Who, body: Body | null, x: number, y: number, you = false): Actor {
  return blank(who, body, x, y, you);
}

/** One of the town's own, drawn as itself: never with a skin. */
export function makeFolk(t: Townsperson, x: number, y: number): Actor {
  const a = blank({ name: t.name, rank: "", level: 0, voice: t.voice }, null, x, y, false);
  a.folk = { t, art: folkArt(t) };
  a.speed = PACE[t.kind];
  return a;
}

/** How tall a member's figure is drawn standing, or sitting (`seat`) facing `dir`, in the town's pixels: as `bake` poses it. */
export const tallOf = (seat: boolean, dir: number): number => 21 - (seat ? (dir === 0 ? 2 : 5) : 0);

/** How far above where somebody stands their head is, in the town's pixels. */
export function headOf(a: Actor): number {
  if (a.folk) return a.folk.art.tall + a.lift;
  return tallOf(a.seat !== null, a.dir);
}

/** Where somebody's feet are drawn: on their seat or where they stand, and stepped aside from it. */
export function feet(a: Actor): Pt {
  const at = a.seat ?? a;
  return { x: at.x + a.aside.x, y: at.y + a.aside.y };
}

export function onScreen(x: number, y: number, margin = 12): boolean {
  return (
    x > G.cam.x - margin &&
    x < G.cam.x + G.view.w + margin &&
    y > G.cam.y - margin &&
    y < G.cam.y + G.view.h + margin + 20
  );
}

export function say(a: Actor, text: string, secs = 2.8): void {
  a.say = text;
  a.sayFor = secs;
  if (G.home && !a.away && onScreen(a.x, a.y)) sfx.talk(a.who.voice, text.split(" ").length);
}

/**
 * Somebody hops, `times` in a row, the first begun `late` seconds ago: hops timed by Leaf's clock
 * are as far along on a page that plays them a moment after. Hops are not saved up: asked again
 * while still hopping, they finish the hops already owed (or these, if these are more) and stop.
 */
export function hop(a: Actor, times = 1, late = 0): void {
  const done = Math.floor(Math.max(0, late) / HOP);
  if (done >= times) return;
  if (a.hop <= 0) a.hop = (done + 1) * HOP - Math.max(0, late);
  a.hops = Math.max(a.hops, times - 1 - done);
}

export function face(a: Actor, x: number, y: number): void {
  const dx = x - a.x;
  const dy = y - a.y;
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
  a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
  if (Math.abs(dx) > 0.3) a.side = dx < 0 ? -1 : 1;
}

/** Somebody sits down on a seat, which is theirs while they sit; any other they had or were walking to is let go. */
export function sit(a: Actor, seat: Seat): void {
  const m = a.move;
  if ((m.kind === "toSeat" || m.kind === "seated") && m.seat !== seat) m.seat.taken = false;
  seat.taken = true;
  a.move = { kind: "seated", seat };
  a.sat = G.t;
  a.dir = seat.dir;
  if (a.you) sfx.sit();
}

/**
 * Whatever somebody is doing with their feet, they stop and stand where they are: up off a seat
 * (onto the ground before it), a seat kept for them let go, a walk dropped with what was to happen
 * at its end. Somebody put where others say is left as they are.
 */
export function stop(a: Actor): void {
  const m = a.move;
  if (m.kind === "puppet" || m.kind === "still") return;
  if (m.kind === "seated") {
    a.x = m.seat.from.x;
    a.y = m.seat.from.y;
  }
  if (m.kind === "seated" || m.kind === "toSeat") m.seat.taken = false;
  a.move = STILL;
}

/** Somebody put where others say this frame (a live player, a member visiting): on their feet, or on a seat of their own. */
export function putAs(a: Actor, seat: Seat | null): void {
  const m = a.move;
  if (m.kind !== "puppet" || m.seat !== seat) a.move = { kind: "puppet", seat };
}

/** Everybody on each ground, as whoever draws it says: for where a walk there ends. */
const peopleOf = new WeakMap<Ground, () => readonly Actor[]>();
export function peopleOn(ground: Ground, people: () => readonly Actor[]): void {
  peopleOf.set(ground, people);
}

/** Whether somebody is standing or sitting still where they can be seen: not walking, gone or faded out. */
export const isStill = (a: Actor): boolean => !a.away && !a.moving && a.alpha > 0.02;

/** Everybody standing or sitting still on a ground but `a`, where they are drawn, members dozing too. */
function stillOn(ground: Ground, a: Actor | null): Placed[] {
  return (peopleOf.get(ground)?.() ?? []).flatMap((o) =>
    o !== a && isStill(o) ? [{ ...feet(o), tall: headOf(o) }] : [],
  );
}

/**
 * Where a walk to a point ends: there (or the clear ground nearest it), or, with somebody standing
 * or sitting still there, the nearest place to it on top of nobody that is a straight walk from it.
 */
export function stopAt(a: Actor, to: Pt, ground: Ground = TOWN): Pt {
  const at = ground.nearestFree(to.x, to.y);
  return beside({ ...at, tall: headOf(a) }, stillOn(ground, a), (p) => ground.clearLine(at, p));
}

/**
 * Whether a seat is free for `a`: nobody else has it, and nobody but `a` stands or sits where its
 * sitter would be, a member dozing there included: a dozer keeps their seat (`visitors.ts`).
 */
export const seatFree = (s: Seat, a: Actor | null, ground: Ground = TOWN): boolean =>
  (!s.taken || a?.goal === s) &&
  stillOn(ground, a).every((o) => !crowds(o, { x: s.x, y: s.y, tall: tallOf(true, s.dir) }));

/** Whether somebody sits on one of the town's seats: another player's seat is their own, where the town's is. */
export const sitsOn = (a: Actor, s: Seat): boolean => a.seat !== null && dist(a.seat.x, a.seat.y, s.x, s.y) <= 2;

/** The last point of each walk `walkTo` sets out on, looked at again on the way there (`stepActor`). */
const ends = new WeakSet<Pt>();

/** The way someone would walk to a point, round whatever is in the way, to stop there or beside whoever is there (`stopAt`). */
export function wayTo(a: Actor, to: Pt, ground: Ground = TOWN): Pt[] {
  const path = ground.findPath(a, stopAt(a, to, ground), a.you);
  const end = path.at(-1);
  if (end) ends.add(end);
  return path;
}

/** How far somebody still has to walk along their way, in pixels. */
export function walkLeft(a: Actor): number {
  let left = 0;
  let from: Pt = a;
  for (const p of a.path) {
    left += dist(from.x, from.y, p.x, p.y);
    from = p;
  }
  return left;
}

/**
 * Sets someone walking to a point, round whatever is in the way, to stop there or beside whoever
 * is there (`stopAt`, and again on the last stretch); `then` happens when they get there. The ground
 * is the town's unless another is given.
 */
export function walkTo(a: Actor, to: Pt, then: (() => void) | null = null, ground: Ground = TOWN): void {
  stop(a);
  walkAlong(a, wayTo(a, to, ground), then);
}

/** Sets somebody walking a way already worked out, point by point, from whatever they were doing; `then` happens at its end. */
export function walkAlong(a: Actor, path: readonly Pt[], then: (() => void) | null = null): void {
  stop(a);
  if (path.length === 0) {
    then?.();
    return;
  }
  a.move = { kind: "walking", path: [...path], done: then };
}

/**
 * Walks somebody to a seat to sit on it, keeping it for them on the way. If by then somebody stands
 * or sits where they would sit (`seatFree`), they let it go and stay standing where the walk ended.
 * `then` is told the seat they sat on, if any.
 */
export function walkToSeat(
  a: Actor,
  s: Seat,
  then: ((sat: Seat | null) => void) | null = null,
  ground: Ground = TOWN,
): void {
  stop(a);
  s.taken = true;
  a.move = { kind: "toSeat", seat: s, path: wayTo(a, s.from, ground), done: then };
  if (a.path.length === 0) reached(a, ground);
}

/** The end of the way somebody was walking: they stand there, or sit on the seat kept for them if it is still free; then what was to happen does. */
function reached(a: Actor, ground: Ground): void {
  const m = a.move;
  if (m.kind === "walking") {
    a.move = STILL;
    m.done?.();
  } else if (m.kind === "toSeat") {
    const sat = seatFree(m.seat, a, ground) ? m.seat : null;
    if (sat) sit(a, sat);
    else stop(a);
    m.done?.(sat);
  }
}

/**
 * Somebody is hopped over to a point, out of somewhere they were shut in: a walk they were on goes
 * on from there, round whatever is in the way now, to the same end and what was to happen there.
 */
export function hopTo(a: Actor, to: Pt, ground: Ground = TOWN): void {
  a.x = to.x;
  a.y = to.y;
  hop(a);
  const m = a.move;
  if (m.kind !== "walking" && m.kind !== "toSeat") return;
  // The last point of the way on open ground is walked to afresh; what lies past it (off the ground, out past the trail's posts) after.
  const last = m.path.findLastIndex((p) => !ground.footBlocked(p.x, p.y));
  const on = m.path[last];
  if (!on) return;
  m.path.splice(0, last + 1, ...ground.findPath(a, on, a.you));
}

/** A foot coming down: a little dust on the paths, and for the player a soft step. */
export function footfall(a: Actor, before: number, ground: Ground = TOWN): void {
  if (Math.floor(a.walked / 9) === Math.floor(before / 9)) return;
  if (a.you) sfx.step();
  if (ground.pathD(a.x, a.y) < 0 && (a.you || Math.random() < 0.4) && onScreen(a.x, a.y))
    puff(a.x, a.y, 2, EARTH[2], 5);
}

/** What is passing on a figure, whatever puts it where it is: a hop, a line said. */
export function stepPassing(a: Actor, dt: number): void {
  if (a.sayFor > 0) {
    a.sayFor -= dt;
    if (a.sayFor <= 0) a.say = "";
  }
  if (a.hop > 0) {
    a.hop -= dt;
    if (a.hop <= 0 && a.hops > 0) {
      a.hops--;
      a.hop = HOP;
    }
  }
}

/** A moment of anyone's time: finishing a hop, a sentence, a stretch of the way. */
export function stepActor(a: Actor, dt: number, ground: Ground = TOWN): void {
  stepPassing(a, dt);
  a.moving = false;
  if (a.hold > 0) {
    a.hold -= dt;
    return;
  }
  const m = a.move;
  if (m.kind !== "walking" && m.kind !== "toSeat") return;
  const path = m.path;
  let left = a.speed * dt;
  const before = a.walked;
  while (left > 0 && path.length > 0) {
    let p = path[0];
    if (!p) break;
    // The last stretch of a walk: somebody may have stopped where it ends since it set out.
    const q = path.length === 1 && ends.has(p) ? stopAt(a, p, ground) : p;
    if (q.x !== p.x || q.y !== p.y) {
      ends.add(q);
      path[0] = p = q;
    }
    const d = dist(a.x, a.y, p.x, p.y);
    a.moving = true;
    if (d <= left) {
      face(a, p.x, p.y);
      a.x = p.x;
      a.y = p.y;
      a.walked += d;
      left -= d;
      path.shift();
      if (path.length === 0) {
        // Standing still from now on, for whoever looks for a place next.
        a.moving = false;
        reached(a, ground);
        break;
      }
    } else {
      face(a, p.x, p.y);
      a.x += ((p.x - a.x) / d) * left;
      a.y += ((p.y - a.y) / d) * left;
      a.walked += left;
      left = 0;
    }
  }
  if (a.moving) footfall(a, before, ground);
}

/** Which way somebody is being walked by hand, if at all: by the keys, or towards a finger held on the world. */
export function pushOf(a: Actor, steer: Steer): { dx: number; dy: number } | null {
  let { dx, dy } = steer;
  if (dx === 0 && dy === 0 && steer.toward && dist(steer.toward.x, steer.toward.y, a.x, a.y) > 5) {
    dx = steer.toward.x - a.x;
    dy = steer.toward.y - a.y;
  }
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** Walks somebody a moment's worth that way, sliding along whatever is solid. */
export function shove(a: Actor, dt: number, dx: number, dy: number, ground: Ground = TOWN): void {
  const len = Math.hypot(dx, dy);
  const go = a.speed * dt;
  const before = a.walked;
  const nx = a.x + (dx / len) * go;
  const ny = a.y + (dy / len) * go;
  let moved = 0;
  if (!ground.footBlocked(nx, a.y)) {
    moved += Math.abs(nx - a.x);
    a.x = nx;
  }
  if (!ground.footBlocked(a.x, ny)) {
    moved += Math.abs(ny - a.y);
    a.y = ny;
  }
  a.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
  if (moved > 0) {
    a.walked += moved;
    a.moving = true;
    footfall(a, before, ground);
  }
}

// ---------- the town's own, by Leaf's clock ----------

let greetAt = 0;
/** The line the clock last had somebody say, by when it ends; the walk each last arrived by, by when it began; until when a napper is kept awake. */
let said = 0;
const there = new WeakMap<Actor, number>();
const roused = new WeakMap<Actor, number>();

/** The way between two of the town's spots along its paths, worked out once: the points walked through, the first where it starts. */
const ways = new Map<string, readonly Pt[]>();
function wayOf(from: Pt, to: Pt): readonly Pt[] {
  const key = `${from.x},${from.y}>${to.x},${to.y}`;
  const way = ways.get(key) ?? [from, ...TOWN.findPath(from, to, false)];
  ways.set(key, way);
  return way;
}

/** Where somebody `far` pixels along a way is, and the point they are making for: none once they are at its end. */
export function along(way: readonly Pt[], far: number): Pt & { next: Pt | null } {
  let left = Math.max(0, far);
  for (let i = 1; i < way.length; i++) {
    const a = way[i - 1];
    const b = way[i];
    if (!a || !b) break;
    const d = dist(a.x, a.y, b.x, b.y);
    if (left < d) return { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d, next: b };
    left -= d;
  }
  const end = way.at(-1) ?? { x: 0, y: 0 };
  return { x: end.x, y: end.y, next: null };
}

/** Where somebody on a walk is at a moment of Leaf's clock: so far along the way between its two spots, at their pace. */
export const walkAt = (w: Walk, speed: number, at: number): Pt & { next: Pt | null } =>
  along(wayOf(w.from, w.to), (speed * (at - w.at)) / 1000);

/**
 * Puts somebody where a walk has them by Leaf's clock (`G.now`), at their pace: on the way, or at
 * its end, facing as its spot has them (once: they may be turned after). Says whether they are there.
 */
export function onWalk(a: Actor, w: Walk): boolean {
  const p = walkAt(w, a.speed, G.now);
  const before = a.walked;
  a.moving = p.next !== null;
  if (a.moving) a.walked += dist(a.x, a.y, p.x, p.y);
  a.x = p.x;
  a.y = p.y;
  if (p.next) {
    face(a, p.next.x, p.next.y);
    footfall(a, before);
  } else if (there.get(a) !== w.at) {
    there.set(a, w.at);
    a.dir = w.to.dir;
  }
  return !a.moving;
}

/**
 * Puts one of the town's own where Leaf's clock (`G.now`) has it, doing and saying what the clock
 * says (`folkAt`): the same on every page, whenever the page came. Asked again for the same
 * moment, it changes nothing.
 */
export function byClock(a: Actor): void {
  const f = a.folk;
  if (!f) return;
  const now = folkAt(SEED, f.t, G.now);
  if (now.from && now.to) onWalk(a, { from: now.from, to: now.to, at: now.at });
  const up = now.doing === "asleep" && G.t < (roused.get(a) ?? 0);
  a.doing = a.moving ? "walk" : up ? "stall" : now.doing;
  if (!now.say || now.say.until === said) return;
  said = now.say.until;
  if (G.home && !a.say) say(a, now.say.text, (now.say.until - G.now) / 1000);
}

/** Puts one of the town's own at its post: behind its counter or stall, on its stump by the fire, or wherever the clock has it. */
export function placeFolk(a: Actor): void {
  const f = a.folk;
  if (!f) return;
  const job = f.t.job;
  const keep = (at: Pt & { lift: number }): void => {
    a.x = at.x;
    a.y = at.y;
    a.lift = at.lift;
  };
  if (job === "counter") {
    keep(KEEPERS.counter);
  } else if (job === "fire") {
    // On the stump at the fire's west side, leaving the logs to those who sit facing the fire.
    const seat = SEATS.find((s) => s.at === "fire" && s.dir === 2);
    if (seat) {
      sit(a, seat);
      a.x = seat.x;
      a.y = seat.y;
      a.sat = -9;
    }
  } else if (typeof job === "object") {
    // A napper is curled up on the counter: in front of the stall, as high as its top.
    const stall = KEEPERS.stalls[job.stall];
    if (stall) keep(job.naps ? stall.nap : stall.keeper);
    a.dir = 0;
  }
  byClock(a);
}

/** Wakes one of the town's own that is asleep at its post, for a while. */
export function rouse(a: Actor, secs = 8): void {
  if (a.doing === "asleep") roused.set(a, G.t + secs);
}

/** A moment of the town's own: each where the clock has it, with a word for anybody walking by (`walkers`) from whoever is awake. */
export function stepFolk(dt: number, walkers: readonly Actor[]): void {
  for (const a of G.folk) {
    const f = a.folk;
    if (!f || a.away) continue;
    stepActor(a, dt);
    byClock(a);
    const p = walkers.find((w) => w.moving && !w.away && dist(a.x, a.y, w.x, w.y) < 22);
    if (!p || !G.home || a.say || a.doing === "asleep" || G.t <= greetAt || G.t - a.greeted <= 50) continue;
    greetAt = G.t + 5;
    a.greeted = G.t;
    if (!a.moving && !a.seat) face(a, p.x, p.y);
    hop(a);
    // The same word on every page: by the clock, in tens of seconds.
    say(a, pick(f.t.greets, roll(SEED, G.now, Math.floor(G.now / 10_000))), 2);
  }
}

/** The town's own who are about and awake: those who answer a wave or a cheer. */
export function inTown(): Actor[] {
  return G.folk.filter((a) => !a.away && a.doing !== "asleep");
}

/** Everyone about hops, and a few of them say so in their own way: the same few and the same words on every page, by when the cheer is (`at`, Leaf's clock). */
export function cheerAll(at: number): void {
  const about = [...inTown(), ...(G.cinfy ? [G.cinfy] : [])];
  about.forEach((a, i) => {
    hop(a, 2 + (i % 2), (G.now - at) / 1000);
    const cheers = a.folk?.t.cheers;
    if (cheers && (i % 3 === 0 || roll(SEED, at, i) < 0.25)) say(a, pick(cheers, roll(SEED, at, i, 1)), 2.4);
  });
}

/** The fire seat nearest to someone, if one is free. */
export function freeSeat(a: Actor, where: Seat["at"]): Seat | null {
  let best: Seat | null = null;
  for (const s of SEATS) {
    if (!seatFree(s, a) || s.at !== where) continue;
    if (!best || dist(a.x, a.y, s.x, s.y) < dist(a.x, a.y, best.x, best.y)) best = s;
  }
  return best;
}

/**
 * Walks somebody to a seat to sit on it (`walkToSeat`); if somebody is there by then, on to the seat
 * `after` gives, or, with none, they stay standing where the walk ended. `then` is told the seat
 * they sat on, if any.
 */
export function goToSeat(a: Actor, s: Seat, after: () => Seat | null, then?: (sat: Seat | null) => void): void {
  walkToSeat(a, s, (sat) => {
    const other = sat ? null : after();
    if (other) goToSeat(a, other, after, then);
    else then?.(sat);
  });
}

/** Sends the player to a seat if it is free, else the nearest free one of its kind (by the fire, if none is named), to sit down. */
export function goSit(seat: Seat | null): boolean {
  const p = G.player;
  if (!p) return false;
  if (p.seat && (!seat || seat === p.seat)) return true;
  const s = seat && seatFree(seat, p) ? seat : freeSeat(p, seat?.at ?? "fire");
  if (!s) return false;
  goToSeat(p, s, () => freeSeat(p, s.at));
  return true;
}

/** Whoever is sitting somewhere: the member, the town's own, members dozing. */
export function sitters(where: Seat["at"]): Actor[] {
  const all = [...(G.player ? [G.player] : []), ...G.folk, ...G.visitors];
  return all.filter((a) => a.seat?.at === where);
}
