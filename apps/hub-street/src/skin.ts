/**
 * People. A member is drawn from a block-game skin sheet (64 by 64): the body in profile, so a walk
 * reads as a walk, and the head turned a little toward us, so the face that makes them who they are
 * can be seen. Guild-mates get made-up sheets painted here in the same layout.
 */
import { C, dice, type G, mix, pick, rect, type Sprite, sprite, washed } from "./art.ts";

export type Hat = "none" | "wizard" | "hood" | "flowers" | "beanie" | "goggles" | "feather" | "sprout" | "acorn";

export interface Look {
  readonly skin: string;
  readonly hair: string;
  readonly long: boolean;
  readonly shirt: string;
  readonly trim: string;
  readonly pants: string;
  readonly boots: string;
  readonly hat: Hat;
  readonly hatColour: string;
  readonly beard: boolean;
  readonly sleeves: boolean;
}

export interface Body {
  /** Fifteen by sixteen, facing right; the head itself sits at 2,8 and is eleven wide, eight tall. */
  readonly head: Sprite;
  readonly torso: Sprite;
  readonly arm: Sprite;
  readonly armFar: Sprite;
  readonly leg: Sprite;
  readonly legFar: Sprite;
  /** Head, body and one arm seen from the front, for someone leaning out of a door. */
  readonly front: { readonly head: Sprite; readonly torso: Sprite; readonly arm: Sprite };
  /** Where the eyes are in `head`, when we painted them ourselves and so know. */
  readonly eyes: readonly (readonly [number, number])[];
  readonly lid: string;
}

const SKINS = ["#f1c9a0", "#e0a878", "#c68a5c", "#9c6a44", "#7a4f33", "#f6d8bd"];
const HAIRS = ["#3b1f19", "#6f3826", "#d49045", "#fff3cf", "#2a1733", "#b84d84", "#a6a6a6", "#8a4a30"];
const CLOTHS = ["#7a348a", "#b84d84", "#3b7340", "#2f5c34", "#d49045", "#5b8fc4", "#e67967", "#6e6d6d", "#fff3cf"];
const PANTS = ["#3d2050", "#542a1f", "#24482a", "#525252", "#593d29", "#35507a"];
const HATS: readonly Hat[] = ["wizard", "hood", "flowers", "beanie", "goggles", "feather", "sprout", "none", "none"];

/** A made-up member, the same one every time for the same number. */
export function lookFor(seed: number): Look {
  const r = dice(seed * 7919 + 13);
  const shirt = pick(CLOTHS, r());
  const hat = pick(HATS, r());
  return {
    skin: pick(SKINS, r()),
    hair: pick(HAIRS, r()),
    long: r() < 0.5,
    shirt,
    trim: pick(
      CLOTHS.filter((c) => c !== shirt),
      r(),
    ),
    pants: pick(PANTS, r()),
    boots: pick([C.bark0, C.bark1, C.sky0, C.stone0], r()),
    hat,
    hatColour: hat === "hood" ? shirt : pick(["#5a296e", "#b84d84", "#3b7340", "#d49045", "#35507a"], r()),
    beard: r() < 0.2,
    sleeves: r() < 0.7,
  };
}

/** Paints a skin sheet for a look, in the layout every block-game skin uses. */
export function paintSheet(look: Look): Sprite {
  const s = sprite(64, 64);
  const g = s.g;
  const shadeSkin = mix(look.skin, C.bark1, 0.28);
  const darkHair = mix(look.hair, C.ink, 0.3);
  const hood = look.hat === "hood";
  const top = hood ? look.hatColour : look.hair;
  const topDark = hood ? mix(look.hatColour, C.ink, 0.3) : darkHair;

  // Head: right side, front, left side, back, and the top above the front.
  rect(g, 0, 8, 32, 8, look.skin);
  rect(g, 8, 0, 8, 8, top);
  rect(g, 24, 8, 8, 8, top);
  rect(g, 0, 8, 32, 2, top);
  // Hair down the back half of each side: on the right side the back is at the left edge.
  const down = look.long || hood ? 8 : 4;
  rect(g, 0, 8, 4, down, top);
  rect(g, 20, 8, 4, down, top);
  rect(g, 0, 8, 1, down, topDark);
  rect(g, 23, 8, 1, down, topDark);
  rect(g, 4, 10, 1, 2, top);
  rect(g, 19, 10, 1, 2, top);
  // A fringe, and the face.
  rect(g, 8, 10, 1, look.long || hood ? 4 : 1, top);
  rect(g, 15, 10, 1, look.long || hood ? 4 : 1, top);
  if (!hood) rect(g, 10, 10, 2, 1, top);
  rect(g, 9, 12, 1, 1, C.gold3);
  rect(g, 10, 12, 1, 1, C.ink);
  rect(g, 13, 12, 1, 1, C.ink);
  rect(g, 14, 12, 1, 1, C.gold3);
  rect(g, 11, 13, 2, 1, shadeSkin);
  if (look.beard) {
    rect(g, 9, 14, 6, 2, look.hair);
    rect(g, 8, 13, 1, 3, look.hair);
    rect(g, 15, 13, 1, 3, look.hair);
    rect(g, 5, 13, 3, 3, look.hair);
    rect(g, 16, 13, 3, 3, look.hair);
  } else {
    rect(g, 11, 14, 2, 1, mix(look.skin, C.bark1, 0.45));
  }
  rect(g, 6, 12, 1, 2, shadeSkin);
  rect(g, 17, 12, 1, 2, shadeSkin);

  // Body: right side at 16, front at 20, back at 32.
  const shirtDark = mix(look.shirt, C.ink, 0.25);
  rect(g, 16, 20, 24, 12, look.shirt);
  rect(g, 16, 20, 4, 12, shirtDark);
  rect(g, 23, 20, 2, 1, look.skin);
  rect(g, 23, 21, 2, 1, look.trim);
  rect(g, 20, 21, 1, 8, mix(look.shirt, C.gold3, 0.12));
  rect(g, 16, 29, 24, 1, look.trim);
  rect(g, 23, 29, 2, 1, C.gold1);
  rect(g, 16, 30, 24, 2, look.pants);

  // Right arm: outer side at 40, front at 44.
  rect(g, 40, 20, 8, 12, look.skin);
  rect(g, 40, 20, 8, look.sleeves ? 9 : 4, look.shirt);
  rect(g, 40, look.sleeves ? 28 : 23, 8, 1, look.trim);
  rect(g, 40, 20, 1, 12, mix(look.shirt, C.ink, 0.2));
  rect(g, 40, 31, 8, 1, shadeSkin);

  // Right leg: outer side at 0, front at 4.
  rect(g, 0, 20, 8, 12, look.pants);
  rect(g, 0, 20, 1, 9, mix(look.pants, C.ink, 0.25));
  rect(g, 0, 29, 8, 3, look.boots);
  rect(g, 0, 29, 8, 1, mix(look.boots, C.gold3, 0.18));
  return s;
}

const WIZARD = [
  "....HH.........",
  ".....HH........",
  ".....HHH.......",
  "....HHHHH......",
  "....HHHHHH.....",
  "...HHHHHHHH....",
  "...TTTTTTTTT...",
  "HHHHHHHHHHHHHHH",
];
const BEANIE = [
  "...............",
  "...............",
  "...............",
  ".......ww......",
  "......www......",
  "...HHHHHHHHH...",
  "..HHHHHHHHHHH..",
  "..TTTTTTTTTTT..",
  "..HTHTHTHTHTH..",
];
const ACORN = [
  "...............",
  "...............",
  "...............",
  ".......b.......",
  "......bb.......",
  "....nnnnnnn....",
  "..nnnunnnunnn..",
  ".nnunnnunnnunn.",
  ".bbbbbbbbbbbbb.",
];
const FLOWERS = [
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "....m...y...w..",
  "..gmwmgywygwmw.",
  "..ggmgggygggwg.",
];
const SPROUT = [
  "...............",
  "...............",
  "...............",
  "....GG...GG....",
  "...GGGG.GGGG...",
  "....GGg.gGG....",
  "......g.g......",
  ".......g.......",
];
const FEATHER = [
  "...............",
  "...............",
  ".H.............",
  ".HH............",
  ".HHw...........",
  "..HH...........",
  "..HH...........",
  "...H...........",
  "..TTTTTTTTTTT..",
];
const GOGGLES = [
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  "...............",
  ".....dddddddd..",
  "..bbbdllddlld..",
  ".....dddddddd..",
];

function stampHat(g: G, rows: readonly string[], main: string, trim: string): void {
  const KEYS: Record<string, string> = {
    H: main,
    T: trim,
    w: C.gold3,
    y: C.gold2,
    m: C.sky4,
    g: C.green2,
    G: C.green4,
    b: C.bark1,
    n: C.bark3,
    u: C.earth2,
    d: C.gold0,
    l: "#9fd0e8",
  };
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const colour = KEYS[row.charAt(i)];
      if (colour) rect(g, i, j, 1, 1, colour);
    }
  });
}

type Sheet = CanvasImageSource;

/** One face of a part, with the outer layer (hats, jackets) laid over it when the sheet has one. */
function face(
  sheet: Sheet,
  tall: boolean,
  sx: number,
  sy: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
): Sprite {
  const s = sprite(w, h);
  s.g.drawImage(sheet, sx, sy, w, h, 0, 0, w, h);
  if (tall || oy < 32) s.g.drawImage(sheet, ox, oy, w, h, 0, 0, w, h);
  return s;
}

/** Cuts the parts a walking figure needs out of a skin sheet. */
export function bodyFrom(sheet: Sheet, sheetHeight: number, hat: Hat = "none", look: Look | null = null): Body {
  const tall = sheetHeight >= 64;
  const side = face(sheet, tall, 0, 8, 8, 8, 32, 8);
  const front = face(sheet, tall, 8, 8, 8, 8, 40, 8);
  const head = sprite(15, 16);
  // The side of the head is squeezed to three pixels and shaded, as a face turned part-way is.
  const squeezed = sprite(3, 8);
  squeezed.g.drawImage(side.c, 0, 0, 8, 8, 0, 0, 3, 8);
  head.g.drawImage(washed(squeezed, C.ink, 0.22).c, 2, 8);
  head.g.drawImage(front.c, 5, 8);
  const main = look?.hatColour ?? C.sky2;
  const trim = look?.trim ?? C.gold1;
  if (hat === "wizard") stampHat(head.g, WIZARD, main, trim);
  else if (hat === "beanie") stampHat(head.g, BEANIE, main, trim);
  else if (hat === "acorn") stampHat(head.g, ACORN, main, trim);
  else if (hat === "flowers") stampHat(head.g, FLOWERS, main, trim);
  else if (hat === "sprout") stampHat(head.g, SPROUT, main, trim);
  else if (hat === "feather") stampHat(head.g, FEATHER, main, trim);
  else if (hat === "goggles") stampHat(head.g, GOGGLES, main, trim);
  else if (hat === "hood") {
    rect(head.g, 1, 9, 1, 4, main);
    rect(head.g, 2, 7, 10, 1, mix(main, C.gold3, 0.15));
  }

  // The body in profile, with a sliver of the chest showing at its leading edge.
  const flank = face(sheet, tall, 16, 20, 4, 12, 16, 36);
  const chest = face(sheet, tall, 20, 20, 2, 12, 20, 36);
  const torso = sprite(6, 12);
  torso.g.drawImage(washed(flank, C.ink, 0.14).c, 0, 0);
  torso.g.drawImage(chest.c, 4, 0);
  const arm = face(sheet, tall, 40, 20, 4, 12, 40, 36);
  const leg = face(sheet, tall, 0, 20, 4, 12, 0, 36);
  return {
    head,
    torso,
    arm,
    armFar: washed(arm, C.ink, 0.38),
    leg,
    legFar: washed(leg, C.ink, 0.38),
    front: {
      head: front,
      torso: face(sheet, tall, 20, 20, 8, 12, 20, 36),
      arm: face(sheet, tall, 44, 20, 4, 12, 44, 36),
    },
    eyes: look
      ? [
          [6, 12],
          [7, 12],
          [10, 12],
          [11, 12],
        ]
      : [],
    lid: look ? mix(look.skin, C.bark1, 0.2) : C.ink,
  };
}

export function bodyForLook(look: Look): Body {
  return bodyFrom(paintSheet(look).c, 64, look.hat, look);
}

/** Loads the member's own skin from beside the page; null when there is none to be had. */
export function loadSkin(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img.naturalWidth === 64 && img.naturalHeight >= 32 ? img : null));
    img.addEventListener("error", () => resolve(null));
    img.src = url;
  });
}

export interface Pose {
  x: number;
  y: number;
  face: 1 | -1;
  /** Where in the stride, in radians, and how wide the stride is, 0 to 1. */
  walk: number;
  stride: number;
  /** 0 standing, 1 sitting. */
  sit: number;
  /** 0 to 1: both arms up. */
  cheer: number;
  /** 0 to 1: the near arm raised and waving. */
  wave: number;
  /** Lifted off the ground by this much. */
  hop: number;
  /** Seconds, for the small movements. */
  t: number;
  blink: boolean;
  /** Squash and stretch: 1 is at rest. */
  squash: number;
  /** The near arm held out forward, as when holding a stick over a fire. */
  reach: number;
}

export function restPose(x: number, y: number): Pose {
  return {
    x,
    y,
    face: 1,
    walk: 0,
    stride: 0,
    sit: 0,
    cheer: 0,
    wave: 0,
    hop: 0,
    t: 0,
    blink: false,
    squash: 1,
    reach: 0,
  };
}

function limb(g: G, part: Sprite, px: number, py: number, angle: number, above: number): void {
  g.save();
  g.translate(px, py);
  g.rotate(angle);
  g.drawImage(part.c, -2, -above);
  g.restore();
}

/** Draws a figure with its feet at the pose's x,y. The canvas is assumed to be in art pixels. */
export function drawBody(g: G, b: Body, p: Pose): void {
  g.save();
  g.translate(p.x, p.y - p.hop);
  g.scale(p.face * (2 - p.squash), p.squash);
  const stand = 1 - p.sit;
  const swing = Math.sin(p.walk) * 0.72 * p.stride * stand;
  const lift = Math.abs(Math.sin(p.walk)) * p.stride * stand * 1.1;
  const breathe = p.stride < 0.1 ? Math.sin(p.t * 1.7) * 0.35 : 0;
  const hip = -12 + p.sit * 5 - lift;
  const shoulder = hip - 10 + breathe * 0.4;
  const forward = (-Math.PI / 2) * p.sit;
  const up = Math.PI * p.cheer;
  const shake = Math.sin(p.t * 16) * 0.22 * p.cheer;
  const waving = (-2.55 + Math.sin(p.t * 13) * 0.38) * p.wave;
  const rest = -0.55 * p.sit * (1 - p.cheer);
  const reach = -1.25 * p.reach;

  // At rest the feet are a little apart and the arms hang a little off the body, so a figure
  // standing still is a figure and not a post.
  const ease = (1 - Math.min(1, p.stride * 3)) * stand * (1 - p.cheer);
  // Running, the whole figure tips forward a little.
  g.rotate(Math.max(0, p.stride - 1) * 0.5);
  limb(g, b.armFar, 0, shoulder, swing * 0.85 * (1 - p.cheer) + up - shake + rest * 0.8 - ease * 0.16, 2);
  limb(g, b.legFar, 1, hip, -swing + forward * 0.94 - ease * 0.13, 0);
  g.drawImage(b.torso.c, -3, hip - 12 + breathe * 0.4);
  limb(g, b.leg, 0, hip, swing + forward + ease * 0.1, 0);
  g.drawImage(b.head.c, -7, hip - 28 + breathe);
  if (p.blink) {
    g.fillStyle = b.lid;
    for (const [ex, ey] of b.eyes) g.fillRect(-7 + ex, hip - 28 + breathe + ey, 1, 1);
  }
  const near =
    p.wave > 0 ? waving : p.reach > 0 ? reach : -swing * 0.85 * (1 - p.cheer) + up + shake + rest + ease * 0.1;
  limb(g, b.arm, -1, shoulder, near, 2);
  g.restore();
}

/** A standing figure on its own small canvas, for cards. */
export function portrait(b: Body): Sprite {
  const s = sprite(17, 41);
  drawBody(s.g, b, restPose(8, 40));
  return s;
}

/** Cinfy keeps the Treasury: a made-up look that is theirs alone. */
export const CINFY: Look = {
  skin: "#f1c9a0",
  hair: "#fff3cf",
  long: true,
  shirt: "#d49045",
  trim: "#7a348a",
  pants: "#3d2050",
  boots: C.bark0,
  hat: "none",
  hatColour: "#f5b95e",
  beard: false,
  sleeves: true,
};
