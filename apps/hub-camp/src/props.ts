/**
 * The camp's furniture, drawn with rectangles and rules: the cabin and the tent, the notice board,
 * the workbench and its small machine, the trophy shelf, the signpost, the pond and the fire ring.
 * Each comes back as a sprite, with the spots on it that things happen at.
 */
import { asSprite, canvas, type Cv, type G2, hash, INK, noise, outlined, R, rng, type Spr } from "./gfx.ts";

const I = INK;

/** A point on a sprite, measured from its feet. */
export type Spot = [number, number];

export interface RoofInk {
  light: string;
  mid: string;
  shade: string;
}
export const ROOFS: Record<string, RoofInk> = {
  canvas: { light: I.j, mid: I.K, shade: I.L },
  moss: { light: "#6c9a5a", mid: I.s, shade: I.r },
  plum: { light: "#9a55b0", mid: I.d, shade: I.c },
  coral: { light: "#f2a08a", mid: I.f, shade: "#b9534e" },
  sky: { light: I.F, mid: I.C, shade: I.E },
};

export interface Home {
  shut: Spr;
  open: Spr;
  door: Spot;
  win: Spot | null;
  chimney: Spot | null;
  banner: Spot;
  lamp: Spot;
  eave: [number, number, number];
  /** Half the width of the ground it stands on, and half its depth. */
  foot: [number, number];
}

function cabinArt(roof: RoofInk, open: boolean): Cv {
  const [c, g] = canvas(90, 80);
  const rand = rng(77);
  const ox = 1;
  // the chimney first: the roof's far slope hides its foot
  R(g, ox + 62, 3, 9, 20, I.y);
  for (let y = 4; y < 22; y += 3) {
    const off = (y / 3) % 2 === 0 ? 0 : 2;
    R(g, ox + 62, y + 2, 9, 1, I.x);
    for (let x = off; x < 9; x += 4) R(g, ox + 62 + x, y, 1, 2, I.x);
    R(g, ox + 62, y, 1, 2, I.z);
  }
  R(g, ox + 61, 1, 11, 2, I.A);
  R(g, ox + 61, 3, 11, 1, I.x);
  // the roof: canvas stretched over poles, lighter where the sky reaches it
  const xl = (y: number): number => Math.round(16 - ((y - 9) * 13) / 33);
  for (let y = 9; y <= 42; y++) {
    const l = ox + xl(y);
    const r = ox + 87 - xl(y);
    const span = r - l;
    for (let x = l; x <= r; x++) {
      const f = (x - l) / span;
      const panel = (f * 5) % 1;
      let col = panel < 0.62 ? roof.light : roof.mid;
      if (panel > 0.94 || f > 0.985) col = roof.shade;
      if (y > 37 && panel >= 0.62) col = roof.shade;
      if (y < 12) col = panel < 0.62 ? roof.light : roof.mid;
      if (x === l) col = roof.shade;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  // the scalloped hem
  for (let s0 = ox + 3; s0 < ox + 85; s0 += 7) {
    R(g, s0, 43, 7, 1, roof.mid);
    R(g, s0 + 1, 44, 5, 1, roof.mid);
    R(g, s0 + 2, 45, 3, 1, roof.shade);
    R(g, s0, 43, 1, 1, roof.shade);
  }
  // the ridge pole, its ends showing
  R(g, ox + 12, 7, 64, 2, I.l);
  R(g, ox + 12, 7, 64, 1, I.n);
  R(g, ox + 11, 6, 2, 4, I.o);
  R(g, ox + 75, 6, 2, 4, I.m);
  // the wall: six logs, each with a lit top and a dark seam
  R(g, ox + 10, 43, 68, 3, I.k);
  for (let i = 0; i < 6; i++) {
    const y = 46 + i * 5;
    R(g, ox + 10, y, 68, 5, I.m);
    R(g, ox + 10, y, 68, 1, I.n);
    R(g, ox + 10, y + 4, 68, 1, I.l);
    for (let n = 0; n < 5; n++) {
      const x = ox + 12 + Math.floor(rand() * 60);
      R(g, x, y + 1 + Math.floor(rand() * 2), 3 + Math.floor(rand() * 4), 1, rand() < 0.5 ? I.n : I.l);
    }
    // the log ends at the corners
    for (const ex of [ox + 7, ox + 77]) {
      R(g, ex, y, 4, 4, I.o);
      R(g, ex + 1, y + 1, 2, 2, I.w);
      R(g, ex + 2, y + 2, 1, 1, I.v);
      R(g, ex, y + 4, 4, 1, I.l);
    }
  }
  // the window, lit from inside
  R(g, ox + 17, 49, 20, 15, I.k);
  R(g, ox + 18, 50, 18, 13, I.o);
  R(g, ox + 19, 51, 16, 11, I.i);
  R(g, ox + 19, 57, 16, 5, I.g);
  R(g, ox + 26, 51, 2, 11, I.n);
  R(g, ox + 19, 56, 16, 1, I.n);
  R(g, ox + 19, 51, 3, 1, I.e);
  R(g, ox + 19, 52, 2, 1, I.e);
  R(g, ox + 19, 53, 1, 2, I.e);
  R(g, ox + 32, 51, 3, 1, I.e);
  R(g, ox + 33, 52, 2, 1, I.e);
  R(g, ox + 34, 53, 1, 2, I.e);
  R(g, ox + 21, 53, 2, 1, I.j);
  R(g, ox + 29, 52, 2, 1, I.j);
  // the flower box
  R(g, ox + 17, 65, 20, 4, I.m);
  R(g, ox + 17, 65, 20, 1, I.o);
  R(g, ox + 17, 68, 20, 1, I.l);
  const blooms = [I.N, I.j, I.M, I.g, I.N, I.j];
  for (let n = 0; n < 6; n++) {
    const x = ox + 18 + n * 3 + (n % 2);
    R(g, x, 63, 3, 2, n % 2 ? I.r : I.s);
    R(g, x + 1, 62, 1, 1, I.s);
    R(g, x + (n % 2), 62 - (n % 3 === 0 ? 1 : 0), 1, 1, blooms[n]!);
  }
  // the door
  R(g, ox + 50, 47, 17, 29, I.k);
  if (open) {
    R(g, ox + 51, 48, 15, 28, I.h);
    R(g, ox + 51, 48, 15, 9, "#7a4a2a");
    R(g, ox + 51, 57, 15, 8, "#b0703a");
    R(g, ox + 51, 70, 15, 6, I.g);
    // a bed end and a shelf, seen through the door
    R(g, ox + 53, 63, 9, 7, I.D);
    R(g, ox + 53, 63, 9, 2, I.j);
    R(g, ox + 52, 53, 8, 1, I.l);
    R(g, ox + 53, 51, 2, 2, I.e);
    R(g, ox + 56, 50, 2, 3, I.s);
    // the door itself, swung in against the frame
    R(g, ox + 64, 48, 2, 28, I.m);
  } else {
    R(g, ox + 51, 48, 15, 28, I.n);
    R(g, ox + 51, 48, 15, 1, I.o);
    for (let x = 54; x < 66; x += 4) R(g, ox + x, 49, 1, 27, I.m);
    R(g, ox + 51, 48, 1, 1, I.k);
    R(g, ox + 65, 48, 1, 1, I.k);
    R(g, ox + 55, 51, 7, 6, I.k);
    R(g, ox + 56, 52, 5, 4, I.i);
    R(g, ox + 58, 52, 1, 4, I.n);
    R(g, ox + 53, 63, 2, 2, I.g);
    R(g, ox + 53, 63, 1, 1, I.j);
    R(g, ox + 64, 52, 2, 2, I.l);
    R(g, ox + 64, 68, 2, 2, I.l);
  }
  // the step
  R(g, ox + 47, 76, 23, 2, I.w);
  R(g, ox + 47, 78, 23, 1, I.v);
  // the lantern by the door
  R(g, ox + 69, 49, 4, 1, I.k);
  R(g, ox + 71, 50, 1, 1, I.k);
  R(g, ox + 70, 51, 3, 1, I.k);
  R(g, ox + 70, 52, 3, 4, I.g);
  R(g, ox + 71, 53, 1, 2, I.j);
  R(g, ox + 70, 56, 3, 1, I.k);
  return c;
}

function tentArt(roof: RoofInk, open: boolean): Cv {
  const [c, g] = canvas(74, 60);
  const ax = 37;
  const half = (y: number): number => ((y - 6) * 32) / 49;
  for (let y = 6; y <= 55; y++) {
    const hw = Math.round(half(y));
    for (let x = ax - hw; x <= ax + hw; x++) {
      const edge = x < ax ? x - (ax - hw) : ax + hw - x;
      const stripe = Math.floor(edge / 5) % 2 === 1;
      let col = stripe ? roof.mid : x < ax ? I.j : I.K;
      if (stripe && x >= ax) col = roof.shade;
      if (edge === 0) col = x < ax ? I.L : roof.shade;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  // the way in
  for (let y = 22; y <= 55; y++) {
    const hw = Math.round(((y - 22) * 11) / 33);
    R(g, ax - hw, y, hw * 2 + 1, 1, open ? I.h : I.a);
    if (y > 46) R(g, ax - hw, y, hw * 2 + 1, 1, open ? I.g : "#5a3a2c");
    R(g, ax - hw - 1, y, 1, 1, I.L);
    R(g, ax + hw + 1, y, 1, 1, I.L);
  }
  // a flap tied back
  for (let y = 26; y <= 50; y++) {
    const hw = Math.round(((y - 22) * 11) / 33);
    R(g, ax - hw, y, Math.max(1, Math.round(hw * 0.45)), 1, I.K);
  }
  R(g, ax - 6, 40, 2, 2, roof.mid);
  // the crossed poles at the top
  R(g, ax - 1, 1, 1, 6, I.m);
  R(g, ax + 1, 1, 1, 6, I.n);
  R(g, ax - 2, 0, 1, 2, I.m);
  R(g, ax + 2, 0, 1, 2, I.n);
  // pegs
  R(g, 3, 55, 2, 3, I.m);
  R(g, 69, 55, 2, 3, I.m);
  return c;
}

export function home(kind: "cabin" | "tent", roof: RoofInk): Home {
  if (kind === "tent") {
    const shut = outlined(asSprite(tentArt(roof, false), 37, 57));
    const open = outlined(asSprite(tentArt(roof, true), 37, 57));
    return {
      shut,
      open,
      door: [0, -8],
      win: null,
      chimney: null,
      banner: [21, -34],
      lamp: [0, -12],
      eave: [-24, 24, -22],
      foot: [32, 7],
    };
  }
  const shut = outlined(asSprite(cabinArt(roof, false), 45, 77));
  const open = outlined(asSprite(cabinArt(roof, true), 45, 77));
  return {
    shut,
    open,
    door: [14, -10],
    win: [-17, -20],
    chimney: [22, -76],
    banner: [-2, -31],
    lamp: [27, -23],
    eave: [-38, 38, -31],
    foot: [38, 7],
  };
}

export function board(): Spr {
  const [c, g] = canvas(46, 50);
  const rand = rng(31);
  // posts
  for (const x of [7, 35]) {
    R(g, x, 12, 4, 37, I.m);
    R(g, x, 12, 1, 37, I.n);
    R(g, x + 3, 12, 1, 37, I.k);
  }
  // a small shingled roof
  for (let y = 4; y <= 11; y++) {
    const inset = Math.round(((11 - y) * 5) / 7);
    R(g, 1 + inset, y, 44 - inset * 2, 1, y % 2 ? I.l : I.m);
  }
  R(g, 6, 4, 34, 1, I.n);
  R(g, 1, 11, 44, 1, I.k);
  for (let x = 4; x < 44; x += 6) R(g, x, 8, 1, 3, I.k);
  // the board
  R(g, 4, 13, 38, 25, I.l);
  R(g, 5, 14, 36, 23, I.w);
  for (let n = 0; n < 26; n++) R(g, 6 + Math.floor(rand() * 34), 15 + Math.floor(rand() * 21), 1, 1, I.v);
  // notices
  R(g, 7, 16, 10, 12, I.j);
  R(g, 7, 27, 10, 1, I.L);
  for (const y of [19, 21, 23]) R(g, 9, y, y === 23 ? 4 : 6, 1, I.L);
  R(g, 11, 16, 2, 1, I.R);
  R(g, 19, 17, 10, 9, I.i);
  R(g, 19, 25, 10, 1, I.h);
  for (const y of [19, 21]) R(g, 21, y, 6, 1, I.h);
  R(g, 25, 22, 3, 3, I.R);
  R(g, 26, 23, 1, 1, I.M);
  R(g, 23, 17, 2, 1, I.g);
  R(g, 31, 16, 9, 13, I.j);
  R(g, 31, 28, 9, 1, I.L);
  R(g, 34, 18, 3, 1, I.t);
  R(g, 33, 19, 5, 2, I.s);
  R(g, 35, 21, 1, 2, I.m);
  for (const y of [24, 26]) R(g, 33, y, 5, 1, I.L);
  R(g, 35, 16, 2, 1, I.g);
  R(g, 20, 28, 8, 7, I.K);
  R(g, 22, 30, 4, 1, I.L);
  R(g, 22, 32, 3, 1, I.L);
  R(g, 23, 28, 2, 1, I.R);
  return outlined(asSprite(c, 23, 49));
}

export interface Bench {
  body: Spr;
  gear: Spot;
  steam: Spot;
  tray: Spot;
  dome: Spot;
}
export function bench(): Bench {
  const [c, g] = canvas(50, 42);
  // legs, a chest of drawers, a crate of what it has made
  R(g, 5, 26, 18, 14, I.m);
  R(g, 5, 26, 1, 14, I.n);
  for (const y of [27, 33]) {
    R(g, 7, y, 14, 5, I.n);
    R(g, 7, y, 14, 1, I.o);
    R(g, 7, y + 4, 14, 1, I.l);
    R(g, 13, y + 2, 2, 1, I.g);
  }
  R(g, 42, 26, 4, 14, I.m);
  R(g, 42, 26, 1, 14, I.n);
  R(g, 23, 35, 19, 2, I.l);
  R(g, 28, 31, 10, 9, I.v);
  R(g, 28, 31, 10, 1, I.w);
  R(g, 28, 35, 10, 1, I.u);
  R(g, 32, 31, 1, 9, I.u);
  R(g, 30, 29, 3, 2, I.g);
  R(g, 33, 30, 3, 1, I.h);
  R(g, 34, 29, 2, 1, I.i);
  // the top
  R(g, 2, 20, 46, 3, I.o);
  R(g, 2, 20, 46, 1, I.w);
  R(g, 2, 23, 46, 2, I.n);
  R(g, 2, 25, 46, 1, I.l);
  // a rolled plan
  R(g, 4, 17, 8, 3, I.C);
  R(g, 4, 17, 8, 1, I.F);
  R(g, 4, 17, 1, 3, I.E);
  R(g, 11, 17, 1, 3, I.E);
  // the machine: a brass boiler under a glass dome
  R(g, 22, 18, 19, 2, I.n);
  R(g, 23, 9, 17, 9, I.h);
  R(g, 25, 9, 2, 9, I.g);
  R(g, 25, 10, 1, 3, I.i);
  R(g, 37, 9, 3, 9, "#a86c35");
  R(g, 23, 12, 17, 1, I.n);
  R(g, 23, 16, 17, 1, I.n);
  for (const [x, y] of [
    [24, 10],
    [38, 10],
    [24, 14],
    [38, 14],
  ] as const)
    R(g, x, y, 1, 1, I.n);
  R(g, 27, 8, 9, 1, I.h);
  R(g, 28, 3, 7, 5, I.t);
  R(g, 27, 4, 9, 4, I.t);
  R(g, 29, 2, 5, 1, I.t);
  R(g, 28, 4, 2, 2, I.G);
  R(g, 29, 3, 2, 1, I.G);
  R(g, 33, 6, 2, 2, I.s);
  // a pipe for the steam
  R(g, 37, 3, 3, 6, I.n);
  R(g, 37, 3, 1, 6, I.o);
  R(g, 36, 2, 5, 1, I.n);
  // the axle the gear turns on
  R(g, 18, 13, 5, 1, I.n);
  // the chute and its tray
  R(g, 40, 14, 4, 2, I.n);
  R(g, 42, 16, 6, 1, I.n);
  R(g, 41, 17, 8, 2, I.h);
  R(g, 41, 17, 8, 1, I.g);
  return {
    body: outlined(asSprite(c, 25, 41)),
    gear: [-9, -27],
    steam: [14, -39],
    tray: [20, -25],
    dome: [7, -35],
  };
}

/** The gear, in the two positions it turns between. */
export function gears(): [Spr, Spr] {
  const make = (diag: boolean): Spr => {
    const [c, g] = canvas(9, 9);
    R(g, 2, 2, 5, 5, I.g);
    R(g, 3, 1, 3, 7, I.g);
    R(g, 1, 3, 7, 3, I.g);
    if (diag) {
      for (const [x, y] of [
        [1, 1],
        [7, 1],
        [1, 7],
        [7, 7],
      ] as const)
        R(g, x, y, 1, 1, I.h);
      R(g, 2, 2, 1, 1, I.h);
      R(g, 6, 2, 1, 1, I.h);
      R(g, 2, 6, 1, 1, I.h);
      R(g, 6, 6, 1, 1, I.h);
    } else {
      R(g, 4, 0, 1, 1, I.h);
      R(g, 4, 8, 1, 1, I.h);
      R(g, 0, 4, 1, 1, I.h);
      R(g, 8, 4, 1, 1, I.h);
    }
    R(g, 3, 3, 3, 3, I.h);
    R(g, 4, 4, 1, 1, I.n);
    R(g, 3, 2, 2, 1, I.i);
    return asSprite(c, 4, 4);
  };
  return [make(false), make(true)];
}

export function shelf(): Spr {
  const [c, g] = canvas(36, 48);
  R(g, 3, 5, 30, 41, I.l);
  R(g, 2, 3, 32, 3, I.n);
  R(g, 2, 3, 32, 1, I.o);
  R(g, 5, 7, 26, 36, I.k);
  R(g, 3, 5, 1, 41, I.m);
  for (const y of [18, 30]) {
    R(g, 5, y, 26, 2, I.n);
    R(g, 5, y, 26, 1, I.o);
  }
  R(g, 3, 43, 30, 3, I.m);
  R(g, 3, 43, 30, 1, I.n);
  // a cup
  R(g, 9, 8, 7, 4, I.g);
  R(g, 10, 12, 5, 1, I.g);
  R(g, 11, 13, 3, 2, I.h);
  R(g, 9, 15, 7, 2, I.g);
  R(g, 9, 17, 7, 1, I.h);
  R(g, 10, 9, 1, 3, I.j);
  R(g, 8, 9, 1, 2, I.h);
  R(g, 16, 9, 1, 2, I.h);
  // a medal on its ribbon
  R(g, 22, 8, 2, 5, I.e);
  R(g, 25, 8, 2, 5, I.M);
  R(g, 22, 12, 5, 5, I.g);
  R(g, 23, 13, 3, 3, I.i);
  R(g, 24, 14, 1, 1, I.h);
  // a star
  R(g, 10, 21, 1, 2, I.g);
  R(g, 7, 23, 7, 2, I.g);
  R(g, 8, 25, 5, 1, I.g);
  R(g, 8, 26, 2, 2, I.g);
  R(g, 11, 26, 2, 2, I.g);
  R(g, 10, 23, 1, 2, I.j);
  R(g, 8, 28, 5, 2, I.h);
  // a crystal
  R(g, 21, 21, 3, 9, I.d);
  R(g, 20, 24, 5, 6, I.d);
  R(g, 22, 20, 1, 1, I.N);
  R(g, 21, 22, 1, 6, I.M);
  R(g, 24, 25, 1, 5, I.c);
  R(g, 26, 25, 2, 5, I.e);
  R(g, 26, 24, 1, 1, I.N);
  R(g, 17, 27, 2, 3, I.e);
  // books and a small crab someone carved
  const spines = [I.f, I.s, I.d, I.g, I.E];
  spines.forEach((col, n) => {
    const tall = [10, 9, 10, 8, 9][n]!;
    R(g, 6 + n * 3, 43 - tall, 3, tall, col);
    R(g, 6 + n * 3, 43 - tall, 1, tall, "rgba(255,243,207,0.35)");
    R(g, 6 + n * 3, 45 - tall, 3, 1, "rgba(26,15,30,0.45)");
  });
  R(g, 23, 39, 6, 3, I.f);
  R(g, 22, 37, 2, 2, I.f);
  R(g, 28, 37, 2, 2, I.f);
  R(g, 24, 38, 1, 1, I.B);
  R(g, 27, 38, 1, 1, I.B);
  R(g, 23, 42, 6, 1, I.e);
  return outlined(asSprite(c, 18, 47));
}

export function signpost(): Spr {
  const [c, g] = canvas(32, 44);
  R(g, 14, 4, 3, 39, I.m);
  R(g, 14, 4, 1, 39, I.n);
  R(g, 16, 4, 1, 39, I.k);
  R(g, 13, 2, 5, 2, I.o);
  const arrow = (y: number, x0: number, x1: number, left: boolean): void => {
    for (let dy = 0; dy < 7; dy++) {
      const tip = 3 - Math.abs(dy - 3);
      const col = dy === 0 ? I.o : dy === 6 ? I.l : I.n;
      if (left) R(g, x0 - tip, y + dy, x1 - x0 + tip + 1, 1, col);
      else R(g, x0, y + dy, x1 - x0 + tip + 1, 1, col);
    }
    R(g, 15, y + 3, 1, 1, I.k);
  };
  arrow(6, 5, 24, true);
  arrow(15, 7, 25, false);
  arrow(24, 6, 22, true);
  // a leaf for the Treasury, a coin for the Market, a tent for a visit
  R(g, 8, 8, 2, 3, I.t);
  R(g, 9, 8, 2, 2, I.G);
  R(g, 7, 10, 1, 1, I.q);
  R(g, 20, 17, 3, 3, I.g);
  R(g, 21, 17, 1, 1, I.j);
  R(g, 10, 26, 1, 1, I.j);
  R(g, 9, 27, 3, 1, I.j);
  R(g, 8, 28, 5, 1, I.K);
  R(g, 10, 28, 1, 1, I.a);
  return outlined(asSprite(c, 15, 43));
}

/** The pond, lying flat: its middle is the point it is placed by. */
export function pond(): Spr {
  const W = 64;
  const H = 40;
  const cx = 32;
  const cy = 24;
  const [c, g] = canvas(W, H);
  const rim = (x: number, y: number): number => {
    const dx = (x - cx) / 27;
    const dy = (y - cy) / 11.5;
    const ang = Math.atan2(dy, dx);
    return Math.hypot(dx, dy) - (noise(ang * 2.2 + 9, 1.5, 4) - 0.5) * 0.16;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = rim(x, y);
      if (d > 0.9) continue;
      let col: string = I.c;
      const band = (y - cy) / 11.5;
      if (band < -0.35) col = I.b;
      else if (band > 0.4) col = I.d;
      if (d > 0.8) col = I.a;
      if (d <= 0.8 && d > 0.72 && band < 0) col = I.b;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  // the stones round it, the near ones larger
  const rand = rng(12);
  const stones = 15;
  const order: [number, number, number][] = [];
  for (let n = 0; n < stones; n++) {
    const ang = (n / stones) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    order.push([cx + Math.cos(ang) * 28, cy + Math.sin(ang) * 12.5, ang]);
  }
  order.sort((p, q) => p[1] - q[1]);
  for (const [sx, sy] of order) {
    const near = sy > cy;
    const w = (near ? 6 : 5) + Math.floor(rand() * 3);
    const h = near ? 4 : 3;
    const x = Math.round(sx - w / 2);
    const y = Math.round(sy - h / 2);
    R(g, x + 1, y, w - 2, h, I.z);
    R(g, x, y + 1, w, h - 1, I.z);
    R(g, x + 1, y, w - 2, 1, I.A);
    R(g, x, y + h - 1, w, 1, I.x);
    R(g, x + w - 1, y + 1, 1, h - 1, I.y);
    if (rand() < 0.5) R(g, x + 2, y + 1, 1, 1, I.A);
  }
  // lily pads and one flower
  R(g, 20, 21, 5, 3, I.s);
  R(g, 21, 20, 3, 1, I.s);
  R(g, 22, 22, 1, 2, I.c);
  R(g, 21, 21, 2, 1, I.t);
  R(g, 39, 27, 4, 2, I.r);
  R(g, 40, 26, 2, 1, I.s);
  R(g, 44, 20, 3, 2, I.s);
  R(g, 45, 19, 1, 1, I.N);
  R(g, 44, 19, 1, 1, I.M);
  // reeds at the back
  for (const [x, h] of [
    [11, 12],
    [13, 15],
    [16, 10],
    [50, 11],
    [52, 14],
  ] as const) {
    R(g, x, 16 - h, 1, h, I.r);
    R(g, x, 16 - h - 3, 1, 4, I.u);
    R(g, x + 1, 16 - h + 3, 1, 2, I.s);
  }
  return outlined(asSprite(c, cx, cy));
}

export interface FireArt {
  back: Spr;
  front: Spr;
  logN: Spr;
  logS: Spr;
}
export function fireArt(): FireArt {
  const stone = (g: G2, x: number, y: number, w: number): void => {
    R(g, x + 1, y, w - 2, 5, I.z);
    R(g, x, y + 1, w, 3, I.z);
    R(g, x + 1, y, w - 2, 1, I.A);
    R(g, x, y + 3, w, 1, I.y);
    R(g, x + 1, y + 4, w - 2, 1, I.x);
  };
  const ring = (near: boolean): Spr => {
    const [c, g] = canvas(36, 22);
    const cx = 18;
    const cy = 11;
    if (!near) {
      // the ash bed and two crossed logs
      for (let y = -6; y <= 6; y++) {
        const hw = Math.round(Math.sqrt(1 - (y * y) / 49) * 14);
        R(g, cx - hw, cy + y, hw * 2, 1, y < -2 ? I.k : I.u);
      }
      for (let n = 0; n < 16; n++)
        R(g, cx - 10 + Math.floor(hash(n, 3) * 20), cy - 4 + Math.floor(hash(n, 9) * 8), 1, 1, I.k);
      for (let n = 0; n < 12; n++) {
        const x = cx - 8 + n;
        R(g, x, cy - 1 + Math.round(n / 4), 2, 2, I.l);
        R(g, x + 4, cy + 2 - Math.round(n / 4), 2, 2, I.k);
      }
      R(g, cx - 8, cy - 1, 12, 1, I.m);
    }
    for (let n = 0; n < 12; n++) {
      const ang = (n / 12) * Math.PI * 2 + 0.26;
      const far = Math.sin(ang) < -0.05;
      if (far === near) continue;
      const x = Math.round(cx + Math.cos(ang) * 14.5 - 3);
      const y = Math.round(cy + Math.sin(ang) * 6.5 - 2);
      stone(g, x, y, 6 + (n % 3 === 0 ? 1 : 0));
    }
    return outlined(asSprite(c, cx, cy));
  };
  const log = (len: number): Spr => {
    const [c, g] = canvas(len, 9);
    R(g, 2, 1, len - 4, 7, I.m);
    R(g, 2, 1, len - 4, 1, I.o);
    R(g, 2, 2, len - 4, 1, I.n);
    R(g, 2, 7, len - 4, 1, I.l);
    for (let x = 6; x < len - 6; x += 7) R(g, x + (x % 3), 4, 3, 1, I.l);
    for (const x of [0, len - 4]) {
      R(g, x + 1, 1, 2, 7, I.w);
      R(g, x, 2, 4, 5, I.w);
      R(g, x + 1, 3, 2, 3, I.v);
      R(g, x + 1, 4, 1, 1, I.o);
    }
    return outlined(asSprite(c, Math.floor(len / 2), 8));
  };
  return { back: ring(false), front: ring(true), logN: log(40), logS: log(40) };
}

/** A woven rug, lying flat. */
export function rug(): Spr {
  const [c, g] = canvas(30, 14);
  R(g, 2, 1, 26, 12, I.D);
  R(g, 3, 2, 24, 10, I.R);
  R(g, 5, 4, 20, 6, I.e);
  for (let x = 6; x < 24; x += 6) {
    R(g, x + 1, 6, 2, 2, I.g);
    R(g, x + 2, 5, 1, 4, I.g);
    R(g, x, 7, 4, 1, I.g);
  }
  R(g, 3, 2, 24, 1, I.f);
  for (let y = 1; y < 13; y += 2) {
    R(g, 0, y, 2, 1, I.j);
    R(g, 28, y, 2, 1, I.j);
  }
  return asSprite(c, 15, 7);
}

/** A banner for a territory, at full length: the cabin shows as much of it as has unrolled. */
export function bannerArt(colour: string, dark: string, mark: number): Cv {
  const [c, g] = canvas(11, 24);
  R(g, 0, 0, 11, 2, I.m);
  R(g, 0, 0, 11, 1, I.o);
  R(g, 1, 2, 9, 19, colour);
  R(g, 1, 2, 1, 19, dark);
  R(g, 9, 2, 1, 19, dark);
  R(g, 1, 21, 4, 1, colour);
  R(g, 6, 21, 4, 1, colour);
  R(g, 2, 22, 2, 1, colour);
  R(g, 7, 22, 2, 1, colour);
  R(g, 1, 17, 9, 1, I.g);
  // the mark: a tree, a ring, a star or a wave
  const m = mark % 4;
  if (m === 0) {
    R(g, 5, 5, 1, 1, I.j);
    R(g, 4, 6, 3, 2, I.j);
    R(g, 3, 8, 5, 3, I.j);
    R(g, 5, 11, 1, 3, I.j);
  } else if (m === 1) {
    R(g, 4, 6, 3, 1, I.j);
    R(g, 3, 7, 1, 5, I.j);
    R(g, 7, 7, 1, 5, I.j);
    R(g, 4, 12, 3, 1, I.j);
  } else if (m === 2) {
    R(g, 5, 5, 1, 9, I.j);
    R(g, 2, 9, 7, 1, I.j);
    R(g, 4, 8, 3, 3, I.j);
  } else {
    R(g, 2, 7, 2, 1, I.j);
    R(g, 4, 8, 2, 1, I.j);
    R(g, 6, 7, 2, 1, I.j);
    R(g, 2, 11, 2, 1, I.j);
    R(g, 4, 12, 2, 1, I.j);
    R(g, 6, 11, 2, 1, I.j);
  }
  return c;
}
