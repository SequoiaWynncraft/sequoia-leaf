/**
 * Generic 8x8 player heads, made up per member from their seed: hair, skin, eyes and the odd hat
 * or pair of glasses. Our own face design, not any game's default skin, and no real player's.
 */

import { hashString, Rng } from "../../engine/rng.ts";

type Rgb = readonly [number, number, number];

const SKIN: readonly Rgb[] = [
  [246, 214, 184],
  [234, 190, 150],
  [214, 160, 118],
  [178, 122, 84],
  [138, 92, 62],
  [104, 68, 48],
];
const HAIR: readonly Rgb[] = [
  [58, 38, 26],
  [96, 62, 36],
  [150, 98, 52],
  [214, 172, 96],
  [40, 38, 48],
  [176, 74, 42],
  [222, 214, 200],
  [122, 94, 176],
  [74, 138, 122],
];
const EYES: readonly Rgb[] = [
  [70, 110, 190],
  [70, 150, 92],
  [104, 64, 34],
  [120, 128, 144],
  [170, 120, 40],
];
const HATS: readonly Rgb[] = [
  [96, 60, 150],
  [64, 120, 90],
  [180, 70, 60],
  [210, 170, 80],
  [70, 90, 140],
];

const dark = (c: Rgb, k: number): Rgb => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

/** A head as 64 colours, row by row. */
export function playerHead(seed: string): Rgb[] {
  const rng = new Rng(hashString(`${seed}:head`));
  const skin = rng.pick(SKIN);
  const hair = rng.pick(HAIR);
  const eye = rng.pick(EYES);
  const style = rng.int(0, 4);
  const hat = rng.chance(0.22) ? rng.pick(HATS) : null;
  const glasses = rng.chance(0.16);
  const beard = rng.chance(0.18);
  const px: Rgb[] = Array.from({ length: 64 }, () => skin);
  const set = (x: number, y: number, c: Rgb): void => {
    if (x >= 0 && x < 8 && y >= 0 && y < 8) px[y * 8 + x] = c;
  };
  // Skin shading: the jaw a touch darker.
  for (let x = 0; x < 8; x++) set(x, 7, dark(skin, 0.88));
  // Hair: always the top two rows, then by style.
  const h2 = dark(hair, 0.78);
  for (let x = 0; x < 8; x++) {
    set(x, 0, hair);
    set(x, 1, x % 3 === 1 ? h2 : hair);
  }
  if (style === 0) {
    // Short, with sideburns.
    set(0, 2, hair);
    set(7, 2, hair);
    set(0, 3, h2);
    set(7, 3, h2);
  } else if (style === 1) {
    // A side-swept fringe.
    for (let x = 0; x < 4; x++) set(x, 2, x === 3 ? h2 : hair);
    set(7, 2, hair);
  } else if (style === 2) {
    // Long: down both sides.
    for (let y = 2; y < 8; y++) {
      set(0, y, y > 5 ? h2 : hair);
      set(7, y, y > 5 ? h2 : hair);
    }
    set(1, 2, hair);
    set(6, 2, hair);
  } else if (style === 3) {
    // Curly: an uneven hairline.
    set(0, 2, hair);
    set(2, 2, h2);
    set(5, 2, hair);
    set(7, 2, hair);
    set(0, 3, hair);
    set(7, 3, hair);
  } else {
    // Buzzed: a soft line only.
    for (let x = 0; x < 8; x++) set(x, 1, x % 2 ? skin : h2);
  }
  // Eyes on row 4: white outside, colour inside.
  const white: Rgb = [240, 240, 240];
  set(1, 4, white);
  set(2, 4, eye);
  set(5, 4, eye);
  set(6, 4, white);
  // Brows, nose, mouth.
  set(1, 3, dark(hair, 0.7));
  set(2, 3, dark(hair, 0.7));
  set(5, 3, dark(hair, 0.7));
  set(6, 3, dark(hair, 0.7));
  set(3, 5, dark(skin, 0.86));
  set(4, 5, dark(skin, 0.86));
  set(3, 6, dark(skin, 0.62));
  set(4, 6, dark(skin, 0.62));
  if (beard) {
    for (let x = 1; x < 7; x++) set(x, 7, hair);
    set(1, 6, hair);
    set(2, 6, h2);
    set(5, 6, h2);
    set(6, 6, hair);
  }
  if (glasses) {
    const g: Rgb = [30, 28, 36];
    set(0, 4, g);
    set(3, 4, g);
    set(4, 4, g);
    set(7, 4, g);
  }
  if (hat) {
    for (let x = 0; x < 8; x++) {
      set(x, 0, hat);
      set(x, 1, dark(hat, 0.75));
    }
    set(2, 0, dark(hat, 1.2));
  }
  return px;
}
