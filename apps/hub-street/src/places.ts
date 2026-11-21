/**
 * The places along the street, painted onto the street's fixed layer: the Treasury in its trunk,
 * the quest board, the market stalls, the campfire's ring and seats, the Works in its stump, the
 * crab pond, the signpost and the lamp posts. Whatever moves (signs, gears, flames, Cinfy) is kept
 * out of the fixed picture and handed back as sprites for the game to draw each frame.
 */
import {
  C,
  dice,
  disc,
  type G,
  iconSprite,
  line,
  mix,
  oval,
  rect,
  type Sprite,
  sprite,
  stamp,
  stamped,
} from "./art.ts";
import { type Frame, LIT, trunk } from "./scene.ts";
import { FIRE_X, LAMPS, place, POND_RX, POND_X, STALLS, WORKS_DOOR, WORKS_X } from "./world.ts";

const LANTERN = [".kdk.", "kdddk", "dywyd", "dywyd", "dyyyd", "kdddk", ".kdk."];

export interface Moving {
  readonly doorHalf: Sprite;
  readonly sunSign: Sprite;
  readonly gearBig: Sprite;
  readonly gearSmall: Sprite;
  readonly lanternLit: Sprite;
  readonly lanternDark: Sprite;
  readonly lanternGold: Sprite;
  readonly banners: readonly Sprite[];
  readonly crab: readonly [Sprite, Sprite];
  readonly cinfyHat: Sprite;
  readonly paper: Sprite;
}

/** A sprite cut to a round window: what is painted by `inside` shows only within the disc. */
function round(r: number, inside: (g: G, size: number) => void): Sprite {
  const size = r * 2 + 1;
  const s = sprite(size, size);
  inside(s.g, size);
  const hole = sprite(size, size);
  disc(hole.g, r, r, r, "#000");
  s.g.globalCompositeOperation = "destination-in";
  s.g.drawImage(hole.c, 0, 0);
  s.g.globalCompositeOperation = "source-over";
  return s;
}

function gear(radius: number, teeth: number): Sprite {
  const size = radius * 2 + 1;
  const s = sprite(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - radius;
      const dy = y - radius;
      const d = Math.hypot(dx, dy);
      const turn = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
      const tooth = (turn * teeth) % 1 < 0.5;
      if (d > radius + 0.3 || (d > radius - 2.2 && !tooth)) continue;
      if (d < radius * 0.17) continue;
      const spoke = (turn * 4 + 0.07) % 1 < 0.3;
      if (d > radius * 0.42 && d < radius * 0.66 && !spoke && radius > 8) continue;
      const rim = d > radius - 4.2;
      const hub = d < radius * 0.36;
      const lit = dx + dy < -radius * 0.2;
      rect(
        s.g,
        x,
        y,
        1,
        1,
        hub ? C.gold1 : rim ? (lit ? C.gold1 : C.gold0) : lit ? C.gold0 : mix(C.gold0, C.bark1, 0.45),
      );
    }
  return s;
}

function banner(field: string): Sprite {
  const s = sprite(13, 27);
  const g = s.g;
  const dark = mix(field, C.ink, 0.25);
  rect(g, 0, 0, 13, 2, C.bark1);
  rect(g, 0, 0, 13, 1, C.bark3);
  rect(g, 1, 2, 11, 19, field);
  rect(g, 1, 2, 11, 1, dark);
  for (let i = 0; i < 6; i++) {
    rect(g, 1, 21 + i, Math.max(0, 5 - i), 1, field);
    rect(g, 12 - Math.max(0, 5 - i), 21 + i, Math.max(0, 5 - i), 1, field);
    if (5 - i > 0) {
      rect(g, 1, 21 + i, 1, 1, C.gold0);
      rect(g, 11, 21 + i, 1, 1, C.gold0);
    }
  }
  rect(g, 1, 3, 1, 18, C.gold0);
  rect(g, 11, 3, 1, 18, C.gold0);
  rect(g, 2, 19, 9, 1, C.gold0);
  // The guild's tree.
  const tree: readonly (readonly [number, number, number])[] = [
    [6, 5, 1],
    [5, 6, 3],
    [6, 7, 1],
    [5, 8, 3],
    [4, 9, 5],
    [5, 10, 3],
    [4, 11, 5],
    [3, 12, 7],
    [6, 13, 1],
    [6, 14, 1],
    [5, 15, 3],
  ];
  for (const [x, y, w] of tree) rect(g, x, y, w, 1, C.gold1);
  rect(g, 6, 5, 1, 1, C.gold2);
  return s;
}

function lantern(swap: Record<string, string>): Sprite {
  return stamped(LANTERN, swap);
}

function barrel(g: G, x: number, by: number): void {
  rect(g, x, by - 10, 10, 10, C.bark2);
  rect(g, x, by - 10, 2, 10, C.bark1);
  rect(g, x + 6, by - 10, 1, 10, C.bark3);
  rect(g, x, by - 8, 10, 1, C.stone0);
  rect(g, x, by - 3, 10, 1, C.stone0);
  rect(g, x + 1, by - 11, 8, 1, C.bark3);
}

function crate(g: G, x: number, by: number, w: number, h: number): void {
  rect(g, x, by - h, w, h, C.bark3);
  rect(g, x, by - h, w, 1, C.bark4);
  rect(g, x, by - 1, w, 1, C.bark1);
  rect(g, x, by - h, 1, h, C.bark1);
  rect(g, x + w - 1, by - h, 1, h, C.bark1);
  line(g, x + 1, by - h + 1, x + w - 2, by - 2, C.bark2);
}

function hangLantern(g: G, x: number, y: number, lit: Sprite): void {
  rect(g, x + 2, y - 2, 1, 2, C.bark0);
  g.drawImage(lit.c, x, y);
}

function paintTreasury(g: G, f: Frame, lit: Sprite): Sprite {
  const cx = place("treasury").x;
  const by = f.by;
  const R = 21;
  const cy = by - R;
  // Two round windows up the trunk.
  for (const side of [-1, 1]) {
    const wx = cx + side * 37;
    disc(g, wx, by - 54, 6, C.bark0);
    disc(g, wx, by - 54, 5, C.bark4);
    disc(g, wx, by - 54, 4, C.gold2);
    disc(g, wx - 1, by - 55, 2, C.gold3);
    rect(g, wx, by - 58, 1, 9, C.bark1);
    rect(g, wx - 4, by - 54, 9, 1, C.bark1);
  }
  // The round doorway: a dark rim, a carved frame with gold studs, and the lit room within.
  disc(g, cx, cy, R + 3, C.bark0);
  disc(g, cx, cy, R + 2, C.bark4);
  disc(g, cx, cy, R, C.bark1);
  for (let i = 0; i < 14; i++) {
    const a = Math.PI + (i / 13) * Math.PI;
    rect(g, Math.round(cx + Math.cos(a) * (R + 1)), Math.round(cy + Math.sin(a) * (R + 1)), 1, 1, C.gold1);
  }
  const r = dice(88);
  const room = round(R - 2, (rg, size) => {
    rect(rg, 0, 0, size, size, mix(C.gold0, C.bark3, 0.3));
    disc(rg, size / 2, 6, 12, C.gold0);
    disc(rg, size / 2, 5, 8, C.gold1);
    disc(rg, size / 2, 4, 4, C.gold2);
    rect(rg, size / 2 - 1, 0, 1, 3, C.bark0);
    rect(rg, size / 2 - 2, 3, 3, 3, C.gold3);
    const jars = [C.sky4, C.green3, C.gold2, C.sky3, C.sky5, "#9fd0e8", C.gold3];
    for (const shelf of [13, 21]) {
      rect(rg, 0, shelf, size, 1, C.bark2);
      rect(rg, 0, shelf + 1, size, 1, C.bark1);
      for (let x = 2; x < size - 3; x += 4) {
        const tall = 2 + Math.floor(r() * 3);
        rect(rg, x, shelf - tall, 2, tall, jars[Math.floor(r() * jars.length)] ?? C.gold2);
        rect(rg, x, shelf - tall - 1, 2, 1, C.bark1);
      }
    }
  });
  g.drawImage(room.c, cx - (R - 2), cy - (R - 2));
  // The step.
  rect(g, cx - 28, by - 2, 56, 3, C.stone1);
  rect(g, cx - 28, by - 2, 56, 1, C.stone3);
  rect(g, cx - 26, by + 1, 52, 1, C.stone0);
  for (let x = cx - 20; x < cx + 26; x += 13) rect(g, x, by - 1, 1, 2, C.stone0);
  // The beam the sun sign hangs from.
  rect(g, cx - 18, by - 72, 36, 3, C.bark0);
  rect(g, cx - 18, by - 72, 36, 1, C.bark2);
  rect(g, cx - 19, by - 73, 2, 5, C.bark0);
  rect(g, cx + 17, by - 73, 2, 5, C.bark0);
  // A lantern on a hook, a barrel of lavender, and a crate.
  rect(g, cx + 27, by - 40, 7, 1, C.bark0);
  hangLantern(g, cx + 30, by - 38, lit);
  barrel(g, cx - 47, by);
  const stems = [C.green2, C.green3, C.green2];
  for (let i = 0; i < 6; i++) {
    const x = cx - 46 + i * 2 - (i % 2);
    const h = 4 + ((i * 3) % 5);
    rect(g, x, by - 11 - h, 1, h, stems[i % 3] ?? C.green2);
    rect(g, x, by - 13 - h, 1, 3, i % 2 ? C.sky4 : C.sky3);
  }
  crate(g, cx + 38, by, 10, 8);
  rect(g, cx + 41, by - 11, 5, 3, C.gold0);
  rect(g, cx + 42, by - 12, 3, 1, C.gold1);

  // The lower half of the door, with its counter: drawn each frame, in front of Cinfy.
  const half = sprite(47, 24);
  const wood = round(R - 2, (rg, size) => {
    rect(rg, 0, 0, size, size, C.bark3);
    for (let x = 3; x < size; x += 6) rect(rg, x, 0, 1, size, C.bark1);
    rect(rg, 0, R + 4, size, 2, C.gold0);
    rect(rg, 0, R + 4, size, 1, C.gold1);
    rect(rg, size / 2 - 2, R + 9, 4, 4, C.gold0);
    rect(rg, size / 2 - 1, R + 10, 2, 2, C.gold2);
  });
  half.g.drawImage(wood.c, 0, R, wood.w, wood.h - R, 4, 4, wood.w, wood.h - R);
  rect(half.g, 1, 1, 45, 3, C.bark4);
  rect(half.g, 1, 1, 45, 1, C.gold0);
  rect(half.g, 1, 4, 45, 1, C.bark0);
  return half;
}

function paintSunSign(): Sprite {
  const s = sprite(21, 25);
  const g = s.g;
  // Two short chains, then the sun.
  for (let y = 0; y < 5; y++) {
    rect(g, 6, y, 1, 1, y % 2 ? C.gold0 : C.bark1);
    rect(g, 14, y, 1, 1, y % 2 ? C.gold0 : C.bark1);
  }
  const cx = 10;
  const cy = 14;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    line(g, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, C.gold1);
  }
  disc(g, cx, cy, 7, C.gold0);
  disc(g, cx, cy, 6, C.gold1);
  disc(g, cx - 1, cy - 1, 4, C.gold2);
  disc(g, cx - 1, cy - 2, 2, C.gold3);
  return s;
}

function paintBoard(g: G, f: Frame, lit: Sprite): void {
  const cx = place("quests").x;
  const by = f.by;
  for (const x of [cx - 21, cx + 19]) {
    rect(g, x, by - 42, 3, 42, C.bark1);
    rect(g, x, by - 42, 1, 42, C.bark3);
  }
  rect(g, cx - 25, by - 46, 50, 31, C.bark0);
  rect(g, cx - 24, by - 45, 48, 29, C.bark3);
  for (let y = by - 38; y < by - 17; y += 7) rect(g, cx - 24, y, 48, 1, C.bark2);
  // A little roof.
  for (let i = 0; i < 7; i++) {
    const w = 22 + i * 6;
    rect(g, cx - w / 2, by - 54 + i, w, 1, i % 2 ? C.sky1 : C.sky2);
  }
  rect(g, cx - 11, by - 55, 22, 1, C.sky3);
  rect(g, cx - 29, by - 47, 58, 1, C.sky0);
  // Notices, each with its pin.
  const paper = (x: number, y: number, w: number, h: number, tone: string): void => {
    rect(g, x + 1, y + 1, w, h, C.bark1);
    rect(g, x, y, w, h, tone);
    for (let row = 3; row < h - 2; row += 2) rect(g, x + 2, y + row, w - 4 - (row % 4), 1, C.gold0);
    rect(g, x + Math.floor(w / 2), y - 1, 1, 2, C.sky5);
  };
  paper(cx - 21, by - 43, 12, 14, C.gold3);
  paper(cx - 6, by - 44, 12, 13, C.gold3);
  paper(cx + 9, by - 43, 12, 15, mix(C.gold3, C.earth2, 0.25));
  paper(cx - 18, by - 27, 8, 8, C.gold2);
  rect(g, cx - 4, by - 28, 11, 9, C.green3);
  rect(g, cx - 4, by - 28, 11, 1, C.gold3);
  line(g, cx - 3, by - 21, cx + 5, by - 26, C.earth2);
  rect(g, cx + 3, by - 27, 2, 2, C.sky5);
  paper(cx + 11, by - 26, 9, 7, C.gold3);
  rect(g, cx - 13, by - 31, 3, 3, C.gold1);
  rect(g, cx - 12, by - 30, 1, 1, C.gold3);
  // A lantern from the eave.
  hangLantern(g, cx + 25, by - 45, lit);
}

function paintStall(g: G, f: Frame, sx: number, a: string, b: string, kind: number, lit: Sprite): void {
  const by = f.by;
  for (const x of [sx - 25, sx + 23]) {
    rect(g, x, by - 48, 2, 48, C.bark1);
    rect(g, x, by - 48, 1, 48, C.bark3);
  }
  // The back cloth, in shade, so the goods have something to sit against.
  rect(g, sx - 23, by - 44, 46, 28, mix(C.sky0, C.bark0, 0.4));
  rect(g, sx - 23, by - 30, 46, 1, C.bark1);
  // The counter.
  rect(g, sx - 24, by - 14, 48, 14, C.bark3);
  for (let x = sx - 24; x < sx + 24; x += 8) rect(g, x, by - 14, 1, 14, C.bark1);
  rect(g, sx - 24, by - 14, 48, 1, C.bark1);
  rect(g, sx - 24, by - 2, 48, 2, C.bark1);
  rect(g, sx - 27, by - 17, 54, 3, C.bark4);
  rect(g, sx - 27, by - 17, 54, 1, mix(C.bark4, C.gold2, 0.3));
  // The awning: stripes, a shaded hem, and a scalloped edge.
  rect(g, sx - 30, by - 56, 60, 2, C.bark0);
  for (let i = 0; i < 7; i++) {
    const colour = i % 2 ? b : a;
    const x = sx - 28 + i * 8;
    rect(g, x, by - 54, 8, 7, colour);
    rect(g, x, by - 54, 8, 1, mix(colour, C.gold3, 0.25));
    rect(g, x, by - 47, 8, 2, mix(colour, C.ink, 0.2));
    rect(g, x, by - 45, 8, 1, mix(colour, C.ink, 0.2));
    rect(g, x + 1, by - 44, 6, 1, mix(colour, C.ink, 0.2));
    rect(g, x + 2, by - 43, 4, 1, mix(colour, C.ink, 0.3));
  }
  if (kind === 0) {
    // Apples, bottles, and a scarf laid out.
    crate(g, sx - 23, by - 17, 15, 5);
    for (let i = 0; i < 4; i++) {
      rect(g, sx - 22 + i * 3 + (i % 2), by - 25 + (i % 2), 3, 3, "#c9453a");
      rect(g, sx - 22 + i * 3 + (i % 2), by - 25 + (i % 2), 1, 1, C.sky5);
    }
    const bottles = [C.gold1, C.sky4, "#9fd0e8", C.green3];
    bottles.forEach((tone, i) => {
      rect(g, sx - 4 + i * 4, by - 23, 2, 6, tone);
      rect(g, sx - 4 + i * 4, by - 25, 2, 2, mix(tone, C.gold3, 0.4));
      rect(g, sx - 4 + i * 4, by - 26, 2, 1, C.bark3);
    });
    rect(g, sx + 13, by - 20, 11, 3, C.sky4);
    rect(g, sx + 13, by - 19, 11, 1, C.gold3);
    rect(g, sx + 20, by - 17, 3, 5, C.sky4);
    rect(g, sx + 20, by - 15, 3, 1, C.gold3);
    // The whistle hangs from the awning rail.
    rect(g, sx - 12, by - 42, 1, 4, C.bark1);
    rect(g, sx - 14, by - 38, 6, 3, C.sky5);
    rect(g, sx - 9, by - 39, 2, 1, C.sky5);
  } else {
    // Flowers in buckets, rolled poems, and a bucket of green stones.
    for (let i = 0; i < 2; i++) {
      const x = sx - 22 + i * 9;
      rect(g, x, by - 22, 7, 5, C.stone1);
      rect(g, x, by - 22, 7, 1, C.stone3);
      const heads = [C.sky4, C.gold2, C.gold3, C.sky5];
      for (let k = 0; k < 3; k++) {
        const h = 4 + ((k + i) % 3) * 2;
        rect(g, x + 1 + k * 2, by - 22 - h, 1, h, C.green2);
        rect(g, x + k * 2, by - 24 - h, 3, 2, heads[(k + i * 2) % 4] ?? C.sky4);
      }
    }
    for (let i = 0; i < 3; i++) {
      rect(g, sx - 2 + i * 4, by - 20 - (i % 2), 3, 3 + (i % 2), C.gold3);
      rect(g, sx - 2 + i * 4, by - 19, 3, 1, C.sky5);
    }
    rect(g, sx + 12, by - 23, 10, 6, C.stone2);
    rect(g, sx + 12, by - 23, 10, 1, C.stone3);
    rect(g, sx + 11, by - 24, 12, 1, C.stone1);
    for (let i = 0; i < 4; i++) {
      rect(g, sx + 13 + i * 2, by - 26 - (i % 2), 2, 2, C.green4);
      rect(g, sx + 13 + i * 2, by - 26 - (i % 2), 1, 1, C.gold3);
    }
  }
  hangLantern(g, sx - 30, by - 46, lit);
}

function paintFire(g: G, f: Frame): void {
  const by = f.by;
  const cx = FIRE_X;
  oval(g, cx, by + 1, 17, 3, C.earth0);
  // The bench: a log on its side, with a cut end.
  rect(g, cx - 54, by - 8, 36, 8, C.bark2);
  rect(g, cx - 54, by - 8, 36, 1, C.bark4);
  rect(g, cx - 54, by - 7, 36, 1, C.bark3);
  rect(g, cx - 54, by - 2, 36, 2, C.bark0);
  for (let x = cx - 48; x < cx - 20; x += 9) rect(g, x, by - 5, 4, 1, C.bark1);
  oval(g, cx - 54, by - 4, 2, 4, C.earth2);
  oval(g, cx - 54, by - 4, 1, 2, C.gold0);
  rect(g, cx - 50, by - 1, 3, 2, C.bark0);
  rect(g, cx - 24, by - 1, 3, 2, C.bark0);
  // Two stumps to sit on.
  for (const x of [cx + 27, cx + 44]) {
    rect(g, x - 5, by - 7, 11, 8, C.bark2);
    rect(g, x + 3, by - 7, 3, 8, C.bark1);
    rect(g, x - 5, by - 7, 1, 8, C.bark1);
    oval(g, x, by - 8, 5, 1, C.earth2);
    rect(g, x - 1, by - 8, 3, 1, C.gold0);
  }
  // Split wood, stacked.
  for (let i = 0; i < 3; i++) {
    rect(g, cx + 62 + i * 5, by - 4, 5, 4, C.bark2);
    rect(g, cx + 63 + i * 5, by - 3, 3, 2, C.earth2);
  }
  for (let i = 0; i < 2; i++) {
    rect(g, cx + 64 + i * 5, by - 8, 5, 4, C.bark3);
    rect(g, cx + 65 + i * 5, by - 7, 3, 2, C.gold0);
  }
  // The fire's own logs, and its ring of stones in front.
  line(g, cx - 8, by - 2, cx + 7, by - 8, C.bark1, 2);
  line(g, cx - 7, by - 8, cx + 8, by - 2, C.bark0, 2);
  const tones = [C.stone1, C.stone2, C.stone3, C.stone2];
  for (let i = 0; i < 7; i++) {
    const x = cx - 14 + i * 4;
    const y = by - 1 + (i === 0 || i === 6 ? -2 : i === 1 || i === 5 ? -1 : 0);
    rect(g, x, y, 4, 3, tones[i % 4] ?? C.stone1);
    rect(g, x, y, 4, 1, C.stone3);
    rect(g, x, y + 2, 4, 1, C.stone0);
  }
}

function paintWorks(g: G, f: Frame, lit: Sprite): void {
  const cx = WORKS_X;
  const by = f.by;
  // The stump: wide, cut flat, with a splintered shoulder on the left where it broke.
  trunk(g, cx, 132, by - 62, f.wy - 6, 271, LIT, 13);
  const r = dice(19);
  for (let x = cx - 66; x < cx - 26;) {
    const w = 3 + Math.floor(r() * 3);
    const h = Math.round(4 + (1 - (x - (cx - 66)) / 40) * 16 * (0.5 + r() * 0.5));
    rect(g, x, by - 62 - h, w, h + 1, C.bark2);
    rect(g, x, by - 62 - h, 1, h + 1, C.bark1);
    rect(g, x + w - 1, by - 62 - h + 1, 1, h, C.bark3);
    x += w;
  }
  rect(g, cx - 26, by - 64, 92, 2, C.earth2);
  for (let x = cx - 22; x < cx + 62; x += 7) rect(g, x, by - 64, 3, 1, C.gold2);
  rect(g, cx - 26, by - 62, 92, 1, C.bark0);

  // A window, lit.
  rect(g, cx - 59, by - 46, 13, 13, C.bark0);
  rect(g, cx - 58, by - 45, 11, 11, C.gold2);
  rect(g, cx - 57, by - 44, 4, 4, C.gold3);
  rect(g, cx - 53, by - 45, 1, 11, C.bark1);
  rect(g, cx - 58, by - 40, 11, 1, C.bark1);
  rect(g, cx - 60, by - 33, 15, 2, C.bark4);

  // The doorway: a stone arch, dark inside, with the forge glowing at the back.
  const dx = WORKS_DOOR;
  oval(g, dx, by - 27, 19, 14, C.stone0);
  rect(g, dx - 19, by - 27, 39, 27, C.stone0);
  oval(g, dx, by - 27, 18, 13, C.stone1);
  rect(g, dx - 18, by - 27, 37, 27, C.stone1);
  for (let i = 0; i < 11; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    const sx = Math.round(dx + Math.cos(a) * 16.5);
    const sy = Math.round(by - 27 + Math.sin(a) * 11.5);
    rect(g, sx, sy, 1, 2, C.stone0);
    rect(g, sx + 1, sy, 1, 1, C.stone3);
  }
  for (let y = by - 24; y < by; y += 6) {
    rect(g, dx - 18, y, 4, 1, C.stone0);
    rect(g, dx + 15, y, 4, 1, C.stone0);
    rect(g, dx - 17, y + 1, 2, 1, C.stone3);
    rect(g, dx + 16, y + 1, 2, 1, C.stone3);
  }
  oval(g, dx, by - 27, 14, 10, C.sky0);
  rect(g, dx - 14, by - 27, 29, 27, C.sky0);
  rect(g, dx - 2, by - 43, 5, 5, C.stone3);
  rect(g, dx - 2, by - 39, 5, 1, C.stone0);
  // Inside: the glow, an anvil, tools on hooks.
  oval(g, dx + 7, by - 6, 9, 9, mix(C.sky0, C.sky5, 0.22));
  oval(g, dx + 8, by - 5, 6, 6, mix(C.sky0, C.sky5, 0.42));
  rect(g, dx + 5, by - 13, 9, 13, C.bark0);
  rect(g, dx + 7, by - 9, 5, 6, C.sky5);
  rect(g, dx + 8, by - 8, 3, 4, C.gold1);
  rect(g, dx + 9, by - 7, 1, 2, C.gold3);
  rect(g, dx - 10, by - 9, 10, 3, C.stone1);
  rect(g, dx - 12, by - 9, 2, 1, C.stone1);
  rect(g, dx - 10, by - 9, 10, 1, C.stone3);
  rect(g, dx - 7, by - 6, 5, 2, C.stone0);
  rect(g, dx - 8, by - 4, 7, 4, C.stone0);
  for (let i = 0; i < 4; i++) {
    const x = dx - 9 + i * 4;
    rect(g, x, by - 34, 1, 6 + (i % 2) * 2, C.bark3);
    rect(g, x - 1, by - 28 + (i % 2) * 2, 3, 2, i % 2 ? C.stone2 : C.stone3);
  }

  // A porch of plum shingles on two posts.
  for (const x of [dx - 23, dx + 22]) {
    rect(g, x, by - 48, 2, 48, C.bark1);
    rect(g, x, by - 48, 1, 48, C.bark3);
  }
  for (let i = 0; i < 3; i++) {
    const w = 46 + i * 6;
    const y = by - 57 + i * 3;
    rect(g, dx - w / 2, y, w, 3, C.sky2);
    rect(g, dx - w / 2, y, w, 1, C.sky3);
    rect(g, dx - w / 2, y + 2, w, 1, C.sky1);
    for (let x = dx - w / 2 + 2 + (i % 2) * 3; x < dx + w / 2; x += 6) rect(g, x, y + 1, 1, 2, C.sky1);
  }

  // Where the gears turn: a plate behind each.
  disc(g, cx + 36, by - 42, 15, mix(C.bark0, C.ink, 0.3));
  disc(g, cx + 49, by - 30, 9, mix(C.bark0, C.ink, 0.3));

  // The chimney, of stone.
  rect(g, cx + 50, by - 80, 13, 18, C.stone1);
  rect(g, cx + 50, by - 80, 2, 18, C.stone3);
  rect(g, cx + 60, by - 80, 3, 18, C.stone0);
  for (let y = by - 77; y < by - 62; y += 4) {
    rect(g, cx + 50, y, 13, 1, C.stone0);
    rect(g, cx + 54 + ((y >> 2) % 2) * 4, y - 3, 1, 3, C.stone0);
  }
  rect(g, cx + 48, by - 83, 17, 3, C.stone2);
  rect(g, cx + 48, by - 83, 17, 1, C.stone3);
  rect(g, cx + 51, by - 84, 11, 1, C.ink);

  // The sign: a gear on a hanging board.
  rect(g, cx - 82, by - 60, 18, 2, C.bark0);
  rect(g, cx - 82, by - 60, 18, 1, C.bark2);
  rect(g, cx - 79, by - 58, 1, 3, C.gold0);
  rect(g, cx - 70, by - 58, 1, 3, C.gold0);
  rect(g, cx - 82, by - 55, 16, 16, C.bark0);
  rect(g, cx - 81, by - 54, 14, 14, C.bark2);
  g.drawImage(iconSprite("gear").c, cx - 80, by - 53);
  barrel(g, cx - 84, by);

  // A belt out of a hatch on the right, to a crate; and a bucket by the door for coins.
  rect(g, cx + 62, by - 24, 5, 10, C.ink);
  rect(g, cx + 61, by - 25, 7, 1, C.stone1);
  rect(g, cx + 64, by - 14, 30, 2, C.stone0);
  rect(g, cx + 64, by - 15, 30, 1, C.stone2);
  for (const x of [cx + 68, cx + 88]) rect(g, x, by - 12, 2, 12, C.bark0);
  crate(g, cx + 95, by, 13, 10);
  rect(g, dx + 26, by - 7, 8, 7, C.stone2);
  rect(g, dx + 26, by - 7, 8, 1, C.stone3);
  rect(g, dx + 25, by - 8, 10, 1, C.stone1);
  rect(g, dx + 27, by - 9, 6, 1, C.gold1);
  hangLantern(g, dx - 28, by - 46, lit);
}

function paintPond(g: G, f: Frame, crab: Sprite): void {
  const cx = POND_X;
  const by = f.by;
  oval(g, cx, by - 5, POND_RX + 5, 8, C.earth0);
  oval(g, cx, by - 5, POND_RX + 3, 7, C.earth1);
  oval(g, cx, by - 6, POND_RX, 6, mix(C.sky1, C.sky2, 0.45));
  oval(g, cx, by - 7, POND_RX - 7, 4, C.sky2);
  // The sunset, lying on the water.
  oval(g, cx + 8, by - 7, 30, 3, C.sky3);
  oval(g, cx + 8, by - 7, 19, 2, C.sky4);
  rect(g, cx - 2, by - 8, 20, 1, C.sky5);
  rect(g, cx + 3, by - 6, 11, 1, C.gold1);
  rect(g, cx - 34, by - 9, 12, 1, C.sky3);
  rect(g, cx - 44, by - 5, 9, 1, C.sky3);
  rect(g, cx + 36, by - 4, 10, 1, C.sky3);
  // Stones set evenly round the near edge.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.1 + (i / 8) * 0.8);
    const x = Math.round(cx + Math.cos(a) * (POND_RX + 3));
    const y = Math.round(by - 5 + Math.sin(a) * 7);
    rect(g, x - 2, y - 1, 5, 2, i % 2 ? C.stone1 : C.stone2);
    rect(g, x - 1, y - 2, 3, 1, C.stone3);
  }
  // Reeds at both ends, and lily pads.
  for (const [side, base] of [
    [-1, cx - POND_RX - 2],
    [1, cx + POND_RX - 4],
  ] as const) {
    for (let i = 0; i < 5; i++) {
      const x = base + i * 2 * side;
      const h = 9 + ((i * 5) % 9);
      rect(g, x, by - 5 - h, 1, h, i % 2 ? C.green2 : C.green3);
      if (i % 2 === 0) {
        rect(g, x - 1, by - 6 - h, 2, 4, C.bark1);
        rect(g, x - 1, by - 6 - h, 1, 3, C.bark3);
      }
    }
  }
  for (const [x, y] of [
    [cx - 30, by - 4],
    [cx - 12, by - 10],
    [cx + 40, by - 7],
  ] as const) {
    oval(g, x, y, 3, 1, C.green3);
    rect(g, x - 2, y - 1, 3, 1, C.green4);
    rect(g, x + 2, y - 1, 1, 1, C.sky4);
  }
  // The tally board: a crab, and four strokes with a fifth struck through... nearly.
  const sx = place("pond").x0 + 11;
  rect(g, sx - 1, by - 22, 2, 22, C.bark1);
  rect(g, sx - 12, by - 34, 24, 14, C.bark0);
  rect(g, sx - 11, by - 33, 22, 12, C.bark3);
  g.drawImage(crab.c, sx - 10, by - 31);
  for (let i = 0; i < 4; i++) rect(g, sx + 3 + i * 2, by - 31, 1, 6, C.gold3);
  rect(g, sx + 3, by - 24, 6, 1, C.gold3);
  // A very small house.
  const hx = cx + POND_RX + 14;
  rect(g, hx - 5, by - 7, 11, 7, C.bark3);
  rect(g, hx - 5, by - 7, 1, 7, C.bark1);
  for (let i = 0; i < 4; i++) rect(g, hx - 7 + i * 2, by - 8 - (3 - i), 15 - i * 4, 1, i % 2 ? C.sky1 : C.sky2);
  rect(g, hx - 1, by - 4, 3, 4, C.ink);
  rect(g, hx, by - 5, 1, 1, C.ink);
}

function paintSignpost(g: G, f: Frame): void {
  const cx = place("camp").x;
  const by = f.by;
  rect(g, cx - 1, by - 40, 3, 40, C.bark1);
  rect(g, cx - 1, by - 40, 1, 40, C.bark3);
  rect(g, cx - 2, by - 41, 5, 2, C.bark0);
  // An arm pointing left, to the camp, with a tent on it.
  rect(g, cx - 22, by - 37, 28, 9, C.bark0);
  rect(g, cx - 21, by - 36, 26, 7, C.bark3);
  rect(g, cx - 21, by - 36, 26, 1, C.bark4);
  for (let i = 0; i < 5; i++) rect(g, cx - 23 - i, by - 37 + i, 1, 9 - i * 2, i === 4 ? C.bark0 : C.bark3);
  stamp(g, cx - 17, by - 35, ["..w..", ".www.", ".wkw.", "wwkww"]);
  rect(g, cx - 9, by - 33, 9, 1, C.gold3);
  rect(g, cx - 9, by - 31, 6, 1, C.gold2);
  // And one pointing right, down the street, with a lantern.
  rect(g, cx - 5, by - 25, 26, 8, C.bark0);
  rect(g, cx - 4, by - 24, 24, 6, C.bark2);
  rect(g, cx - 4, by - 24, 24, 1, C.bark3);
  for (let i = 0; i < 4; i++) rect(g, cx + 21 + i, by - 25 + i, 1, 8 - i * 2, i === 3 ? C.bark0 : C.bark2);
  stamp(g, cx + 13, by - 23, [".o.", "oyo", "oyo", ".o."]);
  rect(g, cx, by - 22, 9, 1, C.gold2);
  rect(g, cx, by - 20, 6, 1, C.gold0);
  // Stones at its foot.
  rect(g, cx - 4, by - 2, 4, 2, C.stone1);
  rect(g, cx + 2, by - 3, 5, 3, C.stone2);
  rect(g, cx + 2, by - 3, 5, 1, C.stone3);
}

function paintLamps(g: G, f: Frame, lit: Sprite): void {
  const by = f.by;
  for (const x of LAMPS) {
    rect(g, x, by - 32, 2, 32, C.bark0);
    rect(g, x, by - 32, 1, 32, C.bark2);
    rect(g, x - 1, by - 2, 4, 2, C.stone1);
    rect(g, x, by - 33, 8, 1, C.bark0);
    rect(g, x + 2, by - 32, 1, 1, C.bark0);
    hangLantern(g, x + 4, by - 30, lit);
  }
}

/** Paints every place onto the street, and returns the sprites of the parts that move. */
export function paintPlaces(g: G, f: Frame): Moving {
  const lanternLit = lantern({});
  const lanternDark = lantern({ y: C.sky2, w: C.sky3, d: C.bark1 });
  const lanternGold = lantern({ y: C.gold3, w: "#ffffff", d: C.gold1 });
  const crab: [Sprite, Sprite] = [
    stamped(["c.........c", "cc.k...k.cc", ".c.c...c.c.", "..ccccccc..", ".ccccccccc.", "..cmmmmmc..", ".c.c...c.c."]),
    stamped(["cc.......cc", "c..k...k..c", ".c.c...c.c.", "..ccccccc..", ".ccccccccc.", "..cmmmmmc..", "c..c...c..c"]),
  ];
  paintLamps(g, f, lanternLit);
  paintSignpost(g, f);
  paintBoard(g, f, lanternLit);
  const doorHalf = paintTreasury(g, f, lanternLit);
  STALLS.forEach((sx, i) => paintStall(g, f, sx, i ? C.sky4 : C.sky3, C.gold3, i, lanternLit));
  barrel(g, 762, f.by);
  rect(g, 774, f.by - 7, 8, 7, C.earth2);
  rect(g, 775, f.by - 9, 6, 2, C.earth2);
  rect(g, 777, f.by - 10, 2, 1, C.bark1);
  paintFire(g, f);
  paintWorks(g, f, lanternLit);
  paintPond(g, f, crab[0]);
  const hat = sprite(14, 7);
  rect(hat.g, 3, 1, 8, 5, C.gold0);
  rect(hat.g, 3, 1, 8, 1, C.gold1);
  rect(hat.g, 3, 4, 8, 1, C.sky3);
  rect(hat.g, 0, 6, 14, 1, C.gold1);
  rect(hat.g, 1, 5, 12, 1, C.gold0);
  rect(hat.g, 6, 2, 2, 2, C.gold3);
  const paper = sprite(3, 4);
  rect(paper.g, 0, 0, 3, 4, C.gold3);
  rect(paper.g, 0, 2, 2, 1, C.gold0);
  return {
    doorHalf,
    sunSign: paintSunSign(),
    gearBig: gear(13, 12),
    gearSmall: gear(7, 6),
    lanternLit,
    lanternDark,
    lanternGold,
    banners: [banner(C.sky1), banner("#8f2f66"), banner(C.green1), banner("#2f4a7a")],
    crab,
    cinfyHat: hat,
    paper,
  };
}
