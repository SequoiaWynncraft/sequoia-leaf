/**
 * Everything the town's furniture does: what each thing does when it is touched, and the parts that
 * never keep still (the fire, the belt, the banner, the lanterns, the crabs). What stands where, and
 * how all of it is drawn, is `townart.ts`.
 */

import { DAILY_CHEST, type Thing } from "@sequoia-leaf/core";
import { BARK, CREAM, EARTH, GOLD, GREEN, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { hush, noise, sfx, tone } from "@sequoia-leaf/kit/sound.ts";
import { clamp, dist, type Pt, rng } from "@sequoia-leaf/kit/util.ts";
import { bannerAt, boardAt, crabAt as crabByClock, hiding, HOME, stretchOf } from "@sequoia-leaf/town/clock.ts";

import { goSit, onScreen, sitsOn } from "./actors.ts";
import { csfx } from "./campsfx.ts";
import { bit, burst, float, flutter, puff, ring, sparkle } from "./fx.ts";
import { type Actor, G, hooks, SEED, today } from "./game.ts";
import { ask, doNow, ok, town } from "./leaf.ts";
import { type Light, makeProp, type Prop, propUnder } from "./props.ts";
import type { Sprite } from "./sprites.ts";
import { type Strand, STRINGS, wire } from "./strings.ts";
import { hedgeY, place, type PlaceId, pondD, SEATS } from "./world.ts";

export const props: Prop[] = [];
export const lights: Light[] = [];

export const random = rng(20261120);

export function add(kind: Thing, sprite: Sprite | null, x: number, y: number, o: Partial<Prop> = {}): Prop {
  const p = makeProp(kind, sprite, x, y, o);
  props.push(p);
  return p;
}

export function light(x: number, y: number, r: number, power = 1): Light {
  const l = { x, y, r, power, boost: 0, phase: random() * 6.28 };
  lights.push(l);
  return l;
}

// ---------- the parts that move ----------

/** The lights over the Works' door and the stump, which glow up as the door opens and the lantern burns: found as the town is built (`townart.ts`). */
export const doorLights: { door: Light | null; table: Light | null } = { door: null, table: null };

export const fire = { x: 256, y: 212, boost: 0 };
export const fireLight: Light = { x: 256, y: 206, r: 64, power: 1, boost: 0, phase: 0 };

export const belt = {
  off: 0,
  boost: 0,
  /** How far along each crate is, in pixels. */
  crates: [8, 30],
  next: 3,
  /** A crate in the air between the belt's end and the pile. */
  fly: -1,
  fresh: 2,
};

export const BANNERS: readonly (readonly [string, string])[] = [
  [SKY[4], "#9c3f73"],
  [WATER[2], WATER[1]],
  [SKY[3], SKY[2]],
  [GREEN[3], GREEN[2]],
];

export const banner = { x: 300, y: 152, flutter: 0 };

/**
 * The banner by Leaf's clock (`now`): whose it is, how far up the pole and when it is at the top
 * (`bannerAt`, from the guild's wars), null before any.
 */
export const flown = (now = G.now): ReturnType<typeof bannerAt> =>
  bannerAt(
    hooks
      .deeds()
      .moments.flatMap((m) =>
        m.kind === "war" ? [{ land: m.what || "new ground", happened: m.happened, at: m.at }] : [],
      ),
    now,
  );

/** The lantern tree, and where in it a lantern hangs, from the middle of its foot. */
export const tree = { x: 352, y: 200, shakeAt: -9 };
export const SLOTS: readonly Pt[] = [
  { x: -20, y: -37 },
  { x: -12, y: -31 },
  { x: -4, y: -27 },
  { x: 6, y: -26 },
  { x: 14, y: -29 },
  { x: 22, y: -35 },
  { x: -27, y: -45 },
];
/** How long a lantern takes up into the tree, and how long one let go is seen drifting away, in milliseconds. */
export const RISE = 900;
export const DRIFT = 9000;

/** The lanterns by Leaf's clock: one for each raid today, each hung `HOME.hang` after its party began. */
const raised = (): ReturnType<typeof today> => today("party", HOME.hang);

/**
 * The lanterns hanging, as many as the tree has places for, the newest: each in the next place
 * round the tree by its number in the day (`n`), with when it went up (0 for one from before the
 * page). One that took an older one's place has let that one go.
 */
export function lanterns(): { n: number; at: Pt; hung: number }[] {
  const { n: all, at: ups } = raised();
  return SLOTS.flatMap((_, k) => {
    const n = all - Math.min(all, SLOTS.length) + k;
    const at = SLOTS[n % SLOTS.length];
    return at && n < all ? [{ n, at, hung: ups[n - (all - ups.length)] ?? 0 }] : [];
  });
}

export const chest = { openUntil: 0 };

/** The Works' doorway: how far its inner doors stand open, and how far they are meant to. */
export const door = { open: 0, goal: 0 };

/**
 * The board on the great stump. While somebody is at it (`played`) its carved figures are where
 * Leaf's clock has them (`boardAt`); with nobody, set out. `jumpAt` is when they last all jumped
 * for a knock (the town's clock), `moved` the move last heard, and `lit` rises when the member
 * sits down to play.
 */
export const table = { x: 444, y: 200, played: false, jumpAt: -9, moved: 0, lit: 0, goal: 0 };

export interface Crab {
  n: number;
  /** Its home, and where it is drawn. */
  hx: number;
  hy: number;
  x: number;
  y: number;
  /** Shying from somebody's feet: how far from where the clock has it it is drawn, where it shies to, and until when (the town's clock). */
  aside: number;
  shyTo: number;
  shyUntil: number;
  moving: boolean;
  hop: number;
  clack: number;
  /** The one that is never at roll call: it hides about the town, and bolts when found. */
  lost: boolean;
  /** How many seconds it has been running off; 0 while it is not. */
  bolt: number;
  z: number;
  /** Up on a rock: it never gets its feet wet. */
  perched: boolean;
}

export const crabs: Crab[] = [];
/** How fast a crab goes, in pixels a second; and for how many seconds one running off is seen. */
const SCUTTLE = 12;
export const BOLT = 1.2;
/** The missing crab was scared off: in which stretch of its hiding, and when by Leaf's clock. */
let scared: { stretch: number; at: number } | null = null;

/** Where each crab lives: x, y, and whether that is on top of a rock out in the water. */
export const CRAB_HOMES: readonly (readonly [number, number, number])[] = [
  [352, 285, 0],
  [384, 266, 0],
  [424, 261, 0],
  [460, 285, 0],
  [446, 314, 0],
  [396, 328, 0],
  [404, 292, 1],
  [432, 284, 1],
];

const QUIPS = [
  "You almost had it.",
  "It was right there.",
  "It looked you in the eye.",
  "Gone again. Classic 7.",
  "It waved. Rudely.",
  "So close.",
];

interface Glint {
  x: number;
  y: number;
  ph: number;
}
export const glints: Glint[] = [];

interface Str {
  wire: Pt[];
  bulbs: { x: number; y: number; c: number }[];
  chase: number;
}
export const BULBS = [GOLD[2], SKY[5], CREAM, SKY[4]] as const;

/** A string of lights, with a bulb on every seventh pixel of its wire from the fourth. */
function strung(s: Strand): Str {
  const w = wire(s);
  const bulbs = w.filter((_, i) => i % 7 === 3).map((p, k) => ({ x: p.x, y: p.y + 1, c: k % BULBS.length }));
  return { wire: w, bulbs, chase: -9 };
}
/** The strings of lights, slung between the shops, the gate, the posts and the great trunks. */
export const strings: Str[] = STRINGS.map(strung);

// ---------- what touching things does ----------

export const tipOf = (id: PlaceId): readonly [string, string] => [place(id).name, place(id).about ?? ""];

const mid = (p: Prop): Pt => ({ x: p.x, y: p.y - (p.sprite ? p.sprite.c.height * 0.55 : 5) });

export function nudge(p: Prop): void {
  p.bumpAt = G.t;
}

export function tapLeafy(p: Prop): void {
  nudge(p);
  const m = mid(p);
  flutter(m.x, m.y, 6, [GREEN[3], GREEN[4], GREEN[2]], 6, 26);
  sfx.rustle();
  if (Math.random() < 0.35)
    for (let i = 0; i < 3; i++)
      bit({
        x: m.x,
        y: m.y,
        vx: (Math.random() - 0.5) * 20,
        vy: -8 - Math.random() * 12,
        ttl: 2.5 + Math.random() * 2,
        col: GOLD[2],
        glow: true,
        flutter: 2,
      });
}

export function tapFlower(p: Prop, col: string): void {
  nudge(p);
  flutter(p.x, p.y - 5, 4, [col, col, CREAM], 3, 30);
  sfx.pluck(Math.floor(p.x / 23) % 10);
}

export function tapMushroom(p: Prop): void {
  nudge(p);
  sfx.boing();
  for (let i = 0; i < 7; i++)
    bit({
      x: p.x + (Math.random() - 0.5) * 8,
      y: p.y - 7,
      vx: (Math.random() - 0.5) * 14,
      vy: -10 - Math.random() * 18,
      drag: 1.2,
      ttl: 0.9 + Math.random() * 0.8,
      col: CREAM,
      flutter: 1.5,
    });
}

export function tapStone(p: Prop): void {
  nudge(p);
  sfx.knock();
  puff(p.x, p.y, 4, STONE[2]);
}

let knocks = 0;
export function tapTrunk(p: Prop, wx: number, wy: number): void {
  nudge(p);
  sfx.knock();
  puff(wx, wy, 3, BARK[3]);
  flutter(wx, G.cam.y - 2, 9, [GREEN[2], GREEN[1], BARK[3]], 34, 0);
  knocks++;
  if (knocks % 3 === 0) {
    sfx.hoo();
    float(wx, G.cam.y + 34, "hoo.", CREAM, 2);
  }
}

export function tapPost(p: Prop, l: Light): void {
  nudge(p);
  l.boost = 1;
  sfx.pluck(4 + (Math.floor(p.x / 31) % 5));
  burst(l.x, l.y, 5, [GOLD[2], CREAM], 26);
}

export function tapChest(p: Prop, _x: number, _y: number, own: boolean): void {
  nudge(p);
  chest.openUntil = G.t + 1.4;
  sparkle(p.x, p.y - 8, 8, 5);
  sfx.coin(2);
  // The member's present, once a UTC day, which Leaf keeps: opened again, it is only a chest.
  if (own)
    void (async () => {
      if (ok(await ask({ do: "openChest" }))) float(p.x, p.y - 16, `+${DAILY_CHEST} Coins`, GOLD[1]);
    })();
}

/** The member sits on the free seat nearest the point, if there is one; nobody else sees a touch on a seat. */
export function tapSeat(_p: Prop, wx: number, wy: number, own: boolean): void {
  if (!own) return;
  let best = null;
  let bd = 20;
  for (const s of SEATS) {
    const d = dist(wx, wy, s.x, s.y - 6);
    if (d < bd && !s.taken) {
      bd = d;
      best = s;
    }
  }
  if (best && goSit(best)) sfx.tap();
  else sfx.knock();
}

export function flare(): void {
  fire.boost = 1;
  sfx.whoosh();
  burst(fire.x, fire.y - 8, 16, [GOLD[1], SKY[5], CREAM], 46);
}

export function ringBell(): void {
  sfx.ding();
  sparkle(118, 104, 5, 3);
}

export function tapTree(p: Prop): void {
  nudge(p);
  tree.shakeAt = G.t;
  flutter(tree.x, tree.y - 52, 14, [GOLD[1], GOLD[0], SKY[5]], 24, 10);
  sfx.twinkle();
  const { n } = raised();
  float(tree.x, tree.y - 70, `${n} lantern${n === 1 ? "" : "s"}, one a raid`, GOLD[2], 2.2);
}

export function tapPole(): void {
  banner.flutter = 1;
  sfx.pluck(6);
  const b = flown();
  if (b && b.up > 0.5) float(banner.x, banner.y - 78, b.land, GOLD[2], 2);
  else float(banner.x, banner.y - 40, "No banner yet", CREAM, 2);
}

/** A knock on the stump: every carved figure jumps. */
export function tapTable(p: Prop): void {
  table.jumpAt = G.t;
  csfx.knock();
  nudge(p);
}

/** The Works' doors swing in and the hearth lights the yard; `false` lets them fall to again. */
export function openDoor(open: boolean): void {
  door.goal = open ? 1 : 0;
  if (!open) return;
  csfx.door();
  smoke(5);
}

/** The lantern over the board burns up for a game; `false` lets it settle. */
export function lightTable(lit: boolean): void {
  table.goal = lit ? 1 : 0;
  if (!lit) return;
  table.jumpAt = G.t;
  sfx.twinkle();
}

/** Touching the water: rings spread from the spot, and the crabs take notice. */
function tapWater(wx: number, wy: number): void {
  ring(wx, wy, WATER[3], 13, true);
  ring(wx, wy, WATER[2], 8, true);
  sfx.plop();
  for (const c of crabs) if (!c.lost && dist(c.x, c.y, wx, wy) < 44) c.hop = 0.3;
}

function tapSky(wx: number, wy: number): void {
  sfx.star();
  for (let i = 0; i < 14; i++)
    bit({
      x: wx - i * 2.2,
      y: wy - i * 1.1,
      vx: 70,
      vy: 34,
      ttl: 0.5 + i * 0.03,
      life: i * 0.012,
      col: i < 3 ? CREAM : GOLD[2],
      glow: true,
    });
}

/** Every string of lights runs a ripple along itself: the town saying hello. */
export function twinkleAll(): void {
  strings.forEach((s, i) => {
    s.chase = G.t + i * 0.12;
  });
  for (const l of lights) l.boost = Math.max(l.boost, 0.6);
}

/** The string of lights with a bulb by a point, if one hangs there. */
const stringAt = (wx: number, wy: number): Str | undefined =>
  strings.find((s) => s.bulbs.some((b) => dist(b.x, b.y, wx, wy) < 5));

/**
 * A crab hops and clacks. Crab No. 7 runs off from the member who found it, and is counted for
 * them; for everybody else it is still where it hides, to be found by each of them in turn.
 */
function tapCrab(c: Crab, own: boolean): void {
  // Running off already: it runs on.
  if (c.bolt > 0) return;
  c.hop = 0.3;
  c.clack = 0.5;
  sfx.clack();
  if (!c.lost) {
    float(c.x, c.y - 12, `No. ${c.n}`, CREAM, 1.2);
    return;
  }
  if (!own) return;
  // Counted once for each place it hides, which Leaf keeps, by Leaf's clock: it bolts either way.
  if (ok(doNow({ do: "spotCrab" }, G.now))) {
    float(c.x, c.y - 14, QUIPS[town().sightings % QUIPS.length] ?? "", SKY[5], 2.2);
    hooks.feed(`You spotted crab No. ${c.n}. It got away.`, "coral");
  }
  // Gone until it hides somewhere else, at the next stretch.
  scared = { stretch: stretchOf(G.now), at: G.now };
  c.bolt = 0.01;
  puff(c.x, c.y, 5, EARTH[2]);
}

/**
 * Puts every crab where Leaf's clock (`G.now`) has it, the same on every page: ambling about its
 * home, and the missing one in its hiding place for this stretch. That one runs off when found
 * (`scared`) and is gone for the rest of the stretch; left alone, it runs off as the stretch turns.
 * `dt` seconds pass for a crab shying from somebody's feet.
 */
export function placeCrabs(dt = 0): void {
  for (const c of crabs) {
    if (c.lost) {
      const h = hiding(SEED, G.now);
      const found = scared?.stretch === h.stretch ? scared : null;
      const leaving = !found && scared?.stretch !== h.stretch - 1 && h.since < BOLT * 1000;
      const from = leaving ? h.was : h.at;
      c.bolt = found ? Math.max(0.01, (G.now - found.at) / 1000) : leaving ? Math.max(0.01, h.since / 1000) : 0;
      c.x = from.x + (from.x < 256 ? -1 : 1) * 90 * c.bolt;
      c.y = from.y - 20 * c.bolt;
      c.z = from.z;
      continue;
    }
    const w = crabByClock(SEED, c.n, G.now);
    const reach = c.perched ? 4 : 12;
    const far = Math.abs(w.to - w.from) * reach;
    const gone = Math.min(far, (SCUTTLE * (G.now - w.at)) / 1000);
    const x = c.hx + w.from * reach + Math.sign(w.to - w.from) * gone;
    const step = clamp((G.t < c.shyUntil ? c.shyTo - x : 0) - c.aside, -SCUTTLE * dt, SCUTTLE * dt);
    c.aside += step;
    c.moving = gone < far || step !== 0;
    c.x = x + c.aside;
  }
}

export function crabAt(wx: number, wy: number): Crab | null {
  for (const c of crabs) if (c.bolt === 0 && Math.abs(wx - c.x) < 8 && wy > c.y - 11 && wy < c.y + 4) return c;
  return null;
}

// ---------- a touch, by its name ----------

/**
 * A touch's name: what was touched (core's `THINGS`) and the point on it in whole pixels, as
 * `post:96,150`, or its number, as `crab:3`, or neither, as `roll`.
 */
export const thingName = (what: string, ...at: readonly number[]): string =>
  at.length > 0 ? `${what}:${at.map(Math.floor).join(",")}` : what;

/** A log on the fire is a touch on it. */
export const LOG = thingName("fire", fire.x, fire.y - 6);

/** The thing a touch's name means: where it is, and what it does, told whether the touch was the member's own. */
export interface Touched {
  x: number;
  y: number;
  play(own: boolean): void;
}

/**
 * What a touch's name means: the thing standing of that kind under its point, the water, the sky or
 * a string of lights at its point, a crab by its number, or the roll call. Everything here stands
 * where it does on every page, so a name means the same on each. Null for a name that means
 * nothing here.
 */
export function touchedBy(name: string): Touched | null {
  const [what = "", where = ""] = name.split(":");
  if (what === "roll") return { x: 400, y: 290, play: rollCall };
  const [x = NaN, y = NaN] = where.split(",").map(Number);
  const c = what === "crab" ? crabs.find((k) => k.n === x) : undefined;
  if (c) return { x: c.x, y: c.y, play: (own) => tapCrab(c, own) };
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  const at = (play: () => void): Touched => ({ x, y, play });
  const s = what === "lights" ? stringAt(x, y) : undefined;
  if (s)
    return at(() => {
      s.chase = G.t;
      sfx.twinkle();
    });
  if (what === "water") return pondD(x, y) < 1 ? at(() => tapWater(x, y)) : null;
  if (what === "sky") return y < hedgeY(x) ? at(() => tapSky(x, y)) : null;
  const p = propUnder(
    props.filter((q) => q.kind === what),
    x,
    y,
  );
  return p ? { x, y, play: (own) => p.tap?.(p, x, y, own) } : null;
}

/** The last touches played here, for `window.town`: each thing's name, and whether the member touched it. */
export const lastTouches: { name: string; own: boolean }[] = [];

/**
 * Every touch on a thing in town comes here, by the thing's name (`touchedBy`): it answers on this
 * page, and the member's own (`own`) is told to the room, so that it answers on every page there.
 * One from the room is not told again, and is heard only if the thing is on the screen. Says
 * whether the name meant anything here.
 */
export function touchThing(name: string, own = true): boolean {
  const t = touchedBy(name);
  if (!t) return false;
  // A page put away draws nothing: what others touch meanwhile is over before it is looked at again.
  if (!own && typeof document !== "undefined" && document.hidden) return true;
  if (own || onScreen(t.x, t.y)) t.play(own);
  else hush(() => t.play(own));
  if (own) hooks.tell(name);
  lastTouches.push({ name, own });
  if (lastTouches.length > 20) lastTouches.shift();
  return true;
}

// ---------- the guild's moments ----------

/** How many lanterns the day has, one a raid: the tree shows the newest of them. */
export const hung = (): number => raised().n;

/** Whether a lantern goes up at a moment of Leaf's clock: a raid of another day hangs none in today's tree. */
export const hangs = (at: number): boolean => lanterns().some((l) => l.hung === at);

/** The lantern that went up at `at` is in the tree: it lands with a sparkle. */
export function landLantern(at: number): void {
  const l = lanterns().find((o) => o.hung === at);
  if (!l) return;
  sparkle(tree.x + l.at.x, tree.y + l.at.y + 4, 12, 6);
  if (G.home) sfx.bell();
}

/** The banner is at the top of its pole. */
export function crownBanner(): void {
  burst(banner.x + 8, banner.y - 64, 22, [GOLD[1], SKY[4], CREAM, SKY[5]], 60);
  sparkle(banner.x + 8, banner.y - 60, 10, 10);
}

/**
 * Every crab in the pond answers in turn; one does not. Called by another player, each is heard
 * only if it is on the screen.
 */
function rollCall(own: boolean): void {
  crabs.forEach((c, i) => calls.push({ at: G.t + i * 0.38, n: c.n, own }));
}
const calls: { at: number; n: number; own: boolean }[] = [];

export function smoke(count: number): void {
  for (let i = 0; i < count; i++)
    bit({
      x: 426 + (Math.random() - 0.5) * 6,
      y: 20,
      vx: 5 + Math.random() * 6,
      vy: -12 - Math.random() * 8,
      drag: 0.4,
      ttl: 2 + Math.random() * 1.6,
      col: i % 2 ? STONE[2] : STONE[1],
      size: 2 + (i % 2),
    });
}

// ---------- every moment ----------

let smokeIn = 0;
let emberIn = 0;
let driftIn = 2;
let cricketIn = 5;

/** Small things stir as anybody goes by (`walkers`): flowers nod, crabs edge away, a lamp brightens. */
function brushPast(walkers: readonly Actor[]): void {
  for (const p of walkers) {
    if (!p.moving || p.away) continue;
    for (const q of props) {
      if (Math.abs(q.x - p.x) > 16 || Math.abs(q.y - p.y) > 30) continue;
      if (q.kind === "post") {
        const l = lamps.get(q);
        if (l) l.boost = Math.max(l.boost, 0.4);
      } else if ((q.kind === "flower" || q.kind === "fern" || q.kind === "reeds") && G.t - q.bumpAt > 1.2) {
        if (Math.abs(q.x - p.x) < 5 && Math.abs(q.y - p.y) < 4) q.bumpAt = G.t;
      }
    }
    for (const c of crabs) {
      if (c.lost || dist(c.x, c.y, p.x, p.y) > 18) continue;
      c.shyTo = c.hx + (c.hx >= p.x ? 1 : -1) * (c.perched ? 2 : 9);
      c.shyUntil = G.t + 2.2;
    }
  }
}
export const lamps = new Map<Prop, Light>();

/** The town, `dt` seconds on; `walkers` are everybody walking about: the member and the other players. */
export function stepTown(dt: number, walkers: readonly Actor[]): void {
  for (const l of lights) l.boost = Math.max(0, l.boost - dt * 1.4);
  brushPast(walkers);

  // The fire.
  fire.boost = Math.max(0, fire.boost - dt * 0.7);
  emberIn -= dt;
  if (emberIn <= 0) {
    emberIn = 0.12 + Math.random() * 0.2 - fire.boost * 0.08;
    bit({
      x: fire.x + (Math.random() - 0.5) * 6,
      y: fire.y - 8,
      vx: (Math.random() - 0.5) * 10,
      vy: -18 - Math.random() * 20,
      ttl: 0.7 + Math.random() * 0.9,
      col: Math.random() < 0.5 ? GOLD[1] : SKY[5],
      glow: true,
      flutter: 1.2,
    });
    if (G.home && Math.random() < 0.3 && onScreen(fire.x, fire.y)) sfx.crackle();
  }

  // The Works: smoke from the chimney, crates along the belt.
  smokeIn -= dt;
  if (smokeIn <= 0) {
    smokeIn = 0.5;
    smoke(1);
  }
  belt.boost = Math.max(0, belt.boost - dt);
  const speed = 9 * (1 + (belt.boost > 0 ? 2.2 : 0));
  belt.off = (belt.off + speed * dt) % 6;
  for (let i = belt.crates.length - 1; i >= 0; i--) {
    const at = (belt.crates[i] ?? 0) + speed * dt;
    belt.crates[i] = at;
    if (at >= 50) {
      belt.crates.splice(i, 1);
      belt.fly = 0;
    }
  }
  belt.next -= dt * (speed / 9);
  if (belt.next <= 0) {
    belt.next = 5.5;
    belt.crates.push(0);
  }
  if (belt.fly >= 0) {
    belt.fly += dt / 0.36;
    if (belt.fly >= 1) {
      belt.fly = -1;
      // The pile is carted off to the depot when it is four high.
      belt.fresh = belt.fresh >= 4 ? 1 : belt.fresh + 1;
      if (onScreen(466, 118)) {
        puff(466, 118, 3, EARTH[2]);
        if (G.home) sfx.pop();
      }
    }
  }

  // The Works' doors, and the board on the stump.
  door.open += Math.sign(door.goal - door.open) * Math.min(Math.abs(door.goal - door.open), dt * 4);
  if (doorLights.door) doorLights.door.boost = Math.max(doorLights.door.boost, door.open);
  table.lit += Math.sign(table.goal - table.lit) * Math.min(Math.abs(table.goal - table.lit), dt * 3);
  if (doorLights.table) doorLights.table.boost = Math.max(doorLights.table.boost, table.lit);
  stepTable(walkers);

  // The banner flaps hard on its way up or down.
  banner.flutter = (flown()?.up ?? 1) < 1 ? 1 : Math.max(0, banner.flutter - dt * 0.5);

  // Crabs.
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if (!call || G.t < call.at) continue;
    calls.splice(i, 1);
    const c = crabs.find((k) => k.n === call.n);
    if (!c) continue;
    const loud = call.own || onScreen(c.x, c.y);
    if (c.lost) {
      if (loud) sfx.cricket();
      float(400, 272, `No. ${c.n}?  ...`, SKY[5], 1.6);
    } else {
      c.hop = 0.3;
      c.clack = 0.35;
      if (loud) sfx.clack();
      float(c.x, c.y - 10, `${c.n}`, CREAM, 0.9);
    }
  }
  for (const c of crabs) {
    c.hop = Math.max(0, c.hop - dt);
    c.clack = Math.max(0, c.clack - dt);
  }
  placeCrabs(dt);

  // The evening itself: a leaf coming down, fireflies over the pond and the garden, crickets.
  driftIn -= dt;
  if (driftIn <= 0) {
    driftIn = 0.9 + Math.random() * 1.6;
    if (Math.random() < 0.5) {
      flutter(G.cam.x + Math.random() * G.view.w, G.cam.y - 4, 1, [GOLD[0], GREEN[3], BARK[4]], 2, 0);
    } else {
      const byPond = Math.random() < 0.6;
      bit({
        x: byPond ? 342 + Math.random() * 120 : 40 + Math.random() * 120,
        y: byPond ? 250 + Math.random() * 70 : 290 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 8,
        vy: -3 - Math.random() * 4,
        ttl: 3 + Math.random() * 3,
        col: GOLD[2],
        glow: true,
        flutter: 1.6,
      });
    }
  }
  cricketIn -= dt;
  if (cricketIn <= 0) {
    cricketIn = 3 + Math.random() * 6;
    if (G.home) sfx.cricket();
  }
}

/**
 * Whether anybody is at the stump, which every page knows the same: a player sitting at it (the
 * member, or another in the room) or a member Leaf lists at the table, standing by it. Each move
 * is heard.
 */
function stepTable(walkers: readonly Actor[]): void {
  const played = [...walkers, ...G.visitors].some(
    (a) =>
      !a.away &&
      !a.moving &&
      a.dozing === null &&
      (a.doing === "table" || SEATS.some((s) => s.at === "table" && sitsOn(a, s))),
  );
  table.played = played;
  const moved = played ? boardAt(SEED, G.now).moved?.at : undefined;
  if (moved === undefined || moved === table.moved) return;
  table.moved = moved;
  if (G.home && onScreen(table.x, table.y)) {
    noise(0.025, 2100, { vol: 0.05, q: 5 });
    tone(392, 0.05, { vol: 0.04, type: "square", at: 0.2 });
  }
}
