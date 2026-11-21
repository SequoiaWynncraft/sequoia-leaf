/**
 * The town's furniture and everything it does: what stands where, what each thing does when it is
 * touched, and the parts that never keep still (the fire, the belt, the banner, the lanterns, the crabs).
 */

import { goSit, onScreen } from "./actors.ts";
import { sfx } from "./audio.ts";
import { bit, burst, float, flutter, puff, ring, sparkle } from "./fx.ts";
import { changed, G, hooks } from "./game.ts";
import { GROUND, paintTrunk } from "./ground.ts";
import { BARK, CREAM, EARTH, GOLD, GREEN, INK, SKY, STONE, WATER } from "./palette.ts";
import { ell, R } from "./pix.ts";
import type { Sprite, Sprites } from "./sprites.ts";
import { clamp, type Ctx, dist, lerp, type Pt, type Rect, rng } from "./util.ts";
import { type PlaceId, pondD, POSTS, SEATS } from "./world.ts";

export interface Prop {
  kind: string;
  /** Where its picture's foot goes, and where it sorts among the people (lower down is nearer). */
  x: number;
  y: number;
  z: number;
  sprite: Sprite | null;
  hit: Rect | null;
  place: PlaceId | null;
  /** When it was last touched: things shiver or hop for a moment after. */
  bumpAt: number;
  hops: boolean;
  tap: ((p: Prop, wx: number, wy: number) => void) | null;
  /** Anything drawn over the picture each frame, given the picture's foot on screen. */
  extra: ((g: Ctx, sx: number, sy: number) => void) | null;
}

export interface Light {
  x: number;
  y: number;
  r: number;
  power: number;
  /** Raised by a touch, and dying away. */
  boost: number;
  phase: number;
}

export const props: Prop[] = [];
export const lights: Light[] = [];

let S: Sprites | null = null;
const random = rng(20261120);

function add(kind: string, sprite: Sprite | null, x: number, y: number, o: Partial<Prop> = {}): Prop {
  const p: Prop = {
    kind,
    x,
    y,
    z: y,
    sprite,
    hit: sprite ? { x: x - sprite.ax, y: y - sprite.ay, w: sprite.c.width, h: sprite.c.height } : null,
    place: null,
    bumpAt: -9,
    hops: false,
    tap: null,
    extra: null,
    ...o,
  };
  props.push(p);
  return p;
}

function light(x: number, y: number, r: number, power = 1): Light {
  const l = { x, y, r, power, boost: 0, phase: random() * 6.28 };
  lights.push(l);
  return l;
}

// ---------- the parts that move ----------

export const fire = { x: 256, y: 212, boost: 0 };
const fireLight: Light = { x: 256, y: 206, r: 64, power: 1, boost: 0, phase: 0 };

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

const BANNERS: readonly (readonly [string, string])[] = [
  [SKY[4], "#9c3f73"],
  [WATER[2], WATER[1]],
  [SKY[3], SKY[2]],
  [GREEN[3], GREEN[2]],
];

export const banner = {
  x: 300,
  y: 152,
  up: 0,
  goal: 0,
  hue: 0,
  name: "",
  next: "",
  flutter: 0,
  ribbons: 0,
  cheered: true,
};

interface Slot {
  dx: number;
  dy: number;
  lit: boolean;
  at: number;
  col: number;
  from: Pt | null;
  landed: boolean;
}

export const tree = {
  x: 352,
  y: 200,
  shakeAt: -9,
  slots: [
    [-20, -37],
    [-12, -31],
    [-4, -27],
    [6, -26],
    [14, -29],
    [22, -35],
    [-27, -45],
  ].map(([dx, dy], i): Slot => ({
    dx: dx ?? 0,
    dy: dy ?? 0,
    lit: i === 1 || i === 4,
    at: -100 + i,
    col: i % 3,
    from: null,
    landed: true,
  })),
  /** Lanterns let go to make room, drifting up through the canopy. */
  adrift: new Array<{ x: number; y: number; col: number; life: number }>(),
};

export const chest = { openUntil: 0, looted: false };

export interface Crab {
  n: number;
  hx: number;
  hy: number;
  x: number;
  y: number;
  tx: number;
  wait: number;
  hop: number;
  clack: number;
  /** The one that is never at roll call: it hides about the town, and bolts when found. */
  lost: boolean;
  hide: number;
  bolt: number;
  z: number;
  /** Up on a rock: it never gets its feet wet. */
  perched: boolean;
}

export const crabs: Crab[] = [];

/** Where each crab lives: x, y, and whether that is on top of a rock out in the water. */
const CRAB_HOMES: readonly (readonly [number, number, number])[] = [
  [352, 285, 0],
  [384, 266, 0],
  [424, 261, 0],
  [460, 285, 0],
  [446, 314, 0],
  [396, 328, 0],
  [404, 292, 1],
  [432, 284, 1],
];

/** Where the missing crab turns up: x, y, and what it sorts in front of. */
const HIDES: readonly (readonly [number, number, number])[] = [
  [198, 121, 161],
  [122, 36, 121],
  [108, 206, 249],
  [256, 44, 99],
  [352, 148, 201],
  [272, 232, 241],
  [468, 117, 135],
  [130, 301, 313],
  [404, 40, 119],
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
const glints: Glint[] = [];

interface Str {
  wire: Pt[];
  bulbs: { x: number; y: number; c: number }[];
  chase: number;
}
const strings: Str[] = [];
const BULBS = [GOLD[2], SKY[5], CREAM, SKY[4]] as const;

function strung(x1: number, y1: number, x2: number, y2: number, sag: number): void {
  const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1)));
  const wire: Pt[] = [];
  const bulbs: Str["bulbs"] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = { x: Math.round(lerp(x1, x2, t)), y: Math.round(lerp(y1, y2, t) + sag * 4 * t * (1 - t)) };
    const last = wire[wire.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    wire.push(p);
    if (wire.length % 7 === 4) bulbs.push({ x: p.x, y: p.y + 1, c: bulbs.length % BULBS.length });
  }
  strings.push({ wire, bulbs, chase: -9 });
}

// ---------- what touching things does ----------

const mid = (p: Prop): Pt => ({ x: p.x, y: p.y - (p.sprite ? p.sprite.c.height * 0.55 : 5) });

function nudge(p: Prop): void {
  p.bumpAt = G.t;
}

function tapLeafy(p: Prop): void {
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

function tapFlower(p: Prop, col: string): void {
  nudge(p);
  flutter(p.x, p.y - 5, 4, [col, col, CREAM], 3, 30);
  sfx.pluck(Math.floor(p.x / 23) % 10);
}

function tapMushroom(p: Prop): void {
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

function tapStone(p: Prop): void {
  nudge(p);
  sfx.knock();
  puff(p.x, p.y, 4, STONE[2]);
}

let knocks = 0;
function tapTrunk(p: Prop, wx: number, wy: number): void {
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

function tapPost(p: Prop, l: Light): void {
  nudge(p);
  l.boost = 1;
  sfx.pluck(4 + (Math.floor(p.x / 31) % 5));
  burst(l.x, l.y, 5, [GOLD[2], CREAM], 26);
}

function tapChest(p: Prop): void {
  nudge(p);
  chest.openUntil = G.t + 1.4;
  sparkle(p.x, p.y - 8, 8, 5);
  sfx.coin(2);
  if (!chest.looted) {
    chest.looted = true;
    G.coins += 3;
    float(p.x, p.y - 16, "+3 Coins", GOLD[1]);
    changed();
  }
}

function tapSeat(wx: number, wy: number): void {
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

function tapTree(p: Prop): void {
  nudge(p);
  tree.shakeAt = G.t;
  flutter(tree.x, tree.y - 52, 14, [GOLD[1], GOLD[0], SKY[5]], 24, 10);
  sfx.twinkle();
  const n = tree.slots.filter((s) => s.lit).length;
  float(tree.x, tree.y - 70, `${n} lantern${n === 1 ? "" : "s"}: one for every raid today`, GOLD[2], 2.2);
}

function tapPole(): void {
  banner.flutter = 1;
  sfx.pluck(6);
  if (banner.up > 0.5) float(banner.x, banner.y - 78, banner.name, GOLD[2], 2);
  else float(banner.x, banner.y - 40, "No banner yet tonight", CREAM, 2);
}

function tapPlace(p: Prop): void {
  nudge(p);
  if (p.place) hooks.visit(p.place);
}

/** Touching the water: rings spread from the spot, and the crabs take notice. */
export function tapWater(wx: number, wy: number): void {
  ring(wx, wy, WATER[3], 13, true);
  ring(wx, wy, WATER[2], 8, true);
  sfx.plop();
  for (const c of crabs) if (!c.lost && dist(c.x, c.y, wx, wy) < 44) c.hop = 0.3;
}

export function tapSky(wx: number, wy: number): void {
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

/** Lights the string nearest a point, if one hangs there. */
export function tapString(wx: number, wy: number): boolean {
  for (const s of strings) {
    if (!s.bulbs.some((b) => dist(b.x, b.y, wx, wy) < 5)) continue;
    s.chase = G.t;
    sfx.twinkle();
    return true;
  }
  return false;
}

export function tapCrab(c: Crab): void {
  c.hop = 0.3;
  c.clack = 0.5;
  sfx.clack();
  if (!c.lost) {
    float(c.x, c.y - 12, `No. ${c.n}`, CREAM, 1.2);
    return;
  }
  G.sightings++;
  float(c.x, c.y - 14, QUIPS[G.sightings % QUIPS.length] ?? "", SKY[5], 2.2);
  hooks.feed(`You spotted crab No. ${c.n}. It got away.`, "crab");
  c.bolt = 0.01;
  puff(c.x, c.y, 5, EARTH[2]);
  changed();
}

export function crabAt(wx: number, wy: number): Crab | null {
  for (const c of crabs) if (c.bolt === 0 && Math.abs(wx - c.x) < 8 && wy > c.y - 11 && wy < c.y + 4) return c;
  return null;
}

// ---------- the guild's moments ----------

/** A lantern goes up into the tree from someone's hands; when the tree is full, the oldest drifts away. */
export function hangLantern(from: Pt): void {
  let slot = tree.slots.find((s) => !s.lit);
  if (!slot) {
    slot = tree.slots.reduce((a, b) => (a.at < b.at ? a : b));
    tree.adrift.push({ x: tree.x + slot.dx, y: tree.y + slot.dy + 4, col: slot.col, life: 0 });
  }
  slot.lit = true;
  slot.at = G.t;
  slot.from = { x: from.x, y: from.y };
  slot.landed = false;
  slot.col = G.raidsToday % 3;
  sfx.pop();
}

export function raiseBanner(name: string): void {
  banner.next = name;
  banner.goal = banner.up > 0.3 ? 0.12 : 1;
  if (banner.up <= 0.3) {
    banner.name = name;
    banner.next = "";
    banner.hue = G.lands % BANNERS.length;
  }
  banner.cheered = false;
  banner.flutter = 1;
}

/** Every crab in the pond answers in turn; one does not. Returns how long the roll takes. */
export function rollCall(): number {
  let at = 0;
  for (let n = 1; n <= 9; n++) {
    const c = crabs.find((k) => k.n === n);
    if (!c) continue;
    const when = at;
    calls.push({ at: G.t + when, n });
    at += 0.38;
  }
  return at;
}
const calls: { at: number; n: number }[] = [];

// ---------- building it ----------

function shadow(g: Ctx, x: number, y: number, rx: number, ry: number): void {
  ell(g, x - GROUND.x, y - GROUND.y, rx, ry, "rgba(20,10,28,0.3)");
}

export function buildTown(s: Sprites, ground: Ctx): void {
  S = s;

  // The enormous trunks: four across the back, two down each side.
  const trunk = (cx: number, base: number, hw: number, seed: number): void => {
    const t = paintTrunk(hw, base + 210, seed, 250);
    add("trunk", t, cx, base, { tap: tapTrunk });
  };
  trunk(10, 106, 44, 1);
  trunk(196, 96, 26, 2);
  trunk(316, 96, 26, 3);
  trunk(502, 108, 44, 4);
  trunk(-12, 204, 40, 5);
  trunk(524, 236, 40, 6);
  trunk(-6, 344, 44, 7);
  trunk(520, 348, 46, 8);

  // Treasury, with its counter a separate piece in front of where Cinfy stands.
  add("treasury", s.treasury, 56, 120, { z: 110, place: "treasury", tap: tapPlace });
  add("counter", s.counter, 81, 120, {
    place: "treasury",
    tap: (p) => {
      ringBell();
      tapPlace(p);
    },
  });
  light(104, 104, 44, 0.95);
  light(71, 94, 20, 0.7);
  light(136, 94, 20, 0.7);
  add("chest", null, 160, 121, {
    hit: { x: 152, y: 107, w: 16, h: 15 },
    tap: tapChest,
    hops: true,
    extra: (g, sx, sy) => {
      const pic = G.t < chest.openUntil ? s.chestOpen : s.chest;
      g.drawImage(pic.c, sx - pic.ax, sy - pic.ay);
    },
  });
  add("barrel", s.barrel, 62, 124, { tap: tapStone, hops: true });
  add("barrel", s.barrel, 51, 122, { tap: tapStone, hops: true });

  // The Works: the shop, the belt out front, and the pile the belt feeds.
  add("works", s.works, 344, 120, {
    z: 118,
    place: "works",
    tap: (p) => {
      smoke(8);
      sfx.clank();
      tapPlace(p);
    },
  });
  light(372, 106, 40, 1);
  light(430, 90, 20, 0.7);
  add("belt", null, 402, 134, {
    hit: { x: 400, y: 112, w: 60, h: 22 },
    place: "works",
    tap: (p) => {
      belt.boost = 2.5;
      sfx.clank();
      tapPlace(p);
    },
    extra: drawBelt,
  });
  add("pile", s.pile, 458, 135, {
    place: "works",
    tap: tapPlace,
    extra: (g, sx, sy) => {
      for (let i = 0; i < belt.fresh; i++) g.drawImage(s.box.c, sx + 2 + (i % 2) * 8, sy - 26 - Math.floor(i / 2) * 6);
    },
  });

  // The gate out to the member's own camp, and the signpost that says so.
  add("gate", s.gate, 256, 98, { place: "camp", tap: tapPlace });
  light(237, 65, 24, 0.9);
  light(275, 65, 24, 0.9);
  light(256, 84, 34, 0.85); // the last of the sun, coming up the path
  add("signpost", s.signpost, 291, 106, { place: "camp", tap: tapPlace, hops: true });

  add("board", s.board, 176, 160, {
    place: "quests",
    tap: (p) => {
      flutter(198, 140, 5, [CREAM, GOLD[2]], 12, 20);
      sfx.paper();
      tapPlace(p);
    },
    extra: (g, sx, sy) => {
      if (!G.quests.some((q) => q.have >= q.need && !q.claimed)) return;
      const bob = Math.round(Math.sin(G.t * 4) * 1.5);
      g.drawImage(s.bang.c, sx + 20, sy - 56 + bob);
    },
  });
  add("pole", s.pole, banner.x, banner.y, { tap: tapPole, extra: drawBanner });

  s.stalls.forEach((st, i) => {
    const x = 40 + i * 48;
    add("stall", st, x, 248, {
      place: "market",
      tap: (p) => {
        sfx.pluck(2 + i * 2);
        tapPlace(p);
      },
    });
    light(x + 12, 224, 34, 0.9);
    shadow(ground, x + 20, 249, 22, 3);
  });

  POSTS.forEach((p) => {
    const l = light(p.x + 8, p.y - 26, 36, 0.9);
    lamps.set(add("post", s.post, p.x, p.y, { tap: (q) => tapPost(q, l) }), l);
    shadow(ground, p.x + 1, p.y, 5, 2);
  });

  add("tree", s.tree, tree.x, tree.y, { tap: tapTree, extra: drawTreeLanterns });
  shadow(ground, tree.x, tree.y + 2, 24, 6);

  // The fire and its seats.
  add("fire", s.fireRing, 256, 217, {
    place: "fire",
    tap: (p) => {
      flare();
      tapPlace(p);
    },
    hit: { x: 244, y: 196, w: 24, h: 24 },
    extra: drawFire,
  });
  add("seat", s.log, 256, 200, { tap: (_p, wx, wy) => tapSeat(wx, wy) });
  add("seat", s.log, 256, 240, { tap: (_p, wx, wy) => tapSeat(wx, wy) });
  add("seat", s.stump, 220, 216, { tap: (_p, wx, wy) => tapSeat(wx, wy) });
  add("seat", s.stump, 292, 216, { tap: (_p, wx, wy) => tapSeat(wx, wy) });
  add("seat", s.bench, 120, 312, { tap: (_p, wx, wy) => tapSeat(wx, wy) });
  shadow(ground, 256, 201, 18, 3);
  shadow(ground, 256, 241, 18, 3);
  shadow(ground, 120, 313, 15, 2);

  // The garden, the pond's edge, and green things round the clearing.
  for (const [x, y, big] of [
    [46, 312, 1],
    [56, 322, 0],
    [38, 324, 0],
    [72, 332, 1],
    [476, 220, 0],
    [150, 106, 0],
  ] as const) {
    add("mushroom", big ? s.mushroom : s.mushlet, x, y, { tap: tapMushroom, hops: true });
    shadow(ground, x, y, big ? 5 : 3, 1.5);
  }
  const PETALS = [SKY[4], CREAM, GOLD[1]] as const;
  const patch = (x: number, y: number, kind: number): void => {
    for (const [dx, dy, k] of [
      [0, 0, 0],
      [6, 3, 1],
      [-5, 4, 2],
      [2, 8, 0],
      [11, -1, 2],
    ] as const) {
      const which = (kind + k) % 3;
      const pic = s.flowers[which];
      if (pic) add("flower", pic, x + dx, y + dy, { tap: (p) => tapFlower(p, PETALS[which] ?? CREAM), hops: true });
    }
  };
  for (const [x, y, k] of [
    [84, 304, 0],
    [146, 328, 1],
    [234, 170, 2],
    [44, 140, 1],
    [326, 172, 0],
    [432, 162, 2],
    [470, 240, 1],
    [300, 316, 0],
    [356, 334, 2],
    [40, 196, 0],
    [150, 196, 2],
    [214, 328, 1],
  ] as const)
    patch(x, y, k);
  for (const [x, y, k] of [
    [150, 184, 0],
    [46, 158, 1],
    [436, 180, 0],
    [470, 206, 2],
    [286, 334, 1],
    [58, 206, 2],
    [330, 296, 2],
    [176, 216, 2],
  ] as const) {
    const pic = s.bushes[k];
    if (!pic) continue;
    add("bush", pic, x, y, { tap: tapLeafy });
    shadow(ground, x, y, pic.c.width / 2 - 1, 2);
  }
  for (const [x, y, k] of [
    [64, 128, 1],
    [162, 100, 0],
    [230, 104, 2],
    [348, 102, 0],
    [42, 214, 1],
    [50, 340, 1],
    [468, 244, 0],
    [462, 336, 1],
    [140, 340, 2],
    [240, 338, 0],
    [330, 340, 1],
    [476, 150, 2],
    [34, 268, 0],
  ] as const) {
    const pic = s.ferns[k];
    if (pic) add("fern", pic, x, y, { tap: tapLeafy });
  }
  for (const [x, y, k] of [
    [340, 292, 0],
    [464, 302, 2],
    [432, 322, 1],
    [382, 326, 1],
    [404, 297, 1],
    [432, 289, 1],
    [312, 182, 1],
  ] as const) {
    const pic = s.rocks[k];
    if (pic) add("rock", pic, x, y, { tap: tapStone, hops: true });
  }
  for (const [x, y] of [
    [348, 302],
    [456, 296],
    [422, 320],
    [376, 322],
    [364, 276],
  ] as const)
    add("reeds", s.reeds, x, y, { tap: tapLeafy });
  // Lily pads lie on the water, so they are painted on the ground rather than stood up.
  for (const [x, y, bloom] of [
    [390, 288, 0],
    [418, 304, 1],
    [444, 280, 0],
    [372, 308, 1],
    [410, 278, 0],
    [424, 300, 0],
  ] as const) {
    const pic = bloom ? s.lilyBloom : s.lily;
    ground.drawImage(pic.c, x - pic.ax - GROUND.x, y - pic.ay - GROUND.y);
  }
  // A strip of shade where the shops meet the ground.
  ground.fillStyle = "rgba(20,10,28,0.3)";
  ground.fillRect(56 - GROUND.x, 120 - GROUND.y, 96, 3);
  ground.fillRect(344 - GROUND.x, 120 - GROUND.y, 104, 3);

  // Crabs: eight at home round the pond, and the one that is never there.
  let home = 0;
  for (let n = 1; n <= 9; n++) {
    const lost = n === G.lostCrab;
    const [hx, hy, rock] = lost ? [0, 0, 0] : (CRAB_HOMES[home++] ?? [400, 300, 0]);
    crabs.push({
      n,
      hx,
      hy,
      x: hx,
      y: hy,
      tx: hx,
      wait: 1 + random() * 5,
      hop: 0,
      clack: 0,
      lost,
      hide: 0,
      bolt: 0,
      z: hy + (rock ? 8 : 0),
      perched: rock === 1,
    });
  }
  // Somewhere different every visit.
  hideCrab(Math.floor(Math.random() * HIDES.length));

  // Glints on the pond.
  while (glints.length < 26) {
    const x = 338 + random() * 126;
    const y = 262 + random() * 64;
    if (pondD(x, y) < -5) glints.push({ x: Math.round(x), y: Math.round(y), ph: random() * 6.28 });
  }

  // Strings of lights, slung between the shops, the gate and the great trunks.
  strung(150, 72, 172, 58, 5);
  strung(220, 54, 228, 50, 2);
  strung(222, 60, 290, 60, 9);
  strung(284, 50, 292, 54, 2);
  strung(340, 58, 350, 68, 3);
  strung(34, 190, 196, 232, 12);
  strung(406, 222, 486, 196, 9);
  strung(34, 250, 100, 262, 5);
}

function hideCrab(i: number): void {
  const c = crabs.find((k) => k.lost);
  const h = HIDES[i % HIDES.length];
  if (!c || !h) return;
  c.hide = i % HIDES.length;
  c.x = h[0];
  c.y = h[1];
  c.hx = h[0];
  c.hy = h[1];
  c.tx = h[0];
  c.z = h[2];
  c.bolt = 0;
}

function smoke(count: number): void {
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

/** Small things stir as the player goes by: flowers nod, crabs edge away, a lamp brightens. */
function brushPast(): void {
  const p = G.player;
  if (!p || !p.moving) return;
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
    if (c.lost || c.bolt > 0 || dist(c.x, c.y, p.x, p.y) > 18) continue;
    c.tx = c.hx + (c.hx >= p.x ? 1 : -1) * (c.perched ? 2 : 9);
    c.wait = 2.2;
  }
}
const lamps = new Map<Prop, Light>();

export function stepTown(dt: number): void {
  for (const l of lights) l.boost = Math.max(0, l.boost - dt * 1.4);
  brushPast();

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
      belt.fresh = Math.min(4, belt.fresh + 1);
      G.crates++;
      G.planks++;
      const q = G.quests[1];
      if (q && !q.claimed && q.have < q.need) {
        q.have++;
        if (q.have === q.need)
          hooks.feed("Your Works sent its fortieth plank down the belt. The board has something for you.", "coin");
      }
      changed();
      if (onScreen(466, 118)) {
        puff(466, 118, 3, EARTH[2]);
        if (G.home) sfx.pop();
      }
    }
  }

  // The banner.
  banner.flutter = Math.max(0, banner.flutter - dt * 0.5);
  if (banner.up !== banner.goal) {
    const d = banner.goal - banner.up;
    banner.up += Math.sign(d) * Math.min(Math.abs(d), dt * 0.75);
    if (banner.up === banner.goal && banner.next) {
      banner.name = banner.next;
      banner.next = "";
      banner.hue = G.lands % BANNERS.length;
      banner.goal = 1;
    } else if (banner.up === banner.goal && banner.goal === 1 && !banner.cheered) {
      banner.cheered = true;
      banner.ribbons = Math.min(5, banner.ribbons + 1);
      burst(banner.x + 8, banner.y - 64, 22, [GOLD[1], SKY[4], CREAM, SKY[5]], 60);
      sparkle(banner.x + 8, banner.y - 60, 10, 10);
    }
  }

  // Lanterns landing in the tree, and old ones adrift.
  for (const s of tree.slots) {
    if (s.lit && !s.landed && G.t - s.at > 0.9) {
      s.landed = true;
      s.from = null;
      sparkle(tree.x + s.dx, tree.y + s.dy + 4, 12, 6);
      if (G.home) sfx.bell();
    }
  }
  for (let i = tree.adrift.length - 1; i >= 0; i--) {
    const a = tree.adrift[i];
    if (!a) continue;
    a.life += dt;
    a.y -= dt * 11;
    a.x += Math.sin(a.life * 1.3) * dt * 5;
    if (a.life > 9) tree.adrift.splice(i, 1);
  }

  // Crabs.
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if (!call || G.t < call.at) continue;
    calls.splice(i, 1);
    const c = crabs.find((k) => k.n === call.n);
    if (!c) continue;
    if (c.lost) {
      sfx.cricket();
      float(400, 272, `No. ${c.n}?  ...`, SKY[5], 1.6);
    } else {
      c.hop = 0.3;
      c.clack = 0.35;
      sfx.clack();
      float(c.x, c.y - 10, `${c.n}`, CREAM, 0.9);
    }
  }
  for (const c of crabs) {
    c.hop = Math.max(0, c.hop - dt);
    c.clack = Math.max(0, c.clack - dt);
    if (c.bolt > 0) {
      // Found: it runs for the trees, and turns up somewhere else in a while.
      c.bolt += dt;
      c.x += (c.x < 256 ? -1 : 1) * 90 * dt;
      c.y -= 20 * dt;
      if (c.bolt > 5) hideCrab(c.hide + 1 + Math.floor(Math.random() * 3));
      continue;
    }
    if (c.lost) continue;
    c.wait -= dt;
    if (c.wait <= 0) {
      c.wait = 2.5 + Math.random() * 6;
      c.tx = c.hx + (Math.random() - 0.5) * (c.perched ? 4 : 12);
    }
    const d = c.tx - c.x;
    if (Math.abs(d) > 0.3) c.x += Math.sign(d) * Math.min(Math.abs(d), 12 * dt);
  }

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

// ---------- drawing the parts that move ----------

function flame(g: Ctx, x: number, y: number, w: number, h: number, col: string, ph: number): void {
  for (let r = 0; r < h; r++) {
    const k = r / h;
    const half = w * (1 - k) ** 0.8 * (0.85 + 0.15 * Math.sin(G.t * 17 + r * 0.9 + ph));
    const sway = Math.sin(G.t * 9 + r * 0.55 + ph) * k * 2.2;
    const x0 = Math.round(x + sway - half);
    const x1 = Math.round(x + sway + half);
    if (x1 > x0) R(g, x0, Math.round(y - r), x1 - x0, 1, col);
  }
}

function drawFire(g: Ctx, sx: number, sy: number): void {
  const b = fire.boost;
  const h = 11 + b * 8 + Math.sin(G.t * 13) * 1.2;
  flame(g, sx, sy - 5, 5.4 + b, h, SKY[5], 0);
  flame(g, sx, sy - 5, 3.6 + b * 0.6, h * 0.72, GOLD[1], 1.3);
  flame(g, sx, sy - 5, 1.8, h * 0.42, CREAM, 2.1);
}

function drawBelt(g: Ctx, sx: number, sy: number): void {
  if (!S) return;
  for (const lx of [2, 28, 52]) {
    R(g, sx + lx - 1, sy - 7, 4, 7, INK);
    R(g, sx + lx, sy - 7, 2, 6, STONE[0]);
  }
  R(g, sx - 1, sy - 15, 58, 10, INK);
  R(g, sx, sy - 14, 56, 6, "#3a2c40");
  for (let i = 0; i < 10; i++) R(g, sx + ((i * 6 + Math.floor(belt.off)) % 56), sy - 13, 1, 4, "#5c4a66");
  R(g, sx, sy - 14, 2, 6, STONE[2]);
  R(g, sx + 54, sy - 14, 2, 6, STONE[2]);
  R(g, sx, sy - 8, 56, 2, STONE[1]);
  R(g, sx, sy - 8, 56, 1, STONE[3]);
  const box = S.box;
  for (const at of belt.crates) {
    const jig = belt.boost > 0 ? Math.round(Math.sin(G.t * 30 + at) * 0.7) : 0;
    g.drawImage(box.c, sx + 1 + Math.round(at), sy - 21 + jig);
  }
  if (belt.fly >= 0) {
    const t = belt.fly;
    g.drawImage(box.c, sx + 51 + Math.round(t * 12), sy - 21 - Math.round(Math.sin(t * Math.PI) * 9 + t * 4));
  }
}

/** The banner's fly end is cut to a swallowtail, so its last columns are drawn as two tongues. */
function tongues(i: number): readonly (readonly [number, number])[] {
  const cut = i > 10 ? i - 10 : 0;
  return cut
    ? [
        [0, 11 - cut],
        [11 + cut, 22],
      ]
    : [[0, 22]];
}

function drawBanner(g: Ctx, sx: number, sy: number): void {
  if (banner.up <= 0.02) return;
  const [a, b] = BANNERS[banner.hue % BANNERS.length] ?? ["#000", "#000"];
  const top = sy - 68 + Math.round((1 - banner.up) * 44);
  const speed = 4 + banner.flutter * 7;
  const reach = 1.3 + banner.flutter * 2;
  const wave = (i: number): number => Math.round(Math.sin(G.t * speed - i * 0.55) * (i / 15) * reach);
  for (let i = 0; i < 16; i++)
    for (const [from, to] of tongues(i)) R(g, sx + 2 + i, top + wave(i) + from - 1, 2, to - from + 2, INK);
  for (let i = 0; i < 16; i++) {
    const y = top + wave(i);
    const lit = Math.cos(G.t * speed - i * 0.55) < 0.2;
    for (const [from, to] of tongues(i)) {
      R(g, sx + 2 + i, y + from, 1, to - from, lit ? a : b);
      R(g, sx + 2 + i, y + (from === 0 ? 0 : to - 1), 1, 1, GOLD[0]);
    }
  }
  const y = top + wave(5) + 8;
  R(g, sx + 6, y, 4, 6, GOLD[1]);
  R(g, sx + 5, y + 1, 6, 4, GOLD[1]);
  R(g, sx + 7, y + 2, 2, 2, CREAM);
  for (const [dx, dy] of [
    [2, -2],
    [2, 7],
    [-2, 2],
    [7, 2],
  ] as const)
    R(g, sx + 5 + dx, y + dy, 2, 1, GOLD[1]);
  // A streamer for every land taken tonight.
  for (let i = 1; i < banner.ribbons; i++) {
    const ry = top + 22 + i * 4;
    const [c] = BANNERS[(banner.hue + i) % BANNERS.length] ?? ["#000"];
    for (let k = 0; k < 7; k++) R(g, sx + 3 + k, ry + Math.round(Math.sin(G.t * 5 - k * 0.7 + i) * (k / 6)), 1, 2, c);
  }
}

function drawTreeLanterns(g: Ctx, sx: number, sy: number): void {
  if (!S) return;
  const shake = clamp(1 - (G.t - tree.shakeAt) / 0.9, 0, 1);
  for (const s of tree.slots) {
    if (!s.lit) continue;
    const pic = S.lanterns[s.col % S.lanterns.length];
    if (!pic) continue;
    let x = sx + s.dx;
    let y = sy + s.dy;
    const flying = clamp((G.t - s.at) / 0.9, 0, 1);
    if (s.from && flying < 1) {
      const e = 1 - (1 - flying) ** 3;
      x = Math.round(lerp(s.from.x - tree.x + sx, x, e));
      y = Math.round(lerp(s.from.y - tree.y + sy - 14, y, e) - Math.sin(flying * Math.PI) * 10);
    } else x += Math.round(Math.sin(G.t * 1.7 + s.dx) * 0.6 + Math.sin(G.t * 16 + s.dx) * shake * 2);
    g.drawImage(pic.c, x - pic.ax, y - pic.ay);
  }
}

/** Under the people: glints and rings on the water, rings on the ground. */
export function drawWater(g: Ctx, cx: number, cy: number): void {
  for (const q of glints) {
    const v = Math.sin(G.t * 1.2 + q.ph);
    if (v < 0.55) continue;
    const w = v > 0.85 ? 4 : 2;
    R(g, q.x - cx + Math.round(Math.sin(G.t * 0.5 + q.ph) * 2), q.y - cy, w, 1, v > 0.85 ? WATER[3] : WATER[2]);
  }
}

/** The crabs, as things to sort among the people. */
export function crabPic(c: Crab): HTMLCanvasElement | null {
  if (!S) return null;
  const moving = Math.abs(c.tx - c.x) > 0.3 || c.clack > 0 || c.bolt > 0;
  return (moving && Math.floor(G.t * 9) % 2 === 0 ? S.crab[1] : S.crab[0])?.c ?? null;
}

/** Over the people: the strings of lights. */
export function drawStrings(g: Ctx, cx: number, cy: number): void {
  for (const s of strings) {
    for (const p of s.wire) R(g, p.x - cx, p.y - cy, 1, 1, SKY[0]);
    for (const b of s.bulbs) R(g, b.x - cx, b.y - cy, 2, 2, SKY[0]);
  }
}

/** After dusk has been laid over the picture: everything that gives its own light. */
export function drawGlows(g: Ctx, cx: number, cy: number, glow: HTMLCanvasElement): void {
  if (!S) return;
  for (const s of strings) {
    s.bulbs.forEach((b, i) => {
      const wave = clamp(1 - Math.abs((G.t - s.chase) * 26 - i), 0, 1);
      const on = 0.62 + 0.38 * Math.sin(G.t * 1.6 + i * 1.9) + wave;
      R(g, b.x - cx, b.y - cy, 2, 2, wave > 0.3 ? CREAM : (BULBS[b.c] ?? CREAM));
      g.globalAlpha = clamp(0.16 * on + wave * 0.3, 0, 0.6);
      g.drawImage(glow, b.x - cx - 5, b.y - cy - 5, 12, 12);
      g.globalAlpha = 1;
    });
  }
  for (const a of tree.adrift) {
    const pic = S.lanterns[a.col % S.lanterns.length];
    if (!pic) continue;
    g.globalAlpha = clamp(1 - (a.life - 6) / 3, 0, 1);
    g.drawImage(pic.c, Math.round(a.x) - cx - pic.ax, Math.round(a.y) - cy - pic.ay);
    g.globalAlpha *= 0.35;
    g.drawImage(glow, Math.round(a.x) - cx - 12, Math.round(a.y) - cy - 8, 24, 24);
    g.globalAlpha = 1;
  }
}

const scratch: Light[] = [];
/** Every light there is this moment: the fixed ones, the fire, and each lantern in the tree. */
export function allLights(): Light[] {
  scratch.length = 0;
  for (const l of lights) scratch.push(l);
  fireLight.r = 64 + fire.boost * 16 + Math.sin(G.t * 11) * 2;
  fireLight.power = 1;
  fireLight.boost = fire.boost;
  scratch.push(fireLight);
  for (const s of tree.slots) {
    if (!s.lit || !s.landed) continue;
    scratch.push({ x: tree.x + s.dx, y: tree.y + s.dy + 5, r: 17, power: 0.75, boost: 0, phase: s.dx });
  }
  return scratch;
}

/** The thing under a point, nearest the eye first. */
export function propAt(wx: number, wy: number): Prop | null {
  let best: Prop | null = null;
  for (const p of props) {
    if (!p.hit || !p.tap) continue;
    const small = p.hit.w < 16;
    const pad = small ? 3 : 0;
    if (wx < p.hit.x - pad || wy < p.hit.y - pad || wx >= p.hit.x + p.hit.w + pad || wy >= p.hit.y + p.hit.h + pad)
      continue;
    if (!small && p.sprite && !solidAt(p.sprite, wx - p.hit.x, wy - p.hit.y)) continue;
    if (!best || p.z > best.z) best = p;
  }
  return best;
}

const masks = new Map<HTMLCanvasElement, Uint8ClampedArray>();
function solidAt(s: Sprite, x: number, y: number): boolean {
  let m = masks.get(s.c);
  if (!m) {
    const g = s.c.getContext("2d");
    if (!g) return true;
    m = g.getImageData(0, 0, s.c.width, s.c.height).data;
    masks.set(s.c, m);
  }
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= s.c.width || py >= s.c.height) return false;
  return (m[(py * s.c.width + px) * 4 + 3] ?? 0) > 40;
}
