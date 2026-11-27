import {
  BARK,
  CORAL,
  CREAM,
  EARTH,
  GOLD,
  GREEN,
  INK,
  LEAF,
  PAPER,
  SKY,
  STONE,
  WATER,
} from "@sequoia-leaf/kit/palette.ts";
/**
 * What a fight leaves on the board, drawn: the things thrown, as they fly; the mark each ability
 * leaves where it goes off (`MARKS`, one for each in `looks.ts`); and the puff a figure goes in
 * when it falls. Small and in the town's colours, with the dark edge on anything that is a thing;
 * none of it lasts more than about half a second, and none of it covers the board.
 */
import { bitmap, outlined, R } from "@sequoia-leaf/kit/pix.ts";
import { clamp, type Ctx, lerp } from "@sequoia-leaf/kit/util.ts";

import { lightRow } from "./fightmarks.ts";
import { burst, motes, pop, ring, streak } from "./fx.ts";
import type { Pt } from "./geometry.ts";
import { leave } from "./litter.ts";
import type { MarkId, Puff, Thrown } from "./looks.ts";
import { V } from "./stage.ts";

const UP = -Math.PI / 2;
const CRAB = "#b0483a";

/** The letters the small pictures are typed in. */
const INKS: Readonly<Record<string, string>> = {
  c: CREAM,
  p: PAPER[1],
  P: PAPER[0],
  g: GOLD[1],
  G: GOLD[2],
  o: CORAL,
  r: SKY[4],
  b: BARK[2],
  B: BARK[4],
  e: EARTH[1],
  E: EARTH[2],
  s: STONE[2],
  S: STONE[3],
  w: WATER[2],
  W: WATER[3],
  m: GREEN[3],
  M: GREEN[4],
  l: LEAF,
  k: CRAB,
};
/** Each small picture as rows of letters; each gets the dark edge. */
const ROWS = {
  cushion: [".ppppp.", "pcccccp", "pccpccp", "pcccccp", ".ppppp."],
  tea: ["cccc.", "cBBcc", "cccc.", ".cc.."],
  plaster: ["ppccpp", "ppccpp"],
  cone: [".B.", "bBb", "BbB", ".b."],
  drop: [".W.", "wWw", "www", ".w."],
  pebble: ["sS", "ss"],
  seed: ["Ee"],
  spark: ["G", "o"],
  spoon: ["l", "M"],
  runner: ["eEe"],
  snip: ["c...c", ".c.c.", "..c.."],
  scribble: ["o.o.o", ".o.o."],
  chevron: [".o.", "o.o"],
  dots: ["c.c.c"],
  swipe: ["..cc", ".c..", "c..."],
  glint: [".G.", "GcG", ".G."],
  wisp: ["S.", ".S", "S."],
  // Peep's hat, the top of its shell, its broken rim down.
  cap: [".ccc.", "ccccp", "c.c.p"],
  egg: [".cc.", "cccp", "cccp", ".pp."],
  // A bite: the arch of teeth Munch leaves, two pixels thick (a Fang's crescent, drawn at the target).
  bite: [".ccc.", "cc.cc", "c...c"],
  // A note rising over a friend given mana (Chorus).
  note: [".g", ".g", "gg"],
  // Larp's snowball, shaded on its underside.
  snowball: [".cc.", "cccW", ".WW."],
} as const satisfies Record<string, readonly string[]>;
type Art = keyof typeof ROWS;

const baked = new Map<Art, HTMLCanvasElement>();
/** One of the small pictures, edged, made the first time it is asked for. */
function art(name: Art): HTMLCanvasElement {
  let c = baked.get(name);
  if (!c) {
    c = outlined(bitmap(ROWS[name], INKS), INK);
    baked.set(name, c);
  }
  return c;
}

// ---------- things thrown ----------

/** Something thrown, flying on the fight's clock from `t0` for `dur` steps; at whoever it is thrown at (`target`, followed as they move), else to `to`. */
export interface Shot {
  from: Pt;
  to: Pt;
  target: number;
  t0: number;
  dur: number;
  arc: number;
  /** An ability's own thing, or (null) the small thing an attack throws, of `col`, with a streak behind it if `trail`. */
  look: Thrown | null;
  col: string;
  trail: boolean;
  /** What is seen where it lands. */
  land: (() => void) | null;
}

/** How high a thrown thing arcs over a distance in pixels: lobbed things high, a beam not at all. */
export function arcOf(look: Thrown | null, far: number): number {
  if (look === "beam" || look === "runner" || look === "bolt") return 0;
  if (
    look === "cone" ||
    look === "cushion" ||
    look === "tea" ||
    look === "plaster" ||
    look === "spoon" ||
    look === "cap" ||
    look === "snowball"
  )
    return 6 + far * 0.18;
  if (look === "egg") return 2;
  return look === "pebble" ? 3 + far * 0.06 : 3;
}

const pointAt = (s: Shot, k: number): Pt => ({
  x: V.bx + lerp(s.from.x, s.to.x, k),
  y: V.by + lerp(s.from.y, s.to.y, k) - Math.sin(k * Math.PI) * s.arc,
});

function swirl(g: Ctx, x: number, y: number, c: number, cols: readonly string[]): void {
  for (let i = 0; i < 5; i++)
    R(
      g,
      x + Math.round(Math.sin(c * 2 + i * 2) * 3),
      y + Math.round(Math.cos(c * 1.7 + i) * 2),
      1,
      1,
      cols[i % 2] ?? CREAM,
    );
}

/** Draws something in flight at the fight's clock `c`. */
export function drawShot(g: Ctx, s: Shot, c: number): void {
  const k = clamp((c - s.t0) / s.dur, 0, 1);
  if (c < s.t0) return;
  const p = pointAt(s, k);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  // A Slinger's thing has its shadow on the board under it as it flies.
  if (s.look === "cap" || s.look === "snowball") {
    g.globalAlpha = 0.3;
    R(g, Math.round(V.bx + lerp(s.from.x, s.to.x, k)) - 2, Math.round(V.by + lerp(s.from.y, s.to.y, k)) + 8, 5, 1, INK);
    g.globalAlpha = 1;
  }
  // A streak behind it for some.
  if (s.trail || s.look === "beam")
    for (let i = 1; i <= 3; i++) {
      const q = pointAt(s, clamp(k - i * 0.07, 0, 1));
      R(g, Math.round(q.x), Math.round(q.y), 1, 1, s.look === "beam" ? GOLD[1] : s.col);
    }
  if (s.look === null || s.look === "beam") {
    // A small edged thing.
    R(g, x - 1, y - 1, 3, 3, INK);
    R(g, x, y, 1, 1, s.look === "beam" ? GOLD[2] : s.col);
  } else if (s.look === "bolt") {
    // A cross of its thrower's colour with a bright middle.
    R(g, x - 2, y - 1, 5, 3, INK);
    R(g, x - 1, y - 2, 3, 5, INK);
    R(g, x - 1, y, 3, 1, s.col);
    R(g, x, y - 1, 1, 3, s.col);
    R(g, x, y, 1, 1, GOLD[2]);
  } else if (s.look === "dust") swirl(g, x, y, c, [CREAM, WATER[3]]);
  else if (s.look === "gust") swirl(g, x, y, c * 1.6, [CREAM, WATER[3]]);
  else {
    const pic = art(s.look);
    g.drawImage(pic, Math.round(x - pic.width / 2), Math.round(y - pic.height / 2));
  }
}

// ---------- where abilities go off ----------

/** Where an ability goes off: a spot (feet, or a hex) and how tall whoever stands there is; who used it, the hexes it covered and who it was for; its owner's colour. */
export interface At {
  readonly x: number;
  readonly y: number;
  readonly tall: number;
  readonly from: Pt;
  readonly cells: readonly Pt[];
  /** Where each figure it is for stands. */
  readonly hit: readonly Pt[];
  readonly col: string;
  /** Its owner's own colours (`livery.ts`). */
  readonly own: readonly string[];
  /** Whether whoever it lands on holds anything (shiny, to a magpie). */
  readonly shiny: boolean;
}

/** Earth thrown out flat all round a spot, as far as `r`. */
function dustRing(x: number, y: number, r: number, cols: readonly string[]): void {
  ring(x, y, r, cols[0] ?? PAPER[1], 0.45);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    burst(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.3, 1, cols, {
      toward: a,
      spread: 0.3,
      speed: r * 2.2,
      grav: 0,
      ttl: 0.4,
      above: false,
    });
  }
}
const chest = (m: At): Pt => ({ x: m.x, y: m.y - Math.round(m.tall / 2) });
const head = (m: At): Pt => ({ x: m.x, y: m.y - m.tall - 3 });
const away = (m: At): number => Math.atan2(m.y - m.from.y, m.x - m.from.x);

/** Flakes of snow coming down onto a spot from above it. */
const snowOn = (p: Pt, n: number): void =>
  burst(p.x, p.y - 22, n, [CREAM, WATER[3]], { toward: -UP, spread: 0.5, speed: 12, grav: 30, ttl: 0.7, scatter: 8 });

/** Each ability's mark, by the name `looks.ts` gives it. */
export const MARKS: Readonly<Record<MarkId, (m: At) => void>> = {
  spark: (m) => {
    for (const c of m.hit)
      burst(c.x, c.y - 6, 4, [CORAL, GOLD[1], GOLD[2]], { speed: 24, grav: -30, ttl: 0.35, toward: UP, spread: 1.2 });
  },
  cushion: (m) => {
    pop(art("cushion"), m.x, head(m).y, "plump", 0.45);
    motes(m.x, m.y - 6, 3, [GREEN[4], LEAF]);
  },
  dust: (m) => {
    ring(m.x, m.y, 18, WATER[3], 0.4);
    burst(m.x, m.y - 8, 14, [WATER[3], CREAM], { speed: 16, grav: -6, ttl: 0.55, scatter: 16 });
  },
  surface: (m) => {
    burst(m.x, m.y, 12, [EARTH[0], EARTH[1], EARTH[2]], { speed: 42, ttl: 0.45, toward: UP, spread: 1.6 });
    ring(m.x, m.y, 9, EARTH[2], 0.3);
  },
  seed: (m) => burst(chest(m).x, chest(m).y, 3, [EARTH[2], PAPER[1]], { speed: 22, ttl: 0.25 }),
  pinch: (m) => {
    pop(art("snip"), chest(m).x, chest(m).y, "stick", 0.3);
    burst(chest(m).x, chest(m).y, 5, [CRAB, CREAM], { speed: 30, ttl: 0.25 });
  },
  barrow: (m) => {
    dustRing(m.x, m.y, 22, [PAPER[1], EARTH[2]]);
    burst(m.x, m.y - 4, 5, [BARK[2], BARK[4]], { speed: 36, toward: UP, spread: 1.4, ttl: 0.5 });
  },
  steam: (m) => {
    for (let i = 0; i < 3; i++) pop(art("wisp"), m.x - 4 + i * 4, head(m).y - i, "rise", 0.5 + i * 0.08);
  },
  slime: (m) => {
    ring(m.x, m.y, 18, GREEN[4], 0.4);
    burst(m.x, m.y - 2, 12, [GREEN[3], GREEN[4]], { speed: 40, grav: 0, ttl: 0.35, size: 2, above: false });
  },
  split: (m) => burst(m.x, m.y - 6, 10, [m.col, CREAM], { speed: 30, ttl: 0.35, size: 2 }),
  bonk: (m) => {
    pop(art("cone"), m.x, head(m).y, "bounce", 0.5);
    burst(m.x, head(m).y + 2, 4, [GOLD[2], CREAM], { speed: 26, ttl: 0.25 });
  },
  temper: (m) => {
    pop(art("scribble"), m.x, head(m).y - 2, "stick", 0.45);
    burst(m.x, m.y - 8, 8, [PAPER[2], STONE[3]], { speed: 30, grav: 20, ttl: 0.5 });
  },
  skip: (m) => {
    ring(m.x, m.y, 7, WATER[3], 0.3);
    burst(m.x, m.y, 4, [WATER[2], WATER[3]], { speed: 24, toward: UP, spread: 1.4, ttl: 0.3 });
  },
  lamplight: (m) => {
    ring(m.x, m.y, 9, GOLD[2], 0.35);
    motes(m.x, m.y - 6, 3, [GOLD[1], GOLD[2]]);
  },
  advice: (m) => {
    pop(art("dots"), m.from.x, m.from.y - 22, "stick", 0.4);
    for (const c of m.hit) pop(art("chevron"), c.x, c.y - 22, "rise", 0.55);
  },
  breath: (m) =>
    burst(m.from.x, m.from.y - 8, 18, [CORAL, GOLD[1], GOLD[2]], {
      toward: away(m),
      spread: 0.8,
      speed: 70,
      ttl: 0.3,
      grav: -20,
    }),
  splash: (m) => {
    ring(m.x, m.y, 11, WATER[3], 0.35);
    burst(m.x, m.y - 4, 8, [WATER[2], WATER[3]], { speed: 34, toward: UP, spread: 1.6, ttl: 0.4, grav: 120 });
  },
  pointedly: (m) => pop(art("dots"), m.x, head(m).y - 2, "stick", 0.6),
  pounce: (m) => {
    burst(m.x, m.y - 8, 10, [GREEN[3], GREEN[4]], { speed: 34, ttl: 0.45, grav: 40 });
    burst(chest(m).x, chest(m).y, 4, [CREAM, GREEN[4]], { speed: 30, ttl: 0.25 });
  },
  plaster: (m) => pop(art("plaster"), chest(m).x, chest(m).y, "stick", 0.6),
  claws: (m) => {
    ring(m.x, m.y, 16, STONE[3], 0.35);
    for (const s of [-1, 1])
      for (const d of [-1, 1])
        streak({ x: m.x + 4 * s, y: m.y - 12 }, { x: m.x + 13 * s, y: m.y - 3 + 4 * d }, CREAM, STONE[3], 0.25);
  },
  fog: (m) => burst(m.x, m.y - 6, 14, [STONE[3], WATER[3], CREAM], { speed: 18, grav: -8, ttl: 0.6, scatter: 12 }),
  stab: (m) => {
    const end = m.cells[m.cells.length - 1] ?? m;
    streak({ x: m.from.x, y: m.from.y - 10 }, { x: end.x, y: end.y - 6 }, CREAM, STONE[3], 0.3);
  },
  stomp: (m) => dustRing(m.x, m.y, 32, [STONE[3], PAPER[1]]),
  tonic: (m) => {
    for (const c of m.hit) motes(c.x, c.y - 4, 4, [LEAF, GREEN[4]]);
  },
  sit: (m) => {
    dustRing(m.x, m.y, 36, [PAPER[1], EARTH[2]]);
    ring(m.x, m.y, 20, EARTH[2], 0.35);
  },
  antlers: (m) => {
    const y = head(m).y + 2;
    ring(m.x, y, 10, GOLD[2], 0.3, 3, true);
    ring(m.x, y, 20, GOLD[1], 0.42, 5, true);
    ring(m.x, y, 30, GOLD[0], 0.55, 8, true);
  },
  bat: (m) => {
    pop(art("swipe"), chest(m).x, chest(m).y, "stick", 0.25);
    burst(chest(m).x, chest(m).y, 6, [CORAL, CREAM], { speed: 40, ttl: 0.25, toward: away(m), spread: 1 });
  },
  // What hung comes down, in its owner's colours: lines down onto each hex, the ground thrown out all round, and embers left rising off every hex.
  caught: (m) => {
    const [main = m.col, trim = m.col, core = CREAM] = m.own;
    dustRing(m.x, m.y, 30, [trim, core]);
    ring(m.x, m.y, 15, core, 0.3);
    for (const c of m.cells) {
      streak({ x: c.x, y: c.y - 30 }, { x: c.x, y: c.y - 3 }, core, main, 0.24);
      burst(c.x, c.y - 3, 3, m.own, {
        toward: UP,
        spread: 0.7,
        speed: 22,
        grav: -26,
        ttl: 0.8,
        scatter: 8,
      });
    }
  },
  // Anyone with nothing of its own yet: a ring and a few sparks in its owner's colour.
  plain: (m) => {
    ring(m.x, m.y, 12, m.col, 0.35);
    burst(chest(m).x, chest(m).y, 6, [m.col, CREAM], { speed: 26, ttl: 0.3 });
  },
  sting: (m) => burst(chest(m).x, chest(m).y, 5, [GOLD[1], INK], { speed: 28, ttl: 0.25 }),
  gust: (m) => burst(m.x, m.y - 6, 10, [CREAM, WATER[3]], { speed: 44, grav: 0, ttl: 0.3, toward: away(m), spread: 1 }),
  peck: (m) => {
    burst(chest(m).x, chest(m).y, 4, [STONE[3], CREAM], { speed: 26, ttl: 0.25 });
    if (m.shiny) pop(art("glint"), m.x + 5, head(m).y, "rise", 0.4);
  },
  squelch: (m) => {
    ring(m.x, m.y, 16, EARTH[1], 0.4);
    burst(m.x, m.y - 2, 12, [EARTH[0], EARTH[1]], { speed: 36, grav: 0, ttl: 0.35, size: 2, above: false });
  },
  spores: (m) => {
    ring(m.x, m.y, 30, SKY[4], 0.45);
    burst(m.x, m.y - 6, 18, [SKY[4], CREAM], { speed: 14, grav: -10, ttl: 0.6, scatter: 30 });
  },
  runner: (m) =>
    burst(m.x, m.y - 2, 10, [GREEN[3], GREEN[4], BARK[3]], { speed: 30, toward: UP, spread: 1.4, ttl: 0.4 }),
  swoop: (m) => {
    burst(m.x, m.y - 8, 10, [INK, PAPER[2]], { speed: 30, grav: 30, ttl: 0.5 });
    if (m.shiny) pop(art("glint"), m.x + 5, head(m).y, "rise", 0.4);
  },
  crabbier: (m) => {
    for (const c of m.hit) pop(art("snip"), c.x, c.y - 10, "stick", 0.3);
    burst(m.from.x, m.from.y - 10, 8, [CRAB, CREAM], { speed: 30, ttl: 0.3 });
  },
  // Peep's hat shatters on whoever it was thrown at; three chips of it stay on their hex for the fight.
  chips: (m) => {
    burst(chest(m).x, chest(m).y, 8, [CREAM, PAPER[1]], { speed: 34, ttl: 0.3 });
    leave("chips", { x: m.x, y: m.y }, 3);
  },
  // One bite of Munch's, where it lands: the arch of teeth, and a chip of shell thrown onto the pile.
  bites: (m) => {
    pop(art("bite"), chest(m).x, chest(m).y, "stick", 0.25);
    burst(chest(m).x, chest(m).y, 4, [CREAM, GREEN[3]], { speed: 30, ttl: 0.25 });
    leave("chips", { x: m.x, y: m.y });
  },
  // Clutch's egg cracking where it rolled to (`summon` rolls it and stands the Hatchling up).
  hatch: (m) => burst(m.x, m.y - 3, 5, [CREAM, PAPER[1]], { speed: 24, toward: UP, spread: 1.6, ttl: 0.3 }),
  // Crab #31's clack: two arcs closing over it (a Crab's), one thin arc out to every friend, and a note over each.
  clack: (m) => {
    pop(art("snip"), m.from.x, m.from.y - 20, "stick", 0.3);
    const far = Math.max(8, ...m.hit.map((h) => Math.hypot(h.x - m.from.x, h.y - m.from.y)));
    ring(m.from.x, m.from.y - 6, far, "#e88fb4", 0.35);
    m.hit.forEach((h, i) => pop(art("note"), h.x + 4, h.y - 22 - i, "rise", 0.6));
  },
  // Crab #8 comes up beside them: one pinch, two arcs closing.
  nothere: (m) => {
    for (const h of m.hit.length > 0 ? m.hit : [m]) {
      pop(art("snip"), h.x, h.y - 10, "stick", 0.3);
      burst(h.x, h.y - 8, 6, [CRAB, CREAM], { speed: 32, ttl: 0.3 });
    }
  },
  // The Commodore's call lands: a ring of gold on every place he called to.
  called: (m) => {
    for (const c of m.cells) ring(c.x, c.y, 9, GOLD[2], 0.3);
  },
  // Dibs pats a bank of snow up round its own feet and its friend's, which melts as the shield goes.
  bank: (m) => {
    for (const h of m.hit.length > 0 ? m.hit : [m]) {
      leave("bank", h);
      burst(h.x, h.y - 2, 5, [CREAM, WATER[3]], { speed: 20, toward: UP, spread: 1.6, ttl: 0.3, above: false });
    }
  },
  // Jet's slide: a dotted trail of snow thrown up along the line (the ice is the zone's).
  lane: (m) => {
    for (const c of m.cells) burst(c.x, c.y - 1, 2, [CREAM, WATER[3]], { speed: 8, ttl: 0.5, above: false });
  },
  // A snowball bursting on whoever it hit.
  splat: (m) => {
    burst(chest(m).x, chest(m).y, 7, [CREAM, WATER[3]], { speed: 28, ttl: 0.3, grav: 60 });
  },
  // Flurry's snow begins to fall on the hexes it covers (`fightmarks.ts` draws them outlined, then settled).
  snowfall: (m) => {
    for (const c of m.cells) snowOn(c, 3);
  },
  // Pomp's fanfare: a thin gold arc out to each friend in the row, and the row lit end to end (`fightmarks.ts`).
  fanfare: (m) => {
    lightRow(m.from);
    for (const h of m.hit) streak({ x: m.from.x, y: m.from.y - 14 }, { x: h.x, y: h.y - 14 }, GOLD[2], GOLD[1], 0.3);
  },
  // Yule's bubbles pop: water thrown off each friend, and a wet ring left on the hex.
  bubble: (m) => {
    for (const h of m.hit) {
      burst(h.x, h.y - 8, 10, [WATER[3], CREAM], { speed: 34, ttl: 0.35, grav: 40 });
      leave("ring", h);
    }
  },
  // Seqwawa's roots flash under everyone it reached (`roots.ts` draws the roots): leaves come up off each.
  roots: (m) => {
    for (const c of m.hit)
      burst(c.x, c.y - 2, 5, [GREEN[4], "#c9ef9a"], { speed: 22, toward: UP, spread: 1.2, ttl: 0.45 });
    burst(m.from.x, m.from.y - 22, 8, [GOLD[1], GOLD[2]], { speed: 18, ttl: 0.5 });
  },
};

/** The puff a fallen figure goes in, at its feet. */
export function puff(x: number, y: number, p: Puff, big: boolean): void {
  const n = big ? 22 : 12;
  if (p.drift === "up") burst(x, y - 6, n, p.cols, { speed: 16, grav: -24, ttl: 0.6, scatter: big ? 18 : 10 });
  else if (p.drift === "down")
    burst(x, y - 10, n, p.cols, { speed: 22, toward: UP, spread: 2.4, grav: 26, ttl: 0.6, scatter: big ? 18 : 8 });
  else burst(x, y - 4, n, p.cols, { speed: 38, toward: UP, spread: 2.2, grav: 110, ttl: 0.45, scatter: big ? 14 : 6 });
  burst(x, y, big ? 10 : 6, [PAPER[1], EARTH[2]], {
    speed: 20,
    toward: UP,
    spread: 3,
    grav: 0,
    ttl: 0.3,
    above: false,
  });
}
