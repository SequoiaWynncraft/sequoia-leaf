/**
 * Real members, and only real members, in their own skins (on the guild's own server; with the
 * made-up guild, its stand-ins):
 *
 * - **Visitors**, in the game just now: standing or strolling where they are (about the town, by
 *   the Works' door, watching at the stump), walking in through the gate when they arrive. They
 *   never speak, and their card has only their name and rank. When a raid party of real members
 *   comes home, its members walk in as visitors too (`figure`).
 * - **Dozers**, gone in the last day and happy to be left in town: each sits at a free seat for
 *   where they were (a log at the fire, the log at the stump, the bench by the Works' door), eyes
 *   closed, a small "z" drifting up. They never speak or move. A visitor who goes sits down where
 *   they are to doze, if they may; a dozer who comes back gets up and is a visitor again.
 *
 * On the guild's own server, whoever is about the town is there live (`players.ts`), where they
 * really are: those the guild says are in town are not visitors here, and nobody live is a visitor
 * or a dozer as well. Those by the Works' door and at the stump still are.
 */

import { where } from "@sequoia-leaf/kit/live.ts";
import { CREAM } from "@sequoia-leaf/kit/palette.ts";
import { bake, type Body, type Look, paintSkin, SIT } from "@sequoia-leaf/kit/skin.ts";
import { makeCanvas, type Pt } from "@sequoia-leaf/kit/util.ts";

import { makeActor, onScreen, release, sit, stand, stepActor, walkTo } from "./actors.ts";
import { float } from "./fx.ts";
import { type Actor, after, G } from "./game.ts";
import { guild, type Person, type Rester, type Visitor } from "./guild.ts";
import { skinOf, VISITORS_MOST } from "./live.ts";
import { nearestFree, place, type Seat, SEATS, SPOTS } from "./world.ts";

/** In and out of town: the gateway, just inside the dark. */
export const GATE: Pt = { x: 256, y: 85 };
const STROLL = 32;
/** The most members drawn dozing at once. */
export const DOZERS_MOST = 12;

interface Visiting {
  a: Actor;
  id: string;
  at: Visitor["at"];
  /** On the way out through the gate. */
  going: boolean;
  /** Only passing through with a raid party: goes again once it is home. */
  passing: boolean;
  /** Asleep at a seat, or on the way to one: gone from the game, left in town. */
  dozing: boolean;
  /** Where their skin sheet is served; empty for a made-up member. */
  skin: string;
  /** When to wander off somewhere else in town, by the town's clock; for a dozer, the next "z". */
  next: number;
}

const here = new Map<string, Visiting>();
let lookIn = 0;

/** Who is in town live, by their account, and their figure: told by `players.ts`; nobody until it does. */
let live: { ids(): ReadonlySet<string>; actor(id: string): Actor | null } = {
  ids: () => new Set(),
  actor: () => null,
};
/** Hears who is in town live, so that nobody is drawn twice. */
export function followLive(l: typeof live): void {
  live = l;
}

/** Who the guild says is in the game, as visitors: on its own server, nobody in town (they are there live) and nobody live. */
function wantedNow(): readonly Visitor[] {
  const now = live.ids();
  const all = guild.visitors();
  if (where().mode !== "live") return all;
  return all.filter((w) => w.at !== "town" && !now.has(w.id));
}
/** Who the guild says has gone and stays, as dozers: never anybody live. */
function restingNow(): readonly Rester[] {
  const now = live.ids();
  return guild.resting().filter((r) => !now.has(r.id));
}

// ---------- how a member looks before their own skin arrives ----------

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

/** A look of their own, always the same for the same name: what a member wears until their skin arrives. */
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

/** Puts a member in their own skin once it has arrived (and keeps their eyes shut if they doze). */
function dress(v: Visiting): void {
  if (!v.skin) return;
  const img = new Image();
  img.addEventListener("load", () => {
    try {
      const body = bake(img);
      v.a.body = v.dozing ? dozy(body) : body;
      awake.set(v.a, body);
    } catch {
      // A picture that cannot be read: the look of their own stays.
    }
  });
  img.src = v.skin;
}
/** Each member's figure with their eyes open, for when a dozer wakes. */
const awake = new WeakMap<Actor, Body>();

// ---------- where they stand, and where they sit ----------

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

/** The seats a dozer may have, by where they were: theirs first, then the fire's logs, then the benches. */
const SEATS_FOR: Readonly<Record<Visitor["at"], readonly Seat["at"][]>> = {
  town: ["fire", "bench", "works"],
  table: ["table", "fire", "bench"],
  works: ["works", "fire", "bench"],
};

/** Seats facing us first, so that whoever dozes there is seen to; then side on; then with their back to us. */
const facing = (s: Seat): number => (s.dir === 0 ? 0 : s.dir === 3 ? 2 : 1);

/** A free seat for somebody dozing off who was last at a place; never one kept for the member. */
export function seatFor(at: Visitor["at"]): Seat | null {
  for (const kind of SEATS_FOR[at]) {
    const s = SEATS.filter((x) => x.at === kind && !x.taken && !x.yours).toSorted((a, b) => facing(a) - facing(b))[0];
    if (s) return s;
  }
  return null;
}

function count(at: Visitor["at"]): number {
  let n = 0;
  for (const v of here.values()) if (v.at === at && !v.going && !v.dozing) n++;
  return n;
}
const dozers = (): number => [...here.values()].filter((v) => v.dozing).length;

// ---------- coming and going ----------

function spawn(id: string, name: string, rank: string | null, at: Visitor["at"], skin: string): Visiting {
  const a = makeActor({ name, rank: rank ?? "", level: 0, voice: 0 }, bake(paintSkin(lookFor(name))), GATE.x, GATE.y);
  a.alpha = 0;
  a.mode = "led";
  a.speed = STROLL;
  a.doing = "walk";
  const v: Visiting = {
    a,
    id,
    at,
    going: false,
    passing: false,
    dozing: false,
    skin,
    next: G.t + 6 + Math.random() * 8,
  };
  here.set(id, v);
  G.visitors.push(a);
  dress(v);
  return v;
}

/** Takes somebody out of town for good, letting go of any seat or spot they held. */
function forget(v: Visiting): void {
  release(v.a);
  here.delete(v.id);
  G.visitors = G.visitors.filter((a) => a !== v.a);
}

function goOut(v: Visiting): void {
  v.going = true;
  release(v.a);
  walkTo(v.a, GATE, () => {
    forget(v);
  });
}

function settle(v: Visiting): void {
  walkTo(v.a, spotFor(v.at, count(v.at)), () => {
    v.a.dir = v.at === "town" ? v.a.dir : 3;
    v.a.doing = v.at === "works" ? "works" : v.at === "table" ? "table" : "walk";
  });
}

/** Sits a member down on a seat, asleep. */
function doze(v: Visiting, s: Seat, seen: number): void {
  const a = v.a;
  v.dozing = true;
  sit(a, s);
  a.dozing = seen;
  a.mode = "led";
  a.doing = "home";
  a.say = "";
  const open = awake.get(a) ?? a.body;
  if (open) {
    awake.set(a, open);
    a.body = dozy(open);
  }
}

/** A dozer who is in the game again: they get up, eyes open, and go where they are. */
function wake(v: Visiting, at: Visitor["at"]): void {
  const a = v.a;
  v.dozing = false;
  a.dozing = null;
  a.body = awake.get(a) ?? a.body;
  stand(a);
  release(a);
  v.at = at;
  settle(v);
}

/** Keeps the visitors and dozers in step with who the guild says is here and who has gone. */
export function stepVisitors(dt: number): void {
  for (const v of here.values()) {
    // Everybody walks, until they are asleep.
    if (v.a.dozing === null) {
      stepActor(v.a, dt);
      continue;
    }
    // A dozer breathes out a "z" now and then.
    if (G.t >= v.next) {
      v.next = G.t + 1.6 + Math.random() * 0.8;
      const at = v.a.seat ?? v.a;
      if (onScreen(at.x, at.y)) float(at.x + 4, at.y - 20, "z", CREAM, 1.4);
    }
  }
  // Anybody drawn here as a visitor or a dozer who is now in town live is drawn by `players.ts`,
  // where they really are: this figure of them goes at once, so that nobody is ever seen twice.
  const liveNow = live.ids();
  for (const v of here.values()) if (!v.passing && liveNow.has(v.id)) forget(v);

  lookIn -= dt;
  if (lookIn > 0) return;
  lookIn = 1;
  const want = wantedNow();
  const rest = restingNow();
  const wantedIds = new Set(want.map((w) => w.id));
  const resting = new Map(rest.map((r) => [r.id, r]));

  for (const v of here.values()) {
    if (v.passing || v.going || wantedIds.has(v.id)) continue;
    const r = resting.get(v.id);
    if (v.dozing) {
      // Gone for more than a day, or would rather not be left: they are simply not here any more.
      if (!r) forget(v);
      continue;
    }
    // Gone: sits down to doze where they were, if they may and there is a seat; else out through the gate.
    const s = r && dozers() < DOZERS_MOST ? seatFor(r.at) : null;
    if (!r || !s) {
      goOut(v);
      continue;
    }
    release(v.a);
    v.a.mode = "led";
    s.taken = true;
    v.a.goal = s;
    walkTo(v.a, s.from, () => {
      doze(v, s, r.seen);
    });
    v.dozing = true;
  }

  for (const w of want) {
    const v = here.get(w.id);
    if (!v) {
      if (here.size - dozers() < VISITORS_MOST) settle(spawn(w.id, w.name, w.rank, w.at, w.skin));
      continue;
    }
    v.a.who = { ...v.a.who, rank: w.rank ?? v.a.who.rank };
    if (v.dozing) wake(v, w.at);
    else if (v.passing) {
      // Came home with a party, and is in the game after all: stays.
      v.passing = false;
      v.at = w.at;
    } else if (v.going || v.at !== w.at) {
      v.going = false;
      v.at = w.at;
      settle(v);
    }
  }

  // Those gone a while already, most recent first, sit where they were from the start.
  for (const r of rest) {
    if (here.has(r.id) || wantedIds.has(r.id) || dozers() >= DOZERS_MOST) continue;
    const s = seatFor(r.at);
    if (!s) continue;
    const v = spawn(r.id, r.name, r.rank, r.at, r.skin);
    v.a.alpha = 1;
    doze(v, s, r.seen);
    v.a.x = s.x;
    v.a.y = s.y;
    v.a.sat = -9;
    v.next = G.t + Math.random() * 2;
  }

  for (const v of here.values()) {
    if (
      v.at !== "town" ||
      v.dozing ||
      v.going ||
      v.passing ||
      v.a.mode !== "led" ||
      v.a.path.length > 0 ||
      G.t < v.next
    )
      continue;
    v.next = G.t + 8 + Math.random() * 12;
    settle(v);
  }
}

/**
 * Another player, live, sits down on a seat: anybody dozing there shuffles over to another free
 * seat for where they were (or, with none, is not drawn), and the seat is kept for the player.
 * Says whether it is theirs now; a seat the member or one of the town's own sits on is not.
 */
export function takeSeat(s: Seat): boolean {
  if (!s.taken) {
    s.taken = true;
    return true;
  }
  const v = [...here.values()].find((x) => x.dozing && x.a.seat === s);
  if (!v) return false;
  stand(v.a);
  s.taken = true;
  const other = seatFor(v.at);
  if (!other) {
    forget(v);
    return true;
  }
  sit(v.a, other);
  v.a.x = other.x;
  v.a.y = other.y;
  v.a.sat = -9;
  return true;
}

/** Whether somebody in town is a real member other than the member themself: visiting, or dozing. */
export const isVisitor = (a: Actor): boolean => G.visitors.includes(a);

/**
 * A real member to take part in one of the guild's moments: the visitor themself if they are in
 * town, or somebody passing in through the gate who goes again when `done` is called. Nobody for
 * somebody dozing in town: they sleep through it.
 */
export function figure(p: Person): Actor | null {
  const had = here.get(p.id);
  // Somebody live is where they really are, and goes nowhere the town leads them.
  if (had?.dozing || live.actor(p.id)) return null;
  const v = had ?? spawn(p.id, p.name, null, "town", where().mode === "live" ? skinOf(p.id) : "");
  if (!ids().has(p.id)) v.passing = true;
  v.going = false;
  release(v.a);
  v.a.mode = "busy";
  return v.a;
}

const ids = (): Set<string> => new Set(wantedNow().map((w) => w.id));

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

/** The visitor somebody is, if they are in town and awake, or their figure if they are there live. */
export function visitorOf(p: Person): Actor | null {
  const v = here.get(p.id);
  return live.actor(p.id) ?? (v && !v.dozing ? v.a : null);
}

/** Real members in town for looking at it from outside: where each is, and whether they are dozing. */
export function members(): { name: string; x: number; y: number; dozing: boolean }[] {
  return [...here.values()].map((v) => {
    const at = v.a.seat ?? v.a;
    return { name: v.a.who.name, x: Math.round(at.x), y: Math.round(at.y), dozing: v.dozing };
  });
}
