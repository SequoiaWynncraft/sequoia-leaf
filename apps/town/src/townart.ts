/**
 * The town as it is drawn: built once from the sprites as the page loads (`buildTown`: the houses,
 * the stalls, the trees, everything standing, each with its touch from `town.ts`), and the parts
 * that move drawn each frame over it (the Works' door and belt, the fire, the banner, the lanterns
 * in the tree, the water, the strings of lights, the crabs). What the town does is `town.ts`.
 */

import { DAILY_CHEST } from "@sequoia-leaf/core";
import { BARK, CREAM, GOLD, INK, SKY, STONE, WATER } from "@sequoia-leaf/kit/palette.ts";
import { ell, R } from "@sequoia-leaf/kit/pix.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, type Ctx, dist, lerp } from "@sequoia-leaf/kit/util.ts";
import { LOST_CRAB } from "@sequoia-leaf/town/catalogue.ts";
import { BOARD, boardAt, seedOf, SET_OUT } from "@sequoia-leaf/town/clock.ts";
import { waiting } from "@sequoia-leaf/town/mail.ts";

import { unread } from "./board.ts";
import { flutter } from "./fx.ts";
import { G, SEED, today } from "./game.ts";
import { GROUND, paintTrunk } from "./ground.ts";
import { mine } from "./leaf.ts";
import { flame, type Light, type Standing } from "./props.ts";
import type { Sprites } from "./sprites.ts";
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
  CRAB_HOMES,
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
  random,
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
import { BUILDINGS, GROVE, pondD, POSTS, STALL_FEET, TALLY, TRUNKS, trunkTall, WORKS_BENCH } from "./world.ts";

let S: Sprites | null = null;

// ---------- building it ----------

function shadow(g: Ctx, x: number, y: number, rx: number, ry: number): void {
  ell(g, x - GROUND.x, y - GROUND.y, rx, ry, "rgba(20,10,28,0.3)");
}

export function buildTown(s: Sprites, ground: Ctx): void {
  S = s;

  // The enormous trunks: four across the back, two down each side.
  for (const t of TRUNKS) add("trunk", paintTrunk(t.hw, trunkTall(t), t.seed, 250), t.x, t.y, { tap: tapTrunk });

  // Treasury, with its counter a separate piece in front of where Cinfy stands.
  const TREASURY = tipOf("treasury");
  add("treasury", s.treasury, BUILDINGS.treasury.x, BUILDINGS.treasury.y, {
    z: 110,
    place: "treasury",
    tap: nudge,
    tip: TREASURY,
  });
  add("counter", s.counter, 81, 120, {
    place: "treasury",
    tip: TREASURY,
    tap: (p) => {
      ringBell();
      nudge(p);
    },
  });
  light(104, 104, 44, 0.95);
  light(71, 94, 20, 0.7);
  light(136, 94, 20, 0.7);
  add("chest", null, 160, 121, {
    hit: { x: 152, y: 107, w: 16, h: 15 },
    tap: tapChest,
    hops: true,
    tip: ["Cinfy's chest", `Tap it for ${DAILY_CHEST} Coins, once a day. The day starts at 00:00 UTC.`],
    extra: (g, sx, sy) => {
      const pic = G.t < chest.openUntil ? s.chestOpen : s.chest;
      g.drawImage(pic.c, sx - pic.ax, sy - pic.ay);
    },
  });
  add("barrel", s.barrel, 62, 124, { tap: tapStone, hops: true });
  add("barrel", s.barrel, 51, 122, { tap: tapStone, hops: true });

  // The Works: the shop, the belt out front, and the pile the belt feeds.
  add("works", s.works, BUILDINGS.works.x, BUILDINGS.works.y, {
    z: 118,
    place: "works",
    tip: tipOf("works"),
    tap: (p) => {
      smoke(8);
      sfx.clank();
      nudge(p);
    },
    extra: drawDoor,
  });
  doorLights.door = light(372, 106, 40, 1);
  light(430, 90, 20, 0.7);
  add("belt", null, 402, 134, {
    hit: { x: 400, y: 112, w: 60, h: 22 },
    tip: ["The belt", "Planks out of the Works. Tap to hurry it."],
    tap: (p) => {
      nudge(p);
      belt.boost = 2.5;
      sfx.clank();
    },
    extra: drawBelt,
  });
  add("pile", s.pile, 458, 135, {
    tip: ["Crates", ""],
    tap: (p) => {
      nudge(p);
      sfx.knock();
    },
    hops: true,
    extra: (g, sx, sy) => {
      for (let i = 0; i < belt.fresh; i++) g.drawImage(s.box.c, sx + 2 + (i % 2) * 8, sy - 26 - Math.floor(i / 2) * 6);
    },
  });

  // The gate out to the member's own camp, and the signpost that says so.
  const CAMP = tipOf("camp");
  add("gate", s.gate, BUILDINGS.gate.x, BUILDINGS.gate.y, { place: "camp", tap: nudge, tip: CAMP });
  light(237, 65, 24, 0.9);
  light(275, 65, 24, 0.9);
  light(256, 84, 34, 0.85); // the last of the sun, coming up the path
  add("signpost", s.signpost, 291, 106, {
    place: "camp",
    tap: nudge,
    hops: true,
    tip: CAMP,
    // Something is waiting at the camp: a letter, or a new thing in the tray.
    extra: (g, sx, sy) => {
      if (mine().fresh.length === 0 && waiting(mine().letters) === 0) return;
      const bob = Math.round(Math.sin(G.t * 4) * 1.5);
      g.drawImage(s.bang.c, sx - 1, sy - 37 + bob);
    },
  });

  // The Grove: a light hangs over its stone, where the pulls are made.
  add("grove", s.grove, GROVE.x, GROVE.y, {
    place: "grove",
    tip: tipOf("grove"),
    tap: (p) => {
      sfx.twinkle();
      nudge(p);
    },
    extra: (g, sx, sy) => {
      const y = sy - 26 + Math.round(Math.sin(G.t * 2.2) * 1.5);
      R(g, sx - 2, y, 5, 1, GOLD[2]);
      R(g, sx, y - 2, 1, 5, GOLD[2]);
      R(g, sx, y, 1, 1, CREAM);
    },
  });
  light(GROVE.x, GROVE.y - 26, 30, 0.9);

  add("board", s.board, 176, 160, {
    place: "quests",
    tip: tipOf("quests"),
    tap: (p) => {
      flutter(198, 140, 5, [CREAM, GOLD[2]], 12, 20);
      sfx.paper();
      nudge(p);
    },
    // A quest is ready to claim, or there is news the member has not opened.
    extra: (g, sx, sy) => {
      if (!unread()) return;
      const bob = Math.round(Math.sin(G.t * 4) * 1.5);
      g.drawImage(s.bang.c, sx + 20, sy - 56 + bob);
    },
  });
  // The Tally, where the town keeps count: a mark over it until the member has looked.
  add("board", tallyBoard(), TALLY.x, TALLY.y, {
    place: "tally",
    tip: tipOf("tally"),
    tap: (p) => {
      sfx.knock();
      nudge(p);
    },
    extra: (g, sx, sy) => {
      if (!tallyNew()) return;
      const bob = Math.round(Math.sin(G.t * 4) * 1.5);
      g.drawImage(s.bang.c, sx - 2, sy - 56 + bob);
    },
  });
  add("pole", s.pole, banner.x, banner.y, {
    tap: tapPole,
    extra: drawBanner,
    tip: ["Banner pole", "A banner goes up when the guild captures a territory."],
  });

  STALL_FEET.forEach(({ x, y }, i) => {
    const st = s.stalls[i];
    if (!st) return;
    add("stall", st, x, y, {
      place: "market",
      tip: tipOf("market"),
      tap: (p, _x, _y, own) => {
        sfx.pluck(2 + i * 2);
        if (own) G.stall = i;
        nudge(p);
      },
    });
    light(x + 12, y - 24, 34, 0.9);
    shadow(ground, x + 20, y + 1, 22, 3);
  });

  POSTS.forEach((p) => {
    const l = light(p.x + 8, p.y - 26, 36, 0.9);
    lamps.set(add("post", s.post, p.x, p.y, { tap: (q) => tapPost(q, l) }), l);
    shadow(ground, p.x + 1, p.y, 5, 2);
    if (dist(p.x, p.y, table.x, table.y) < 40) doorLights.table = l;
  });

  // The great stump with the guild's board game cut into it, and two logs to sit on.
  add("table", s.greatStump, table.x, table.y, {
    place: "table",
    tap: tapTable,
    extra: drawPieces,
    tip: tipOf("table"),
  });
  shadow(ground, table.x, table.y + 1, 24, 4);
  for (const x of [431, 457]) {
    add("seat", s.shortLog, x, 217, { tap: tapSeat });
    shadow(ground, x, 218, 8, 2);
  }

  add("tree", s.tree, tree.x, tree.y, {
    tap: tapTree,
    extra: drawTreeLanterns,
    tip: ["Lantern tree", "One lantern for every raid today."],
  });
  shadow(ground, tree.x, tree.y + 2, 24, 6);

  // The fire and its seats.
  add("fire", s.fireRing, 256, 217, {
    place: "fire",
    tip: tipOf("fire"),
    tap: (p) => {
      flare();
      nudge(p);
    },
    hit: { x: 244, y: 196, w: 24, h: 24 },
    extra: drawFire,
  });
  add("seat", s.log, 256, 200, { tap: tapSeat });
  add("seat", s.log, 256, 240, { tap: tapSeat });
  add("seat", s.stump, 220, 216, { tap: tapSeat });
  add("seat", s.stump, 292, 216, { tap: tapSeat });
  add("seat", s.bench, 120, 312, { tap: tapSeat });
  add("seat", s.bench, WORKS_BENCH.x, WORKS_BENCH.y, { tap: tapSeat });
  shadow(ground, 256, 201, 18, 3);
  shadow(ground, 256, 241, 18, 3);
  shadow(ground, 120, 313, 15, 2);
  shadow(ground, WORKS_BENCH.x, WORKS_BENCH.y + 1, 15, 2);

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
    [470, 158, 2],
    [470, 240, 1],
    [300, 316, 0],
    [356, 334, 2],
    [40, 196, 0],
    [128, 210, 2],
    [214, 328, 1],
  ] as const)
    patch(x, y, k);
  for (const [x, y, k] of [
    [46, 158, 1],
    [404, 172, 0],
    [476, 176, 2],
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
    const lost = n === LOST_CRAB;
    const [hx, hy, rock] = lost ? [0, 0, 0] : (CRAB_HOMES[home++] ?? [400, 300, 0]);
    crabs.push({
      n,
      hx,
      hy,
      x: hx,
      y: hy,
      aside: 0,
      shyTo: hx,
      shyUntil: 0,
      moving: false,
      hop: 0,
      clack: 0,
      lost,
      bolt: 0,
      z: hy + (rock ? 8 : 0),
      perched: rock === 1,
    });
  }
  placeCrabs();

  // Glints on the pond.
  while (glints.length < 26) {
    const x = 338 + random() * 126;
    const y = 262 + random() * 64;
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
