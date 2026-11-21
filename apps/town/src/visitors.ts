/**
 * Real members who are in the game just now, as visitors to the town (on the guild's own server):
 * each in their own skin and with their own name, standing or strolling where they are (about the
 * town, by the Works' door, watching at the stump), walking in through the gate when they arrive
 * and out through it when they go. They never speak, and their card has only their name and rank.
 * When a raid party of real members comes home, its members walk in as visitors too (`figure`).
 */

import { bake, type Look, paintSkin } from "@sequoia-leaf/kit/skin.ts";
import type { Pt } from "@sequoia-leaf/kit/util.ts";

import { makeActor, release, stepActor, walkTo } from "./actors.ts";
import { type Actor, after, G } from "./game.ts";
import { guild, type Person, type Visitor } from "./guild.ts";
import { skinOf, VISITORS_MOST } from "./live.ts";
import { nearestFree, place, SPOTS } from "./world.ts";

/** In and out of town: the gateway, just inside the dark. */
export const GATE: Pt = { x: 256, y: 85 };
const STROLL = 32;

interface Visiting {
  a: Actor;
  id: string;
  at: Visitor["at"];
  /** On the way out through the gate. */
  going: boolean;
  /** Only passing through with a raid party: goes again once it is home. */
  passing: boolean;
  /** When to wander off somewhere else in town, by the town's clock. */
  next: number;
}

const here = new Map<string, Visiting>();
let lookIn = 0;

// ---------- how a visitor looks before their own skin arrives ----------

const SKINS = ["#f6dcc2", "#eec39a", "#d9a57c", "#a8714e", "#7a4a30", "#5a3420"] as const;
const HAIR = ["#2b2530", "#6f3826", "#c2382e", "#e0823a", "#f1e2a6", "#3f6fb0", "#4b8c4a", "#e8e4f0"] as const;
const TOPS = ["#b84d84", "#2f8a8a", "#5a296e", "#4b8c4a", "#6f3826", "#3a3340", "#efe2c0", "#243a66"] as const;
const LEGS = ["#3d2050", "#2f5c34", "#593d29", "#2e2e36", "#243a66"] as const;
const STYLES = ["short", "long", "hood", "cap"] as const;

const seedOf = (name: string): number => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};
const from = <T>(list: readonly T[], seed: number, shift: number, or: T): T =>
  list[(seed >>> shift) % list.length] ?? or;

/** A look of their own, always the same for the same name: what a visitor wears until their skin arrives. */
export function lookFor(name: string): Look {
  const s = seedOf(name);
  const hair = from(HAIR, s, 3, "#6f3826");
  return {
    skin: from(SKINS, s, 0, "#eec39a"),
    hair,
    light: hair,
    eye: "#3b1f19",
    top: from(TOPS, s, 7, "#b84d84"),
    legs: from(LEGS, s, 11, "#3d2050"),
    shoes: "#3b1f19",
    style: from(STYLES, s, 14, "short"),
    sleeves: (s >>> 17) % 2 ? "long" : "short",
    trim: "#f5b95e",
  };
}

/** Puts a visitor in their own skin once it has arrived. */
function dress(a: Actor, id: string): void {
  const img = new Image();
  img.addEventListener("load", () => {
    try {
      a.body = bake(img);
    } catch {
      // A picture that cannot be read: the look of their own stays.
    }
  });
  img.src = skinOf(id);
}

// ---------- where they stand ----------

const near = (x: number, y: number): Pt => nearestFree(x, y);

/** Somewhere to stand for a visitor of where they are; `n` spreads several out. */
function spotFor(at: Visitor["at"], n: number): Pt {
  if (at === "works") {
    const s = place("works").stand;
    const off = [
      [-20, 8],
      [20, 8],
      [-32, 14],
      [32, 14],
      [-10, 18],
      [10, 18],
    ][n % 6] ?? [0, 12];
    return near(s.x + (off[0] ?? 0), s.y + (off[1] ?? 0));
  }
  if (at === "table") {
    const free = SPOTS.filter((s) => s.errand === "table" && !s.taken);
    const s = free[n % Math.max(1, free.length)];
    return s ? near(s.x, s.y + 2) : near(430 + (n % 4) * 10, 236);
  }
  // About the town: anywhere on the open ground between the places.
  return near(150 + Math.random() * 230, 140 + Math.random() * 150);
}

function count(at: Visitor["at"]): number {
  let n = 0;
  for (const v of here.values()) if (v.at === at && !v.going) n++;
  return n;
}

// ---------- coming and going ----------

function spawn(id: string, name: string, rank: string | null, at: Visitor["at"]): Visiting {
  const look = lookFor(name);
  const a = makeActor({ name, rank: rank ?? "", level: 0, voice: 0, look }, bake(paintSkin(look)), GATE.x, GATE.y);
  a.alpha = 0;
  a.mode = "led";
  a.speed = STROLL;
  a.doing = "walk";
  dress(a, id);
  const v: Visiting = { a, id, at, going: false, passing: false, next: G.t + 6 + Math.random() * 8 };
  here.set(id, v);
  G.visitors.push(a);
  return v;
}

function goOut(v: Visiting): void {
  v.going = true;
  release(v.a);
  walkTo(v.a, GATE, () => {
    here.delete(v.id);
    G.visitors = G.visitors.filter((a) => a !== v.a);
  });
}

function settle(v: Visiting): void {
  walkTo(v.a, spotFor(v.at, count(v.at)), () => {
    v.a.dir = v.at === "town" ? v.a.dir : 3;
    v.a.doing = v.at === "works" ? "works" : v.at === "table" ? "table" : "walk";
  });
}

/** Keeps the visitors in step with who the guild says is here, and walks them about. */
export function stepVisitors(dt: number): void {
  for (const v of here.values()) stepActor(v.a, dt);
  lookIn -= dt;
  if (lookIn > 0) return;
  lookIn = 1;
  const want = guild.visitors();
  const ids = new Set(want.map((w) => w.id));
  for (const v of here.values()) if (!v.passing && !v.going && !ids.has(v.id)) goOut(v);
  for (const w of want) {
    const v = here.get(w.id);
    if (!v) {
      if (here.size < VISITORS_MOST) settle(spawn(w.id, w.name, w.rank, w.at));
      continue;
    }
    v.a.who = { ...v.a.who, rank: w.rank ?? "" };
    if (v.passing) {
      // Came home with a party, and is in the game after all: stays.
      v.passing = false;
      v.at = w.at;
    } else if (v.going || v.at !== w.at) {
      v.going = false;
      v.at = w.at;
      settle(v);
    }
  }
  for (const v of here.values()) {
    if (v.at !== "town" || v.going || v.passing || v.a.mode !== "led" || v.a.path.length > 0 || G.t < v.next) continue;
    v.next = G.t + 8 + Math.random() * 12;
    settle(v);
  }
}

/** Whether somebody in town is a visitor. */
export const isVisitor = (a: Actor): boolean => G.visitors.includes(a);

/**
 * A real member to take part in one of the guild's moments: the visitor themself if they are in
 * town, or somebody passing in through the gate who goes again when `done` is called.
 */
export function figure(p: Person): Actor {
  const v = here.get(p.id) ?? spawn(p.id, p.name, null, "town");
  if (!ids().has(p.id)) v.passing = true;
  v.going = false;
  release(v.a);
  v.a.mode = "busy";
  return v.a;
}

const ids = (): Set<string> => new Set(guild.visitors().map((w) => w.id));

/** The moment is over: a visitor goes back to where they were, and somebody passing goes again. */
export function done(a: Actor): void {
  const v = [...here.values()].find((x) => x.a === a);
  if (!v) return;
  a.mode = "led";
  // Somebody passing stays a moment to be cheered, and then goes.
  if (v.passing)
    after(3 + Math.random() * 3, () => {
      if (v.passing) goOut(v);
    });
  else settle(v);
}

/** The visitor somebody is, if they are in town. */
export const visitorOf = (p: Person): Actor | null => here.get(p.id)?.a ?? null;
