/**
 * The grove's own people, each drawn as a 64x64 skin: the same sheet a member's Minecraft skin
 * is, so members and the people who live here stand on one model and look like one cast.
 * A person is an outfit (a few colours and what they wear) tailored into a sheet, plus the few
 * solid things they carry, which a flat sheet cannot show: a staff, a pack, a feather.
 */
import { type Extra, unwrap } from "../engine/actors.ts";
import { ihash } from "../engine/rand.ts";
import { addTile } from "./tiles.ts";

export interface Outfit {
  seed: number;
  skin: string;
  eyes: string;
  hair: string;
  long?: boolean;
  beard?: string;
  moustache?: string;
  top: string;
  trim: string;
  shortSleeves?: boolean;
  pants: string;
  boots: string;
  belt?: string;
  tabard?: { field: string; edge: string; emblem: string };
  apron?: string;
  hood?: string;
  cap?: string;
  scarf?: string;
}

const tint = (hex: string, k: number): string =>
  `#${[1, 3, 5]
    .map((o) =>
      Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(o, o + 2), 16) * k)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Faces as the model has them: 0 its left, 1 its right, 2 top, 3 underside, 4 front, 5 back. */
type Draw = (face: number, i: number, j: number) => string | null;
const LIMBS: Record<string, [number, number, number, number, number, number, number]> = {
  head: [0, 0, 8, 8, 8, 32, 0],
  body: [16, 16, 8, 12, 4, 16, 32],
  armR: [40, 16, 4, 12, 4, 40, 32],
  armL: [32, 48, 4, 12, 4, 48, 48],
  legR: [0, 16, 4, 12, 4, 0, 32],
  legL: [16, 48, 4, 12, 4, 0, 48],
};
const FACE_LIGHT = [0.88, 0.88, 1.05, 0.7, 1, 0.92];

export function tailor(o: Outfit): Uint8ClampedArray {
  const px = new Uint8ClampedArray(64 * 64 * 4);
  const paint = (limb: string, outer: boolean, draw: Draw): void => {
    const [ox, oy, w, h, d, vx, vy] = LIMBS[limb]!;
    unwrap(outer ? vx : ox, outer ? vy : oy, w, h, d).forEach(([sx, sy, fw, fh], face) => {
      for (let j = 0; j < fh; j++)
        for (let i = 0; i < fw; i++) {
          const c = draw(face, i, j);
          if (!c) continue;
          // Cloth and skin are never one flat colour: darker lower down, a little uneven, dimmer on the sides.
          const k = FACE_LIGHT[face]! * (1 - (j / fh) * 0.1) * (1 + (ihash(sx + i, sy + j, 0, o.seed) - 0.5) * 0.09);
          const t = tint(c, k);
          px.set(
            [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16), 255],
            ((sy + j) * 64 + sx + i) * 4,
          );
        }
    });
  };

  paint("head", false, (face, i, j) => {
    if (face === 2) return o.hair;
    if (face === 3) return o.skin;
    const hairRows = face === 4 ? 2 : face === 5 ? (o.long ? 8 : 6) : o.long ? 7 : 4;
    if (j < hairRows) return o.hair;
    if (face === 4) {
      if (j === 2 && (i === 0 || i === 7 || i === 3)) return o.hair;
      if (j === 3 && (i === 1 || i === 2 || i === 5 || i === 6)) return tint(o.hair, 0.7);
      if (j === 4 && (i === 1 || i === 6)) return "#f4ecdf";
      if (j === 4 && (i === 2 || i === 5)) return o.eyes;
      if (o.moustache && j === 5 && i >= 2 && i <= 5) return o.moustache;
      if (j === 6 && (i === 3 || i === 4)) return tint(o.skin, 0.7);
      if (o.beard && j >= 5) return o.beard;
      if (j === 5 && (i === 3 || i === 4)) return tint(o.skin, 0.9);
    } else if (o.beard && face !== 5 && j >= 5) return o.beard;
    return o.skin;
  });
  paint("head", true, (face, i, j) => {
    if (o.hood) return face === 3 ? null : face !== 4 || j < 2 || i === 0 || i === 7 ? o.hood : null;
    if (o.cap) return face === 2 || j < 2 ? o.cap : face === 4 && j === 2 ? tint(o.cap, 0.8) : null;
    return null;
  });
  paint("body", false, (face, i, j) => {
    if (face === 2) return o.trim;
    if (face === 3) return o.pants;
    if (j === 0) return o.trim;
    if (j >= 10) return j === 10 && o.belt ? o.belt : o.pants;
    if (o.tabard && face >= 4 && i >= 1 && i <= 6) {
      if (i === 1 || i === 6 || j === 9) return o.tabard.edge;
      const dx = Math.abs(i - 3.5);
      const dy = Math.abs(j - 4.5);
      if (face === 4 && dx < 1 && dy < 1) return o.tabard.emblem;
      if (face === 4 && ((dx < 1 && dy < 2.6) || (dy < 1 && dx < 2.6))) return tint(o.tabard.emblem, 0.8);
      return o.tabard.field;
    }
    if (o.apron && face === 4 && i >= 1 && i <= 6 && j >= 2)
      return j === 6 && (i === 2 || i === 5) ? tint(o.apron, 0.8) : o.apron;
    if (face === 4 && (i === 3 || i === 4) && j % 3 === 1) return tint(o.top, 0.75);
    return o.top;
  });
  paint("body", true, (face, i, j) => {
    if (!o.scarf || face === 2 || face === 3) return null;
    return j < 2 || (face === 4 && i >= 5 && i <= 6 && j < 6) ? o.scarf : null;
  });
  for (const arm of ["armR", "armL"])
    paint(arm, false, (face, _i, j) => {
      const sleeve = o.shortSleeves ? 4 : 9;
      if (face === 2) return o.top;
      if (face === 3) return o.skin;
      return j < sleeve - 1 ? o.top : j === sleeve - 1 ? o.trim : o.skin;
    });
  for (const leg of ["legR", "legL"])
    paint(leg, false, (face, _i, j) => {
      if (face === 2) return o.pants;
      if (face === 3) return tint(o.boots, 0.6);
      return j >= 9 ? (j === 11 ? tint(o.boots, 0.7) : o.boots) : o.pants;
    });
  return px;
}

const flat = (hex: string): string => {
  const name = `flat_${hex.slice(1)}`;
  addTile(name, (x, y) => (ihash(x, y, 1, 400) < 0.15 ? tint(hex, 0.85) : hex));
  return name;
};

export interface Villager {
  outfit: Outfit;
  extras: Extra[];
}

/** The people of the grove. */
export const VILLAGERS: Record<string, Villager> = {
  // Keeps the fire and the old trees: hooded, grey-bearded, a lantern on a staff.
  keeper: {
    outfit: {
      seed: 1,
      skin: "#c98a5e",
      eyes: "#3a2a1a",
      hair: "#b9b2a6",
      long: true,
      beard: "#b9b2a6",
      top: "#3d4a2a",
      trim: "#6a5f1a",
      pants: "#3b2a1c",
      boots: "#241612",
      belt: "#74501f",
      hood: "#34401f",
    },
    extras: [
      { follow: "body", box: [-9.5, 9, 2.5, -8.5, 31, 3.5], tile: flat("#74501f") },
      { follow: "body", box: [-11, 27, 1, -7, 32, 5], tile: "bulb", emit: true },
      { follow: "body", box: [-11.5, 32, 0.5, -6.5, 33, 5.5], tile: flat("#2c1e25") },
    ],
  },
  // Buys and sells: a pack as big as he is, a bedroll on top, a red scarf.
  trader: {
    outfit: {
      seed: 2,
      skin: "#e8b48a",
      eyes: "#2c1e25",
      hair: "#3b1910",
      moustache: "#3b1910",
      top: "#8a6426",
      trim: "#d49045",
      pants: "#47253b",
      boots: "#2a110c",
      belt: "#241612",
      scarf: "#a63a2e",
      cap: "#763332",
    },
    extras: [
      { follow: "body", box: [-4.5, 12.5, -7, 4.5, 23, -2], tile: "crate" },
      { follow: "body", box: [-5.5, 23, -6.5, 5.5, 26, -2.5], tile: "rug" },
    ],
  },
  // Carries the guild's news: its purple and gold, the sun on her tabard, a feather in her cap.
  herald: {
    outfit: {
      seed: 3,
      skin: "#f0c9a0",
      eyes: "#3d2050",
      hair: "#d49045",
      long: true,
      top: "#3d2050",
      trim: "#f5b95e",
      pants: "#2c1e25",
      boots: "#241612",
      tabard: { field: "#54286a", edge: "#d49045", emblem: "#f5b95e" },
      cap: "#54286a",
    },
    extras: [
      { follow: "head", box: [2.5, 32, -1, 3.5, 38, 0], tile: flat("#f5b95e") },
      { follow: "head", box: [3.5, 34, -1, 4.5, 37, 0], tile: flat("#d49045") },
    ],
  },
  // Cooks for whoever sits down: apron, sleeves rolled, a marshmallow always on the stick.
  cook: {
    outfit: {
      seed: 4,
      skin: "#8a5a3c",
      eyes: "#241612",
      hair: "#241612",
      top: "#b8843a",
      trim: "#e0c39a",
      shortSleeves: true,
      pants: "#3b2a1c",
      boots: "#241612",
      apron: "#e9dcc3",
      cap: "#a63a2e",
    },
    extras: [
      { follow: "armR", box: [-6.5, -5, -0.5, -5.5, 13, 0.5], tile: flat("#74501f") },
      { follow: "armR", box: [-7, -7, -1, -5, -4.5, 1], tile: flat("#fff3cf") },
    ],
  },
};
