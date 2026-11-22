/**
 * People: how anyone walks, hops, sits and speaks, and how the town's own (`folk.ts`) go about
 * their evening. A member is drawn from their skin; the town's own from their own sprites.
 */

import { EARTH } from "@sequoia-leaf/kit/palette.ts";
import type { Body } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { dist, pick, type Pt } from "@sequoia-leaf/kit/util.ts";

import { type Errand as FolkErrand, ERRAND_LINES, type Townsperson } from "./folk.ts";
import { folkArt } from "./folkart.ts";
import { puff } from "./fx.ts";
import { type Actor, G, type Who } from "./game.ts";
import type { Ground } from "./grid.ts";
import type { Steer } from "./stage.ts";
import { type Seat, SEATS, type Spot, SPOTS, STALL_BEHIND, STALL_FRONT_Y, STALL_TOP_Y, TOWN } from "./world.ts";

export const HOP = 0.3;

function blank(who: Who, body: Body | null, x: number, y: number, you: boolean): Actor {
  return {
    who,
    body,
    folk: null,
    lift: 0,
    dozing: null,
    you,
    x,
    y,
    dir: 0,
    side: -1,
    speed: you ? 64 : 30 + Math.random() * 10,
    path: [],
    arrive: null,
    walked: 0,
    moving: false,
    seat: null,
    goal: null,
    sat: -9,
    hold: 0,
    hop: 0,
    hops: 0,
    say: "",
    sayFor: 0,
    alpha: 1,
    away: false,
    mode: "idle",
    wait: Math.random() * 2,
    spot: null,
    doing: "walk",
    greeted: -99,
    mug: 0,
    named: -99,
  };
}

/** A member: the player, or a real member about the town, drawn from their skin. */
export function makeActor(who: Who, body: Body, x: number, y: number, you = false): Actor {
  return blank(who, body, x, y, you);
}

/** One of the town's own, drawn as itself: never with a skin. */
export function makeFolk(t: Townsperson, x: number, y: number): Actor {
  const a = blank({ name: t.name, rank: "", level: 0, voice: t.voice }, null, x, y, false);
  a.folk = { t, art: folkArt(t) };
  a.speed = t.kind === "gnome" ? 22 : t.kind === "glorp" ? 18 : 26;
  return a;
}

/** How far above where somebody stands their head is, in the town's pixels. */
export function headOf(a: Actor): number {
  if (a.folk) return a.folk.art.tall + a.lift;
  return 21 - (a.seat ? (a.dir === 0 ? 2 : 5) : 0);
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

export function hop(a: Actor, times = 1): void {
  if (a.hop <= 0) {
    a.hop = HOP;
    a.hops += times - 1;
  } else a.hops += times;
}

export function face(a: Actor, x: number, y: number): void {
  const dx = x - a.x;
  const dy = y - a.y;
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
  a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
  if (Math.abs(dx) > 0.3) a.side = dx < 0 ? -1 : 1;
}

export function sit(a: Actor, seat: Seat): void {
  seat.taken = true;
  a.seat = seat;
  a.goal = null;
  a.sat = G.t;
  a.dir = seat.dir;
  a.path = [];
  a.arrive = null;
  if (a.you) sfx.sit();
}

export function stand(a: Actor): void {
  if (!a.seat) return;
  a.x = a.seat.from.x;
  a.y = a.seat.from.y;
  a.seat.taken = false;
  a.seat = null;
}

/** Lets go of whatever spot or seat someone holds, so that somebody else may have it. */
export function release(a: Actor): void {
  if (a.spot) a.spot.taken = false;
  a.spot = null;
  if (a.goal) a.goal.taken = false;
  a.goal = null;
  stand(a);
}

/**
 * Sets someone walking to a point, round whatever is in the way; `then` happens when they get
 * there. The ground is the town's unless another is given.
 */
export function walkTo(a: Actor, to: Pt, then: (() => void) | null = null, ground: Ground = TOWN): void {
  stand(a);
  a.path = ground.findPath(a, to, a.you);
  a.arrive = then;
  if (a.path.length === 0) {
    a.arrive = null;
    then?.();
  }
}

/** A foot coming down: a little dust on the paths, and for the player a soft step. */
export function footfall(a: Actor, before: number, ground: Ground = TOWN): void {
  if (Math.floor(a.walked / 9) === Math.floor(before / 9)) return;
  if (a.you) sfx.step();
  if (ground.pathD(a.x, a.y) < 0 && (a.you || Math.random() < 0.4) && onScreen(a.x, a.y))
    puff(a.x, a.y, 2, EARTH[2], 5);
}

/** A moment of anyone's time: finishing a hop, a sentence, a stretch of the way. */
export function stepActor(a: Actor, dt: number, ground: Ground = TOWN): void {
  if (a.sayFor > 0) {
    a.sayFor -= dt;
    if (a.sayFor <= 0) a.say = "";
  }
  if (a.mug > 0) a.mug -= dt;
  if (a.hop > 0) {
    a.hop -= dt;
    if (a.hop <= 0 && a.hops > 0) {
      a.hops--;
      a.hop = HOP;
    }
  }
  a.moving = false;
  if (a.hold > 0) {
    a.hold -= dt;
    return;
  }
  let left = a.speed * dt;
  const before = a.walked;
  while (left > 0 && a.path.length > 0) {
    const p = a.path[0];
    if (!p) break;
    const d = dist(a.x, a.y, p.x, p.y);
    a.moving = true;
    if (d <= left) {
      face(a, p.x, p.y);
      a.x = p.x;
      a.y = p.y;
      a.walked += d;
      left -= d;
      a.path.shift();
      if (a.path.length === 0) {
        const fn = a.arrive;
        a.arrive = null;
        fn?.();
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

// ---------- the town's own, about their evening ----------

let chatterAt = 4;
let greetAt = 0;

const rnd = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/** A free spot for an errand, kept for whoever takes it. */
function takeSpot(a: Actor, errand: FolkErrand | "works" | "fire"): Spot | null {
  const open = SPOTS.filter((s) => !s.taken && s.errand === errand);
  if (open.length === 0) return null;
  const s = pick(open, Math.random());
  s.taken = true;
  a.spot = s;
  return s;
}

/** Sends one of the town's own to a spot to be busy there for a while. */
function goTo(a: Actor, s: Spot, doing: Actor["doing"], stay: number): void {
  a.mode = "going";
  a.doing = "walk";
  walkTo(a, s, () => {
    a.dir = s.dir;
    a.doing = doing;
    a.mode = "busy";
    a.wait = stay;
  });
}

const ERRANDS: readonly FolkErrand[] = ["crabs", "board", "gate"];
const errandOf = new WeakMap<Actor, number>();

/** What one of the town's own does next, by its job. */
function next(a: Actor): void {
  const f = a.folk;
  if (!f) return;
  release(a);
  const job = f.t.job;
  if (job === "errands") {
    // Round the town: the crabs, the board, the gate, and round again.
    const n = ((errandOf.get(a) ?? -1) + 1) % ERRANDS.length;
    errandOf.set(a, n);
    const errand = ERRANDS[n] ?? "crabs";
    const s = takeSpot(a, errand);
    if (s) goTo(a, s, errand, rnd(9, 15));
    else a.wait = 2;
    return;
  }
  if (job === "between") {
    // The fire, then the Works' door, and back; curled up in the warm for a while at each.
    const to = a.doing === "fire" || a.spot?.errand === "fire" ? "works" : "fire";
    const s = takeSpot(a, to);
    if (s) goTo(a, s, to, rnd(18, 28));
    else a.wait = 3;
    return;
  }
  // Everybody else stays where they are.
  a.mode = "busy";
  a.wait = rnd(8, 14);
}

/** Puts one of the town's own where its evening finds it: behind its counter or stall, by the fire, about its errands. */
export function placeFolk(a: Actor, n: number): void {
  const f = a.folk;
  if (!f) return;
  const job = f.t.job;
  a.mode = "busy";
  a.wait = 3 + n * 1.7;
  if (job === "counter") {
    a.x = 104;
    a.y = 113;
    a.lift = 9;
    a.mode = "led";
    a.doing = "counter";
  } else if (job === "fire") {
    // On a stump at the side, leaving the logs to those who sit facing the fire.
    const seat =
      SEATS.find((s) => s.at === "fire" && !s.taken && !s.yours && (s.dir === 1 || s.dir === 2)) ??
      SEATS.find((s) => s.at === "fire" && !s.taken && !s.yours);
    if (seat) {
      sit(a, seat);
      a.x = seat.x;
      a.y = seat.y;
      a.sat = -9;
    }
    a.doing = "fire";
    a.wait = 1e9;
  } else if (job === "errands" || job === "between") {
    const s = takeSpot(a, job === "errands" ? "crabs" : "fire");
    if (s) {
      a.x = s.x;
      a.y = s.y;
      a.dir = s.dir;
      a.doing = job === "errands" ? "crabs" : "fire";
    }
  } else if (job !== "calls") {
    const at = STALL_BEHIND[job.stall] ?? { x: 108, y: 238 };
    a.x = at.x;
    if (job.naps) {
      // Curled up on the counter: in front of the stall, as high as its top.
      a.y = STALL_FRONT_Y;
      a.lift = STALL_FRONT_Y - STALL_TOP_Y;
      a.doing = "asleep";
    } else {
      a.y = at.y;
      a.lift = 2;
      a.doing = "stall";
    }
    a.dir = 0;
    a.wait = rnd(10, 20);
  }
}

/** What one of the town's own says while busy. */
function chatter(a: Actor): string | null {
  const f = a.folk;
  if (!f) return null;
  if (a.doing === "crabs" || a.doing === "board" || a.doing === "gate")
    return pick(Math.random() < 0.75 ? ERRAND_LINES[a.doing] : f.t.chatter, Math.random());
  return f.t.chatter.length > 0 ? pick(f.t.chatter, Math.random()) : null;
}

/** Wakes one of the town's own that is asleep at its post, for a while. */
export function rouse(a: Actor, secs = 8): void {
  if (a.doing !== "asleep") return;
  a.doing = "stall";
  a.wait = secs;
}

export function stepFolk(dt: number): void {
  const p = G.player;
  for (const a of G.folk) {
    if (a.away) continue;
    stepActor(a, dt);
    const f = a.folk;
    if (!f) continue;
    // A word for the player as they pass, from anybody awake.
    if (
      p &&
      G.home &&
      p.moving &&
      !a.say &&
      a.doing !== "asleep" &&
      G.t > greetAt &&
      G.t - a.greeted > 50 &&
      dist(a.x, a.y, p.x, p.y) < 22 &&
      a.mode !== "led"
    ) {
      greetAt = G.t + 5;
      a.greeted = G.t;
      if (!a.moving && !a.seat) face(a, p.x, p.y);
      hop(a);
      say(a, pick(f.t.greets, Math.random()), 2);
    }
    if (a.mode === "led") continue;
    if (a.mode === "idle") {
      a.wait -= dt;
      if (a.wait <= 0) next(a);
    } else if (a.mode === "busy") {
      a.wait -= dt;
      if (G.home && !a.say && a.doing !== "asleep" && G.t > chatterAt && Math.random() < dt * 0.5) {
        const line = chatter(a);
        if (line) {
          chatterAt = G.t + 2.4 + Math.random() * 3.2;
          say(a, line);
        }
      }
      if (a.wait <= 0) {
        if (typeof f.t.job === "object" && f.t.job.naps) {
          // A cat on a stall: back to sleep, mostly.
          a.doing = a.doing === "asleep" && Math.random() < 0.3 ? "stall" : "asleep";
          a.wait = a.doing === "asleep" ? rnd(14, 26) : rnd(5, 9);
        } else {
          a.mode = "idle";
          a.wait = 0.4 + Math.random() * 1.6;
        }
      }
    }
  }
}

/** Calls one of the town's own over to the fire for a while, if it gets about and there is room: somebody stood a round. */
export function callToFire(a: Actor): boolean {
  const f = a.folk;
  if (!f || a.mode === "led" || a.away || a.spot?.errand === "fire" || a.seat) return false;
  if (f.t.job !== "errands" && f.t.job !== "between") return false;
  release(a);
  const s = takeSpot(a, "fire");
  if (!s) return false;
  goTo(a, s, "fire", rnd(20, 30));
  return true;
}

/** Takes one of the town's own out of its own hands, for something the whole town is doing. */
export function lead(a: Actor): void {
  release(a);
  a.path = [];
  a.arrive = null;
  a.mode = "led";
}

export function letGo(a: Actor): void {
  a.mode = "idle";
  a.wait = 0.6 + Math.random() * 2;
}

/** The town's own who are about and awake: those who answer a wave or a cheer. */
export function inTown(): Actor[] {
  return G.folk.filter((a) => !a.away && a.doing !== "asleep");
}

/** Everyone about hops, and a few of them say so in their own way. */
export function cheerAll(): void {
  const about = [...inTown(), ...(G.cinfy ? [G.cinfy] : [])];
  about.forEach((a, i) => {
    hop(a, 2 + (i % 2));
    const cheers = a.folk?.t.cheers;
    if (cheers && (i % 3 === 0 || Math.random() < 0.25)) say(a, pick(cheers, Math.random()), 2.4);
  });
}

/** The fire seat nearest to someone, if one is free. */
export function freeSeat(a: Actor, where: Seat["at"]): Seat | null {
  let best: Seat | null = null;
  for (const s of SEATS) {
    if (s.taken || s.at !== where) continue;
    if (!best || dist(a.x, a.y, s.x, s.y) < dist(a.x, a.y, best.x, best.y)) best = s;
  }
  return best;
}

/** The point a stall's keeper stands at, for whoever wants it. */
export const stallAt = (n: number): Pt => STALL_BEHIND[n] ?? { x: 108, y: 238 };

/** Sends the player to a seat (the nearest free one by the fire, if none is named) to sit down. */
export function goSit(seat: Seat | null): boolean {
  const p = G.player;
  if (!p) return false;
  if (p.seat && (!seat || seat === p.seat)) return true;
  const s = seat && !seat.taken ? seat : freeSeat(p, seat?.at ?? "fire");
  if (!s) return false;
  release(p);
  s.taken = true;
  p.goal = s;
  walkTo(p, s.from, () => {
    sit(p, s);
  });
  return true;
}

/** Whoever is sitting somewhere: the member, the town's own, members dozing. */
export function sitters(where: Seat["at"]): Actor[] {
  const all = [...(G.player ? [G.player] : []), ...G.folk, ...G.visitors];
  return all.filter((a) => a.seat?.at === where);
}
