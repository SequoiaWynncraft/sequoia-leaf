/** People: how anyone walks, hops, sits and speaks, and how guild-mates decide what to do next. */

import { EARTH } from "@sequoia-leaf/kit/palette.ts";
import type { Body } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { dist, pick, type Pt } from "@sequoia-leaf/kit/util.ts";

import { CHEERS, GREETS, LINES } from "./cast.ts";
import { puff } from "./fx.ts";
import { type Actor, G } from "./game.ts";
import { guild, type Member } from "./guild.ts";
import { findPath, pathD, type Seat, SEATS, SPOTS } from "./world.ts";

export const HOP = 0.3;

export function makeActor(who: Member, body: Body, x: number, y: number, you = false): Actor {
  return {
    who,
    body,
    you,
    x,
    y,
    dir: 0,
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
  };
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

/** Sets someone walking to a point, round whatever is in the way; `then` happens when they get there. */
export function walkTo(a: Actor, to: Pt, then: (() => void) | null = null): void {
  stand(a);
  a.path = findPath(a, to, a.you);
  a.arrive = then;
  if (a.path.length === 0) {
    a.arrive = null;
    then?.();
  }
}

/** A foot coming down: a little dust on the paths, and for the player a soft step. */
export function footfall(a: Actor, before: number): void {
  if (Math.floor(a.walked / 9) === Math.floor(before / 9)) return;
  if (a.you) sfx.step();
  if (pathD(a.x, a.y) < 0 && (a.you || Math.random() < 0.4) && onScreen(a.x, a.y)) puff(a.x, a.y, 2, EARTH[2], 5);
}

/** A moment of anyone's time: finishing a hop, a sentence, a stretch of the way. */
export function stepActor(a: Actor, dt: number): void {
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
  if (a.moving) footfall(a, before);
}

// ---------- guild-mates, minding their own business ----------

let chatterAt = 4;
let greetAt = 0;

/** A guild-mate goes off to do the next thing the guild says they are doing, wherever there is room for it. */
function choose(a: Actor): void {
  release(a);
  const want = guild.doing(a.who.name);
  const where = want === "fire" || want === "bench" ? want : want === "play" ? "table" : null;
  const seats = SEATS.filter((s) => !s.taken && !s.yours && s.at === where);
  if (where && seats.length > 0) {
    const seat = pick(seats, Math.random());
    a.mode = "going";
    a.doing = "walk";
    seat.taken = true;
    a.goal = seat;
    walkTo(a, seat.from, () => {
      sit(a, seat);
      a.doing = seat.at === "table" ? "play" : seat.at;
      a.mode = "busy";
      a.wait = 14 + Math.random() * 18;
    });
    return;
  }
  // No room there (or nowhere to sit): somewhere else to stand and be busy instead.
  const open = SPOTS.filter((s) => !s.taken && s.errand !== "gate");
  const wanted = open.filter((s) => s.errand === want);
  const spots = wanted.length > 0 ? wanted : open;
  if (spots.length === 0) {
    a.wait = 2;
    return;
  }
  const s = pick(spots, Math.random());
  s.taken = true;
  a.spot = s;
  a.mode = "going";
  a.doing = "walk";
  walkTo(a, s, () => {
    a.dir = s.dir;
    a.doing = s.errand;
    a.mode = "busy";
    a.wait = 5 + Math.random() * 9;
  });
}

function chatter(a: Actor): string {
  if (a.who.name === "Sootpaw" && Math.random() < 0.3) return "meow";
  const own = a.doing === "walk" || a.doing === "raid" ? LINES.any : LINES[a.doing];
  return pick(Math.random() < 0.72 ? own : LINES.any, Math.random());
}

export function stepMates(dt: number): void {
  const p = G.player;
  for (const a of G.mates) {
    if (a.away) continue;
    stepActor(a, dt);
    // A word for the player as they pass.
    if (
      p &&
      G.home &&
      p.moving &&
      !a.say &&
      G.t > greetAt &&
      G.t - a.greeted > 50 &&
      dist(a.x, a.y, p.x, p.y) < 22 &&
      a.mode !== "led"
    ) {
      greetAt = G.t + 5;
      a.greeted = G.t;
      if (!a.moving && !a.seat) face(a, p.x, p.y);
      hop(a);
      say(a, pick(GREETS, Math.random()), 2);
    }
    if (a.mode === "led") continue;
    if (a.mode === "idle") {
      a.wait -= dt;
      if (a.wait <= 0) choose(a);
    } else if (a.mode === "busy") {
      a.wait -= dt;
      if (G.home && !a.say && G.t > chatterAt && Math.random() < dt * 0.6) {
        chatterAt = G.t + 2.4 + Math.random() * 3.2;
        say(a, chatter(a));
      }
      if (a.wait <= 0) {
        a.mode = "idle";
        a.wait = 0.4 + Math.random() * 1.6;
      }
    }
  }
}

/** Sends a guild-mate to the fire, if there is a seat: someone has called them over. */
export function callToFire(a: Actor): boolean {
  if (a.seat?.at === "fire" || a.mode === "led" || a.away) return false;
  const seat = freeSeat(a, "fire");
  if (!seat) return false;
  release(a);
  a.mode = "going";
  a.doing = "walk";
  seat.taken = true;
  a.goal = seat;
  walkTo(a, seat.from, () => {
    sit(a, seat);
    a.doing = "fire";
    a.mode = "busy";
    a.wait = 20 + Math.random() * 10;
  });
  return true;
}

/** Takes a guild-mate out of their own hands, for something the whole guild is doing. */
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

export function inTown(): Actor[] {
  return G.mates.filter((a) => !a.away);
}

/** Everyone about hops, and a few of them say so. */
export function cheerAll(lines: readonly string[] = CHEERS): void {
  const about = inTown();
  about.forEach((a, i) => {
    hop(a, 2 + (i % 2));
    if (i % 3 === 0 || Math.random() < 0.25) say(a, pick(lines, Math.random()), 2.4);
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

export function sitters(where: Seat["at"]): Actor[] {
  const all = G.player ? [G.player, ...G.mates] : G.mates;
  return all.filter((a) => a.seat?.at === where);
}
