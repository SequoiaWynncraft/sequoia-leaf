/**
 * The mill on the page: it saws, fires or presses by what it is fed, and shows that face; a new one's
 * face is guessed from the gatherer that points into it, until something arrives. A kiln at work
 * smokes and glows, a saw throws dust.
 */
import {
  ALL_ITEMS,
  BACK,
  DX,
  DY,
  GATHERING,
  held,
  holderOf,
  type Holders,
  item as thing,
  ITEM_COUNT,
  ITEMS,
  NONE,
  RECIPE,
  RECIPES,
  type Yard,
} from "@sequoia-leaf/factory";
import { GOLD, STONE } from "@sequoia-leaf/kit/palette.ts";
import { clamp, hash, must } from "@sequoia-leaf/kit/util.ts";

import { lookOf } from "../art/machines.ts";
import { puff, smoke } from "../fx.ts";
import type { Drawn, KindPage, Remembered } from "./kind.ts";
import { MACHINE } from "./machine.ts";

/** A mill's faces: it saws, fires or presses, by what arrives. */
const FACES = ["saw", "kiln", "press"] as const;
const SAW = 0;
const KILN = 1;
/** The face a mill shows making each thing, and taking each thing in, looked up once by name; `NONE` where none says. */
const FACE_OUT = new Uint8Array(ITEM_COUNT).fill(NONE);
const FACE_IN = new Uint8Array(ITEM_COUNT).fill(NONE);
for (const r of RECIPES) {
  if (r.face === undefined || r.by !== "mill") continue;
  const face = FACES.indexOf(r.face);
  FACE_OUT[thing(r.out)] = face;
  for (const name of ITEMS) if ((r.from[name] ?? 0) > 0) FACE_IN[thing(name)] = face;
}

/** A new mill's face, guessed from the gatherer that points into it. */
function fresh(y: Yard, i: number): number {
  const W = y.land.w;
  const x = i % W;
  const z = (i - x) / W;
  let face = SAW;
  for (let d = 0; d < 4; d++) {
    const j = (z + (DY[d] ?? 0)) * W + x + (DX[d] ?? 0);
    const f = y.kind[j] === GATHERING && y.dir[j] === BACK[d] ? (FACE_IN[y.land.deposit[j] ?? NONE] ?? NONE) : NONE;
    if (f !== NONE) face = f;
  }
  return face;
}

/** The face a mill shows now: of what it makes, holds ready or is told to make, else of what it holds; kept in the frame's memory. */
function faceOf(y: Yard, i: number, r: number, mem: Remembered): number {
  const h = y.holders;
  const making = h.making[r] ?? NONE;
  const out = h.out[r] ?? NONE;
  const n = making !== NONE ? making : out !== NONE ? out : (y.set[i] ?? NONE);
  const f = FACE_OUT[n] ?? NONE;
  const face = f !== NONE ? f : (h.count[r] ?? 0) > 0 ? holdsFace(h, r) : NONE;
  if (face !== NONE) mem.face[i] = face;
  return mem.face[i] ?? SAW;
}

/** The face of what a mill holds, the last thing it holds that one says; `NONE` for none. */
function holdsFace(h: Holders, r: number): number {
  let f: number = NONE;
  for (const k of ALL_ITEMS) if (held(h, r, k) > 0 && FACE_IN[k] !== NONE) f = FACE_IN[k] ?? NONE;
  return f;
}

const first = <T>(list: readonly T[], i: number): T | undefined => list[clamp(Math.floor(i), 0, list.length - 1)];

/** The frame of its face it shows: at rest, a saw's two, a kiln's three, and a press by how far its work has come. */
function stepOf(face: number, at: Drawn): number {
  if (!at.working) return 0;
  if (face === SAW) return 1 + (Math.floor(at.t * 14) % 2);
  if (face === KILN) return 1 + (Math.floor(at.t * 8 + at.i) % 3);
  const p = at.making !== NONE ? at.work / (RECIPE[at.making]?.work ?? 24) : 0;
  return p < 0.3 ? 0 : p < 0.6 ? 1 : 2;
}

/** A kiln at work smokes; a saw throws dust. */
function throwOff(face: number, at: Drawn): void {
  const { i, foot, cx, t } = at;
  if (!at.working || t <= (at.mem.puffAt[i] ?? 0)) return;
  if (face === KILN) {
    at.mem.puffAt[i] = t + 0.5 + hash(i, Math.floor(t), 3) * 0.4;
    smoke(cx + 4 + at.seenX, foot - 19 + at.seenY, "#9a82a8");
  } else if (face === SAW) {
    at.mem.puffAt[i] = t + 0.25;
    puff(cx + 3 + at.seenX, foot - 8 + at.seenY, 1, "#cbb894", 4);
  }
}

export const mill: KindPage = {
  ...MACHINE,
  picture: ({ m }, grade) => must(m.saw[lookOf(grade)]?.[0], "saw").c,
  draw(art, y, at) {
    const { m } = art;
    const face = at.real && at.r >= 0 ? faceOf(y, at.i, at.r, at.mem) : SAW;
    const frames = (face === SAW ? m.saw : face === KILN ? m.kiln : m.press)[at.look] ?? [];
    const s = first(frames, stepOf(face, at));
    if (!s) return at.foot - 16;
    at.stand(s, at.cx, at.foot, at.z, at.a);
    throwOff(face, at);
    return at.foot - s.c.height + 2;
  },
  fresh,
  fire: (y, i, mem) => {
    const r = holderOf(y, i);
    return r >= 0 && faceOf(y, i, r, mem) === KILN;
  },
  lamps: (_y, i, x, foot, at, out) => {
    if (at.working(i) && at.kiln(i)) out.push({ x, y: foot - 6, r: 22, power: 0.8, reach: false });
  },
  map: [STONE[2], STONE[0]],
  dot: GOLD[1],
  dock: 5,
};
