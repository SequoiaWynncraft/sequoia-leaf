/**
 * Who lives in a camp: a glorp, a ginger cat, a small white fox with gold antlers. Each wanders
 * about on its own, comes to see whoever is home, and answers when it is touched. They are drawn
 * in their turn among the people and the furniture.
 */

import { CREAM, SKY } from "@sequoia-leaf/kit/palette.ts";
import { type Ctx, dist, type Pt } from "@sequoia-leaf/kit/util.ts";
import type { PetId } from "@sequoia-leaf/town/camp.ts";
import type { Ground } from "@sequoia-leaf/town/map/grid.ts";

import { onScreen } from "./actors.ts";
import type { PetArt } from "./campart.ts";
import { csfx } from "./campsfx.ts";
import { float } from "./fx.ts";
import type { Standing } from "./props.ts";

export interface PetLive extends Standing {
  kind: PetId;
  name: string;
  art: PetArt;
  x: number;
  y: number;
  /** Points still to walk to. */
  path: Pt[];
  state: "sit" | "walk" | "sleep";
  /** Seconds until it thinks of something else to do. */
  wait: number;
  /** Which way it faces: 1 for right. */
  dir: 1 | -1;
  /** Seconds of being pleased left, after a touch. */
  joy: number;
  /** Seconds until it answers a touch aloud again: touches in a row do not pile its sound up. */
  voice: number;
  phase: number;
  alpha: number;
}

/** What each kind is, in a line, for whoever points at one. */
export const PET_ABOUT: Readonly<Record<PetId, string>> = {
  glorp: "A glorp. Round, and pleased to be here.",
  cat: "A cat. Asleep, mostly.",
  fox: "A small white fox. The antlers are real.",
};
/** What the member's own are called. */
export const MY_PETS: Readonly<Record<PetId, string>> = { glorp: "Glape", cat: "Erm", fox: "Snowdrop" };
/** How each sits in a list to choose from. */
export const PET_CHOICE: Readonly<Record<PetId, string>> = {
  glorp: "Round. Wobbles.",
  cat: "Ginger. Naps.",
  fox: "White. Follows you.",
};

const SPEED: Readonly<Record<PetId, number>> = { glorp: 26, cat: 24, fox: 40 };

/** A pet, by the name the member's own of its kind has (`MY_PETS`). */
export function makePet(kind: PetId, art: PetArt, at: Pt): PetLive {
  const p: PetLive = {
    kind,
    name: MY_PETS[kind],
    art,
    x: at.x,
    y: at.y,
    path: [],
    state: "sit",
    wait: 1 + Math.random() * 3,
    dir: Math.random() < 0.5 ? 1 : -1,
    joy: 0,
    voice: 0,
    phase: Math.random() * 6,
    alpha: 1,
    get z(): number {
      return p.y;
    },
    paint(g: Ctx, cx: number, cy: number): void {
      paintPet(g, p, cx, cy);
    },
  };
  return p;
}

/**
 * The pets about a camp as the camp has them (`here`, by id), from those drawn: one no longer there
 * goes, and each who stays is the same one, where it is; one new to it is made by `come` (given its
 * place among `here`) and joins them.
 */
export function keepPets(
  drawn: readonly PetLive[],
  here: readonly PetId[],
  come: (kind: PetId, i: number) => PetLive,
): PetLive[] {
  const staying = drawn.filter((p) => here.includes(p.kind));
  return [...staying, ...here.flatMap((kind, i) => (staying.some((p) => p.kind === kind) ? [] : [come(kind, i)]))];
}

function paintPet(g: Ctx, p: PetLive, cx: number, cy: number): void {
  if (p.alpha <= 0.02) return;
  const a = p.art;
  const glad = p.joy > 0 ? Math.abs(Math.sin(p.joy * 10)) * 4 : 0;
  let pic = a.sit[0];
  let up = glad;
  if (p.kind === "glorp") {
    // A glorp gets about by hopping, squashing as it lands; pleased, it stretches.
    const cyc = Math.sin(p.phase * 7);
    if (p.state === "walk" && cyc > 0) up += Math.sin(cyc * Math.PI * 0.5) * 4;
    if (glad > 1.5 && a.glad) pic = a.glad;
    else if (p.state === "walk" && cyc <= 0) pic = a.walk[0] ?? pic;
    else if (Math.sin(p.phase * 0.9) > 0.985) pic = a.sit[1] ?? pic;
  } else if (p.state === "sleep" && a.sleep) pic = a.sleep;
  else if (p.state === "walk") {
    const step = Math.floor(p.phase * 7) % 2;
    pic = (p.dir > 0 ? a.walkR : a.walk)[step] ?? pic;
  }
  if (!pic) return;
  const x = Math.round(p.x) - cx;
  const y = Math.round(p.y) - cy;
  g.globalAlpha = p.alpha;
  g.fillStyle = "rgba(20,10,28,0.3)";
  g.fillRect(x - 4, y - 1, 8, 2);
  // Sitting, a cat and a fox look the way they last went.
  const flip = p.kind !== "glorp" && p.state === "sit" && p.dir > 0;
  if (flip) {
    g.save();
    g.translate(x * 2, 0);
    g.scale(-1, 1);
    g.drawImage(pic.c, x - (pic.c.width - pic.ax), y - Math.round(up) - pic.ay + 1);
    g.restore();
  } else g.drawImage(pic.c, x - pic.ax, y - Math.round(up) - pic.ay + 1);
  g.globalAlpha = 1;
}

/** What a pet needs to know of the place it is in. */
export interface PetWorld {
  ground: Ground;
  /** Where whoever is home is standing, and where the fire is, if there is one. */
  member: Pt | null;
  fire: Pt | null;
}

function goTo(p: PetLive, to: Pt, w: PetWorld): void {
  const goal = w.ground.nearestFree(to.x, to.y);
  p.path = w.ground.findPath(p, goal, true);
  if (p.path.length > 0) p.state = "walk";
}

/** Sends a pet running to somebody: the member has come home, or somebody is at the gate. */
export function comeTo(p: PetLive, to: Pt, w: PetWorld): void {
  p.wait = 3 + Math.random() * 2;
  goTo(p, { x: to.x + (Math.random() - 0.5) * 22, y: to.y + 6 + Math.random() * 8 }, w);
}

export function stepPet(p: PetLive, dt: number, w: PetWorld): void {
  p.phase += dt;
  p.joy = Math.max(0, p.joy - dt);
  p.voice = Math.max(0, p.voice - dt);
  if (p.state === "sleep") {
    p.wait -= dt;
    if (Math.floor(p.phase / 1.8) !== Math.floor((p.phase - dt) / 1.8) && onScreen(p.x, p.y))
      float(p.x + 5, p.y - 8, "z", CREAM, 1.3);
    if (p.wait <= 0) {
      p.state = "sit";
      p.wait = 2;
    }
    return;
  }
  if (p.state === "walk") {
    // A glorp only moves while it is in the air.
    const going = p.kind !== "glorp" || Math.sin(p.phase * 7) > 0;
    let left = going ? SPEED[p.kind] * dt * (p.kind === "glorp" ? 2 : 1) : 0;
    while (left > 0 && p.path.length > 0) {
      const to = p.path[0];
      if (!to) break;
      const d = dist(p.x, p.y, to.x, to.y);
      if (Math.abs(to.x - p.x) > 0.6) p.dir = to.x > p.x ? 1 : -1;
      if (d <= left) {
        p.x = to.x;
        p.y = to.y;
        left -= d;
        p.path.shift();
      } else {
        p.x += ((to.x - p.x) / d) * left;
        p.y += ((to.y - p.y) / d) * left;
        left = 0;
      }
    }
    if (p.path.length === 0) {
      p.state = "sit";
      p.wait = 1.5 + Math.random() * 4;
    }
    return;
  }
  p.wait -= dt;
  if (p.wait > 0) return;
  const r = Math.random();
  const m = w.member;
  // The fox follows whoever is home; the cat likes the fire, and a nap; the glorp goes where it likes.
  if (p.kind === "fox" && m && dist(p.x, p.y, m.x, m.y) > 26 && r < 0.75)
    goTo(p, { x: m.x + (Math.random() - 0.5) * 26, y: m.y + 4 + Math.random() * 10 }, w);
  else if (p.kind === "cat" && r < 0.3) {
    p.state = "sleep";
    p.wait = 12 + Math.random() * 14;
  } else if (p.kind === "cat" && w.fire && r < 0.6)
    goTo(p, { x: w.fire.x + (Math.random() < 0.5 ? -22 : 22), y: w.fire.y + 12 }, w);
  else if (m && r < 0.25) goTo(p, { x: m.x + (Math.random() - 0.5) * 30, y: m.y + 8 }, w);
  else if (r < 0.8) goTo(p, { x: p.x + (Math.random() - 0.5) * 90, y: p.y + (Math.random() - 0.5) * 60 }, w);
  if (p.state === "sit") p.wait = 1.5 + Math.random() * 3.5;
}

/** The pet under a point, if there is one. */
export function petAt(pets: readonly PetLive[], wx: number, wy: number): PetLive | null {
  for (const p of pets) if (Math.abs(wx - p.x) < 8 && wy > p.y - 12 && wy < p.y + 3) return p;
  return null;
}

/** How each kind answers a touch: its sound, and what it does, said after its name. */
const ANSWERS: Readonly<Record<PetId, { readonly sound: () => void; readonly does: string }>> = {
  cat: { sound: () => csfx.purr(), does: "purrs." },
  fox: { sound: () => csfx.yip(), does: "does a small happy spin." },
  glorp: { sound: () => csfx.blob(), does: "wobbles, delighted." },
};
/** Seconds a pet's answer lasts: as long as its line is up. */
const ANSWER_TIME = 1.8;

/**
 * A pet is touched: it is pleased each time, and answers in its own way, aloud and in a line, unless
 * it is still answering the touch before.
 */
export function pleased(p: PetLive): void {
  p.joy = 1.1;
  if (p.state === "sleep") {
    p.state = "sit";
    p.wait = 3;
  }
  if (p.kind === "fox") p.dir = p.dir > 0 ? -1 : 1;
  float(p.x, p.y - 12, "\u2665", SKY[5], 1.2);
  if (p.voice > 0) return;
  p.voice = ANSWER_TIME;
  ANSWERS[p.kind].sound();
  float(p.x, p.y - 20, `${p.name} ${ANSWERS[p.kind].does}`, CREAM, ANSWER_TIME);
}
