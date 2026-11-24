/**
 * The town as it is drawn: built once from the map's pieces as the page loads (`buildTown`: the
 * houses, the stalls, the trees, everything standing, each with its touch from `town.ts`), and the
 * parts that move drawn each frame over it (the Works' door and belt, the fire, the banner, the
 * lanterns in the tree, the water, the strings of lights, the crabs). Where everything stands is the
 * map's (`@sequoia-leaf/town/map`); what the town does is `town.ts`.
 */

import { DAILY_CHEST, type Thing } from "@sequoia-leaf/core";
import { BARK, CREAM, GOLD, INK, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, lerp, type Rect, rng } from "@sequoia-leaf/kit/util.ts";
import { LOST_CRAB } from "@sequoia-leaf/town/catalogue.ts";
import { BOARD, boardAt, seedOf, SET_OUT } from "@sequoia-leaf/town/clock.ts";
import { waiting } from "@sequoia-leaf/town/mail.ts";
import { type FlatKind, isFlat, type StandingKind } from "@sequoia-leaf/town/map/kinds.ts";
import { CRAB_HOMES, GLINTS, KEEPERS, LIGHTS, type Piece, PIECES, pondD, SHADOWS } from "@sequoia-leaf/town/map/map.ts";
import type { PlaceId } from "@sequoia-leaf/town/map/rows.ts";

import { unread } from "./board.ts";
import { flutter } from "./fx.ts";
import { G, SEED, today } from "./game.ts";
import { GROUND, paintTrunk, TRUNKS, trunkTall } from "./ground.ts";
import { mine } from "./leaf.ts";
import { flame, type Light, type Prop, type Standing } from "./props.ts";
import type { Sprite, Sprites } from "./sprites.ts";
import { tallyNew } from "./tally.ts";
import { tallyBoard } from "./tallyart.ts";
import {
  add,
  banner,
  BANNERS,
  belt,
  BOLT,
  BULBS,
  chest,
  type Crab,
  crabs,
  door,
  doorLights,
  DRIFT,
  fire,
  fireLight,
  flare,
  flown,
  glints,
  lamps,
  lanterns,
  light,
  lights,
  nudge,
  placeCrabs,
  ringBell,
  RISE,
  SLOTS,
  smoke,
  strings,
  table,
  tapChest,
  tapFlower,
  tapLeafy,
  tapMushroom,
  tapPole,
  tapPost,
  tapSeat,
  tapStone,
  tapTable,
  tapTree,
  tapTrunk,
  tipOf,
  tree,
} from "./town.ts";

let S: Sprites | null = null;

// ---------- building it ----------

/**
 * What the page makes of a kind of piece that stands: what a touch on it is called (core's
 * `THINGS`), its picture (none for one drawn wholly by `extra`), where it sorts among the people
 * from its foot (`z`), the box a touch finds it in where that is not its picture (`hit`, from its
 * anchor), whether it hops when touched, the place whose door it is part of, what it says to
 * whoever points at it, what it does when touched, and anything drawn over it each frame.
 */
interface Part {
  thing: Thing;
  sprite: (s: Sprites, p: Piece) => Sprite | null;
  z?: number;
  hit?: Rect;
  hops?: true;
  place?: PlaceId;
  tip?: readonly [string, string];
  tap?: (q: Prop, x: number, y: number, own: boolean, p: Piece) => void;
  extra?: (g: Ctx, sx: number, sy: number) => void;
}

const PETALS = [SKY[4], CREAM, GOLD[1]] as const;
const SHADE = "rgba(20,10,28,0.3)";
/** How wide each look of a shop's strip of shade is: the Treasury's, the Works'. */
const SHADE_W = [96, 104] as const;

/** A "!" bobbing over a piece, at `dx`, `dy` from its foot, while `when` says so. */
const bang =
  (dx: number, dy: number, when: () => boolean) =>
  (g: Ctx, sx: number, sy: number): void => {
    if (!S || !when()) return;
    g.drawImage(S.bang.c, sx + dx, sy + dy + Math.round(Math.sin(G.t * 4) * 1.5));
  };

/** A stall's number in the catalogue, by its piece. */
const stallOf = (p: Piece): number => KEEPERS.stalls.findIndex((k) => k.piece === p.id);

/** A trunk, painted from its foot to well past the top of the map. */
const trunkPicture = (_s: Sprites, p: Piece): Sprite | null => {
  const t = TRUNKS[p.look];
  return t ? paintTrunk(t.hw, trunkTall(p.y), t.seed, 250) : null;
};

const TREASURY = tipOf("treasury");
const CAMP = tipOf("camp");
const seat = (pic: (s: Sprites) => Sprite): Part => ({ thing: "seat", sprite: pic, tap: tapSeat });

/** Every kind that stands, and what the page makes of it. */
const PARTS: Readonly<Record<StandingKind, Part>> = {
  trunk: { thing: "trunk", sprite: trunkPicture, tap: tapTrunk },
  treasury: { thing: "treasury", sprite: (s) => s.treasury, z: -10, place: "treasury", tap: nudge, tip: TREASURY },
  counter: {
    thing: "counter",
    sprite: (s) => s.counter,
    place: "treasury",
    tip: TREASURY,
    tap: (q) => {
      ringBell(q);
      nudge(q);
    },
  },
  chest: {
    thing: "chest",
    sprite: () => null,
    hit: { x: -8, y: -14, w: 16, h: 15 },
    tap: tapChest,
    hops: true,
    tip: ["Cinfy's chest", `Tap it for ${DAILY_CHEST} Coins, once a day. The day starts at 00:00 UTC.`],
    extra: (g, sx, sy) => {
      if (!S) return;
      const pic = G.t < chest.openUntil ? S.chestOpen : S.chest;
      g.drawImage(pic.c, sx - pic.ax, sy - pic.ay);
    },
  },
  barrel: { thing: "barrel", sprite: (s) => s.barrel, tap: tapStone, hops: true },
  works: {
    thing: "works",
    sprite: (s) => s.works,
    z: -2,
    place: "works",
    tip: tipOf("works"),
    tap: (q) => {
      smoke(8);
      sfx.clank();
      nudge(q);
    },
    extra: drawDoor,
  },
  belt: {
    thing: "belt",
    sprite: () => null,
    hit: { x: -2, y: -22, w: 60, h: 22 },
    tip: ["The belt", "Planks out of the Works. Tap to hurry it."],
    tap: (q) => {
      nudge(q);
      belt.boost = 2.5;
      sfx.clank();
    },
    extra: drawBelt,
  },
  pile: {
    thing: "pile",
    sprite: (s) => s.pile,
    tip: ["Crates", ""],
    tap: (q) => {
      nudge(q);
      sfx.knock();
    },
    hops: true,
    extra: (g, sx, sy) => {
      const box = S?.box;
      if (!box) return;
      for (let i = 0; i < belt.fresh; i++) g.drawImage(box.c, sx + 2 + (i % 2) * 8, sy - 26 - Math.floor(i / 2) * 6);
    },
  },
  gate: { thing: "gate", sprite: (s) => s.gate, place: "camp", tap: nudge, tip: CAMP },
  // Something is waiting at the camp: a letter, or a new thing in the tray.
  signpost: {
    thing: "signpost",
    sprite: (s) => s.signpost,
    place: "camp",
    tap: nudge,
    hops: true,
    tip: CAMP,
    extra: bang(-1, -37, () => mine().fresh.length > 0 || waiting(mine().letters) > 0),
  },
  // A light hangs over the stone, where the pulls are made.
  grove: {
    thing: "grove",
    sprite: (s) => s.grove,
    place: "grove",
    tip: tipOf("grove"),
    tap: (q) => {
      sfx.twinkle();
      nudge(q);
    },
    extra: (g, sx, sy) => {
      const y = sy - 26 + Math.round(Math.sin(G.t * 2.2) * 1.5);
      R(g, sx - 2, y, 5, 1, GOLD[2]);
      R(g, sx, y - 2, 1, 5, GOLD[2]);
      R(g, sx, y, 1, 1, CREAM);
    },
  },
  // A quest is ready to claim, or there is news the member has not opened.
  "quest-board": {
    thing: "board",
    sprite: (s) => s.board,
    place: "quests",
    tip: tipOf("quests"),
    tap: (q) => {
      flutter(q.x + 22, q.y - 20, 5, [CREAM, GOLD[2]], 12, 20);
      sfx.paper();
      nudge(q);
    },
    extra: bang(20, -56, unread),
  },
  // The Tally, where the town keeps count: a mark over it until the member has looked.
  tally: {
    thing: "board",
    sprite: () => tallyBoard(),
    place: "tally",
    tip: tipOf("tally"),
    tap: (q) => {
      sfx.knock();
      nudge(q);
    },
    extra: bang(-2, -56, tallyNew),
  },
  "banner-pole": {
    thing: "pole",
    sprite: (s) => s.pole,
    tap: tapPole,
    extra: drawBanner,
    tip: ["Banner pole", "A banner goes up when the guild captures a territory."],
  },
  stall: {
    thing: "stall",
    sprite: (s, p) => s.stalls[p.look] ?? null,
    place: "market",
    tip: tipOf("market"),
    tap: (q, _x, _y, own, p) => {
      sfx.pluck(2 + stallOf(p) * 2);
      if (own) G.stall = stallOf(p);
      nudge(q);
    },
  },
  post: {
    thing: "post",
    sprite: (s) => s.post,
    tap: (q) => {
      const l = lamps.get(q);
      if (l) tapPost(q, l);
    },
  },
  "great-stump": {
    thing: "table",
    sprite: (s) => s.greatStump,
    place: "table",
    tap: tapTable,
    extra: drawPieces,
    tip: tipOf("table"),
  },
  "short-log": seat((s) => s.shortLog),
  "lantern-tree": {
    thing: "tree",
    sprite: (s) => s.tree,
    tap: tapTree,
    extra: drawTreeLanterns,
    tip: ["Lantern tree", "One lantern for every raid today."],
  },
  fire: {
    thing: "fire",
    sprite: (s) => s.fireRing,
    place: "fire",
    tip: tipOf("fire"),
    tap: (q) => {
      flare();
      nudge(q);
    },
    hit: { x: -12, y: -21, w: 24, h: 24 },
    extra: drawFire,
  },
  log: seat((s) => s.log),
  stump: seat((s) => s.stump),
  bench: seat((s) => s.bench),
  mushroom: {
    thing: "mushroom",
    sprite: (s, p) => (p.look === 1 ? s.mushroom : s.mushlet),
    tap: tapMushroom,
    hops: true,
  },
  flower: {
    thing: "flower",
    sprite: (s, p) => s.flowers[p.look] ?? null,
    tap: (q, _x, _y, _own, p) => tapFlower(q, PETALS[p.look] ?? CREAM),
    hops: true,
  },
  bush: { thing: "bush", sprite: (s, p) => s.bushes[p.look] ?? null, tap: tapLeafy },
  fern: { thing: "fern", sprite: (s, p) => s.ferns[p.look] ?? null, tap: tapLeafy },
  rock: { thing: "rock", sprite: (s, p) => s.rocks[p.look] ?? null, tap: tapStone, hops: true },
  reeds: { thing: "reeds", sprite: (s) => s.reeds, tap: tapLeafy },
};

/** Every kind painted on the ground, and how; the pond's middle is only a point to fix things to. */
const FLATS: Readonly<Record<FlatKind, (g: Ctx, s: Sprites, p: Piece) => void>> = {
  lily(g, s, p) {
    const pic = p.look === 1 ? s.lilyBloom : s.lily;
    g.drawImage(pic.c, p.x - pic.ax - GROUND.x, p.y - pic.ay - GROUND.y);
  },
  shade(g, _s, p) {
    g.fillStyle = SHADE;
    g.fillRect(p.x - GROUND.x, p.y - GROUND.y, SHADE_W[p.look] ?? 0, 3);
  },
  pond: () => undefined,
};

/** A piece that stands, as a prop: its part's picture, touch and the rest, put at the piece's anchor. */
function propOf(s: Sprites, part: Part, p: Piece): Prop {
  const { tap, hit } = part;
  return add(part.thing, part.sprite(s, p), p.x, p.y, {
    z: p.y + (part.z ?? 0),
    place: part.place ?? null,
    tip: part.tip ?? null,
    hops: part.hops ?? false,
    extra: part.extra ?? null,
    tap: tap ? (q, x, y, own) => tap(q, x, y, own, p) : null,
    ...(hit ? { hit: { x: p.x + hit.x, y: p.y + hit.y, w: hit.w, h: hit.h } } : {}),
  });
}

/**
 * The town, from the map: a prop for each piece that stands, in the map's order, with the lights it
 * gives (the fire's flame is `fireLight`, which flickers with it); then every shadow, and what is
 * painted on the ground; then the crabs at home and the glints on the pond.
 */
export function buildTown(s: Sprites, ground: Ctx): void {
  S = s;
  const named = new Map<string, Light>();
  for (const p of PIECES) {
    if (isFlat(p.kind)) continue;
    const prop = propOf(s, PARTS[p.kind], p);
    // The fire's flame is `fireLight`; each other light flickers by its own id, so that adding or moving a row changes no other lamp.
    for (const l of LIGHTS.filter((q) => q.piece === p.id && q.name !== "flame")) {
      const lit = light(l.x, l.y, l.r, l.power, (seedOf(l.id) / 2 ** 32) * 6.28);
      if (l.name === "lamp") lamps.set(prop, lit);
      if (l.name) named.set(l.id, lit);
    }
  }
  doorLights.door = named.get("works:door") ?? null;
  doorLights.table = named.get("post-stump:lamp") ?? null;
  for (const sh of SHADOWS) ell(ground, sh.x - GROUND.x, sh.y - GROUND.y, sh.rx, sh.ry, SHADE);
  for (const p of PIECES) if (isFlat(p.kind)) FLATS[p.kind](ground, s, p);

  // Crabs: eight at home round the pond, and the one that is never there (and has no home).
  let home = 0;
  for (let n = 1; n <= 9; n++) {
    const lost = n === LOST_CRAB;
    const at = (lost ? null : CRAB_HOMES[home++]) ?? { x: 0, y: 0, perched: false };
    crabs.push({
      n,
      hx: at.x,
      hy: at.y,
      x: at.x,
      y: at.y,
      aside: 0,
      shyTo: at.x,
      shyUntil: 0,
      moving: false,
      hop: 0,
      clack: 0,
      lost,
      bolt: 0,
      z: at.y + (at.perched ? 8 : 0),
      perched: at.perched,
    });
  }
  placeCrabs();

  // Glints on the pond, from a stream of their own, looked for a fixed number of times: a glint box
  // off the water leaves it plain.
  const random = rng(20261120);
  for (let tries = 0; glints.length < 26 && tries < 1000; tries++) {
    const x = GLINTS.x + random() * GLINTS.w;
    const y = GLINTS.y + random() * GLINTS.h;
    if (pondD(x, y) < -5) glints.push({ x: Math.round(x), y: Math.round(y), ph: random() * 6.28 });
  }
}

// ---------- drawing the parts that move ----------

/** Light through the Works' doorway as its inner doors part, from the middle outwards. */
function drawDoor(g: Ctx, sx: number, sy: number): void {
  if (door.open <= 0.02) return;
  const half = Math.round(13 * door.open);
  for (let py = 63; py < 98; py++) {
    const inset = py === 63 ? 5 : py === 64 ? 3 : py === 65 ? 2 : py < 68 ? 1 : 0;
    const x0 = Math.max(16 + inset, 29 - half);
    const x1 = Math.min(42 - inset, 29 + half);
    if (x1 <= x0) continue;
    R(g, sx + x0, sy - 98 + py, x1 - x0, 1, py > 92 ? GOLD[1] : GOLD[2]);
    const core = Math.round(half * 0.5);
    if (core > 0 && py > 66 && py < 93) R(g, sx + 29 - core, sy - 98 + py, core * 2, 1, CREAM);
  }
  // The doors themselves, pushed back against the jambs.
  if (half > 2) {
    R(g, sx + Math.max(16, 29 - half - 2), sy - 98 + 68, 2, 30, BARK[1]);
    R(g, sx + Math.min(40, 29 + half), sy - 98 + 68, 2, 30, BARK[1]);
  }
}

/** The carved figures on the stump's board, each on its hex: the one the clock is moving on its way, and all of them in the air for a knock. */
function drawPieces(g: Ctx, sx: number, sy: number): void {
  if (!S) return;
  const jump = (G.t - table.jumpAt) / 0.3;
  const { on, moved } = table.played ? boardAt(SEED, G.now) : { on: SET_OUT, moved: null };
  on.forEach((cell, i) => {
    const pic = S?.pieces[i % (S?.pieces.length ?? 1)];
    const to = BOARD[cell];
    if (!pic || !to) return;
    const k = moved?.piece === i ? (G.now - moved.at) / 300 : 1;
    const from = (moved && k < 1 && BOARD[moved.from]) || to;
    const x = lerp(from[0], to[0], k);
    const y = lerp(from[1], to[1], k);
    const up = Math.max(
      k < 1 ? Math.sin(k * Math.PI) * 3 : 0,
      jump < 1 ? Math.abs(Math.sin(jump * Math.PI)) * (2 + (i % 2)) : 0,
    );
    g.drawImage(pic, sx - 24 + Math.round(x) - 1, sy - 32 + Math.round(y - up) - 5);
  });
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
  const flag = flown();
  if (!flag || flag.up <= 0.02) return;
  // Each territory has its own colours, and there is a streamer for every land fought for today.
  const hue = seedOf(flag.land) % BANNERS.length;
  const ribbons = Math.min(5, today("war").n);
  const [a, b] = BANNERS[hue] ?? ["#000", "#000"];
  const top = sy - 68 + Math.round((1 - flag.up) * 44);
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
  for (let i = 1; i < ribbons; i++) {
    const ry = top + 22 + i * 4;
    const [c] = BANNERS[(hue + i) % BANNERS.length] ?? ["#000"];
    for (let k = 0; k < 7; k++) R(g, sx + 3 + k, ry + Math.round(Math.sin(G.t * 5 - k * 0.7 + i) * (k / 6)), 1, 2, c);
  }
}

function drawTreeLanterns(g: Ctx, sx: number, sy: number): void {
  if (!S) return;
  const shake = clamp(1 - (G.t - tree.shakeAt) / 0.9, 0, 1);
  for (const l of lanterns()) {
    const pic = S.lanterns[(l.n % SLOTS.length) % S.lanterns.length];
    if (!pic) continue;
    let x = sx + l.at.x;
    let y = sy + l.at.y;
    const flying = (G.now - l.hung) / RISE;
    if (flying < 1) {
      // Up from the hands of whoever hung it, beside the tree.
      const e = 1 - (1 - flying) ** 3;
      x = Math.round(lerp(sx - 8, x, e));
      y = Math.round(lerp(sy - 8, y, e) - Math.sin(flying * Math.PI) * 10);
    } else x += Math.round(Math.sin(G.t * 1.7 + l.at.x) * 0.6 + Math.sin(G.t * 16 + l.at.x) * shake * 2);
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

function crabPic(c: Crab): HTMLCanvasElement | null {
  if (!S) return null;
  const moving = c.moving || c.clack > 0 || c.bolt > 0;
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
  // A lantern let go to make room for a newer one drifts up through the canopy.
  for (const l of lanterns()) {
    const life = (G.now - l.hung) / 1000;
    const pic = S.lanterns[(l.n % SLOTS.length) % S.lanterns.length];
    if (!pic || l.n < SLOTS.length || life * 1000 >= DRIFT) continue;
    const x = Math.round(tree.x + l.at.x + (5 / 1.3) * (1 - Math.cos(life * 1.3))) - cx;
    const y = Math.round(tree.y + l.at.y + 4 - life * 11) - cy;
    g.globalAlpha = clamp(1 - (life - 6) / 3, 0, 1);
    g.drawImage(pic.c, x - pic.ax, y - pic.ay);
    g.globalAlpha *= 0.35;
    g.drawImage(glow, x - 12, y - 8, 24, 24);
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
  for (const l of lanterns()) {
    if (G.now - l.hung < RISE) continue;
    scratch.push({ x: tree.x + l.at.x, y: tree.y + l.at.y + 5, r: 17, power: 0.75, boost: 0, phase: l.at.x });
  }
  return scratch;
}

/** The thing under a point, nearest the eye first. */
/** A crab, drawn where it is: hopping, running off, or up to its middle in the pond. */
function paintCrab(g: Ctx, c: Crab, cx: number, cy: number): void {
  const pic = crabPic(c);
  if (!pic) return;
  const up = c.hop > 0 ? Math.abs(Math.sin((1 - c.hop / 0.3) * Math.PI)) * 4 : 0;
  // A crab in the water shows only its top half.
  const wet = !c.lost && !c.perched && pondD(c.x, c.y) < -3;
  g.globalAlpha = clamp(1 - c.bolt / BOLT, 0, 1);
  if (wet && up === 0)
    g.drawImage(pic, 0, 0, pic.width, 5, Math.round(c.x) - 5 - cx, Math.round(c.y) - 7 - cy, pic.width, 5);
  else g.drawImage(pic, Math.round(c.x) - 5 - cx, Math.round(c.y - up) - 7 - cy);
  g.globalAlpha = 1;
}

/** The crabs, as things to sort among the people. */
export function crabsStanding(): Standing[] {
  return crabs.map((c) => ({
    get z(): number {
      return c.z;
    },
    paint(g: Ctx, cx: number, cy: number): void {
      paintCrab(g, c, cx, cy);
    },
  }));
}
