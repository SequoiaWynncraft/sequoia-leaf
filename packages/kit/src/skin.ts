/**
 * Characters. A member's own 64x64 block-game skin sheet, or a made-up one, becomes a small figure
 * for a top-down town: the head is kept pixel for pixel (it is what people recognise), and the body
 * under it is drawn at half size, so the figure is two and a half heads tall.
 */

import { CREAM, INK, SKY } from "./palette.ts";
import { flipped, outlineInPlace, R, rgb } from "./pix.ts";
import { makeCanvas } from "./util.ts";

/** Facing: down (towards us), left, right, up (away). */
export type Dir = 0 | 1 | 2 | 3;
export const FRAME_W = 12;
export const FRAME_H = 24;
/** Where the feet stand inside a frame. */
export const FOOT_X = 6;
export const FOOT_Y = 22;
/** The order of poses in a walk. */
export const WALK = [0, 1, 0, 2] as const;
export const SIT = 3;

export interface Body {
  /** frames[dir][pose]: standing, two steps, sitting. */
  frames: HTMLCanvasElement[][];
  /** The face alone, 8x8, for cards and buttons. */
  face: HTMLCanvasElement;
  /** The pieces the frames are put together from, for whoever poses them another way. */
  parts: Parts;
}

type Sheet = HTMLImageElement | HTMLCanvasElement;

/** The sheet's lower layer with its hat and jacket layers laid over it, as one 64x32 picture. */
function flatten(sheet: Sheet): HTMLCanvasElement {
  const full = makeCanvas(64, 64);
  full.g.drawImage(sheet, 0, 0);
  const { c, g } = makeCanvas(64, 32);
  g.drawImage(full.c, 0, 0, 64, 32, 0, 0, 64, 32);
  // Old sheets fill the hat layer with a solid colour; a real hat layer has clear pixels in it.
  const hat = full.g.getImageData(32, 0, 32, 16).data;
  let clear = 0;
  for (let i = 3; i < hat.length; i += 4) if ((hat[i] ?? 0) < 255) clear++;
  if (clear > 0) g.drawImage(full.c, 32, 0, 32, 16, 0, 0, 32, 16);
  const tall = sheet instanceof HTMLImageElement ? sheet.naturalHeight : sheet.height;
  if (tall >= 64) g.drawImage(full.c, 0, 32, 56, 16, 0, 16, 56, 16);
  return c;
}

/** A piece of the sheet, shrunk to `dw` x `dh` by averaging what each new pixel covers. */
function take(
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): HTMLCanvasElement {
  const { c, g } = makeCanvas(dw, dh);
  const from = src.getContext("2d");
  if (!from) return c;
  const s = from.getImageData(sx, sy, sw, sh).data;
  const out = g.createImageData(dw, dh);
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const x0 = (dx * sw) / dw;
      const x1 = ((dx + 1) * sw) / dw;
      const y0 = (dy * sh) / dh;
      const y1 = ((dy + 1) * sh) / dh;
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 0;
      let all = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wgt = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy));
          const i = (yy * sw + xx) * 4;
          const al = ((s[i + 3] ?? 0) / 255) * wgt;
          r += (s[i] ?? 0) * al;
          gg += (s[i + 1] ?? 0) * al;
          b += (s[i + 2] ?? 0) * al;
          a += al;
          all += wgt;
        }
      }
      if (a / all < 0.5) continue;
      const o = (dy * dw + dx) * 4;
      out.data[o] = r / a;
      out.data[o + 1] = gg / a;
      out.data[o + 2] = b / a;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

/**
 * A skin's pieces at the figure's size: the head's four faces (8x8); the body from the front, the
 * back and each side (4x6); an arm from the front, the back and outside (2x6); a leg from the front
 * and the back (2x5) and from outside (4x5). The arm and leg are the right-hand ones.
 */
export interface Parts {
  headF: HTMLCanvasElement;
  headL: HTMLCanvasElement;
  headR: HTMLCanvasElement;
  headB: HTMLCanvasElement;
  bodyF: HTMLCanvasElement;
  bodyB: HTMLCanvasElement;
  bodyL: HTMLCanvasElement;
  bodyR: HTMLCanvasElement;
  armF: HTMLCanvasElement;
  armB: HTMLCanvasElement;
  armO: HTMLCanvasElement;
  legF: HTMLCanvasElement;
  legB: HTMLCanvasElement;
  legO: HTMLCanvasElement;
}

function parts(flat: HTMLCanvasElement): Parts {
  const t = (sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): HTMLCanvasElement =>
    take(flat, sx, sy, sw, sh, dw, dh);
  return {
    headF: t(8, 8, 8, 8, 8, 8),
    headL: t(16, 8, 8, 8, 8, 8),
    headR: t(0, 8, 8, 8, 8, 8),
    headB: t(24, 8, 8, 8, 8, 8),
    bodyF: t(20, 20, 8, 12, 4, 6),
    bodyB: t(32, 20, 8, 12, 4, 6),
    bodyL: t(28, 20, 4, 12, 4, 6),
    bodyR: t(16, 20, 4, 12, 4, 6),
    armF: t(44, 20, 4, 12, 2, 6),
    armB: t(52, 20, 4, 12, 2, 6),
    armO: t(40, 20, 4, 12, 2, 6),
    legF: t(4, 20, 4, 12, 2, 5),
    legB: t(12, 20, 4, 12, 2, 5),
    legO: t(0, 20, 4, 12, 4, 5),
  };
}

/** Facing us or facing away: the two views that show both arms. */
function poseFront(p: Parts, pose: number, back: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(FRAME_W, FRAME_H);
  const arm = back ? p.armB : p.armF;
  const leg = back ? p.legB : p.legF;
  // The sheet holds the right-hand limbs; seen from the front they are on our left.
  const [armL, armR] = back ? [flipped(arm), arm] : [arm, flipped(arm)];
  const [legL, legR] = back ? [flipped(leg), leg] : [leg, flipped(leg)];
  const ox = 2;
  const oy = 3 + (pose === SIT ? (back ? 5 : 2) : 0);
  if (pose === SIT) {
    if (!back) {
      g.drawImage(legL, 0, 2, 2, 3, ox + 2, oy + 14, 2, 3);
      g.drawImage(legR, 0, 2, 2, 3, ox + 4, oy + 14, 2, 3);
    }
  } else {
    g.drawImage(legL, ox + 2, oy + 14 - (pose === 1 ? 1 : 0));
    g.drawImage(legR, ox + 4, oy + 14 - (pose === 2 ? 1 : 0));
  }
  const swing = pose === 1 ? 1 : pose === 2 ? -1 : 0;
  g.drawImage(armL, ox, oy + 8 - swing);
  g.drawImage(armR, ox + 6, oy + 8 + swing);
  g.drawImage(back ? p.bodyB : p.bodyF, ox + 2, oy + 8);
  g.drawImage(back ? p.headB : p.headF, ox, oy);
  outlineInPlace(c, g, INK);
  return c;
}

function poseSide(p: Parts, pose: number, west: boolean): HTMLCanvasElement {
  const { c, g } = makeCanvas(FRAME_W, FRAME_H);
  const arm = west ? flipped(p.armO) : p.armO;
  const leg = west ? flipped(p.legO) : p.legO;
  const fwd = west ? -1 : 1;
  const ox = 2;
  const oy = 3 + (pose === SIT ? 5 : 0);
  if (pose === SIT) {
    g.drawImage(leg, 0, 3, 4, 2, ox + 2 + fwd * 3, oy + 12, 4, 2);
  } else if (pose === 0) {
    g.drawImage(leg, ox + 2, oy + 14);
  } else {
    // A leg is split into its front and back halves, which part like scissors.
    const frontSx = west ? 0 : 2;
    const frontDx = ox + 2 + (west ? -1 : 3);
    const backDx = ox + 2 + (west ? 3 : -1);
    g.drawImage(leg, frontSx, 0, 2, 5, frontDx, oy + 14 - (pose === 1 ? 1 : 0), 2, 5);
    g.drawImage(leg, 2 - frontSx, 0, 2, 5, backDx, oy + 14 - (pose === 2 ? 1 : 0), 2, 5);
  }
  g.drawImage(west ? p.bodyL : p.bodyR, ox + 2, oy + 8);
  const swing = pose === 1 ? -fwd : pose === 2 ? fwd : 0;
  g.drawImage(arm, ox + 3 + swing, oy + 8);
  g.drawImage(west ? p.headL : p.headR, ox, oy);
  outlineInPlace(c, g, INK);
  return c;
}

/** The walking figure for a skin sheet. Throws if the sheet cannot be read (a picture from elsewhere). */
export function bake(sheet: Sheet): Body {
  const p = parts(flatten(sheet));
  const poses = [0, 1, 2, 3];
  return {
    frames: [
      poses.map((n) => poseFront(p, n, false)),
      poses.map((n) => poseSide(p, n, true)),
      poses.map((n) => poseSide(p, n, false)),
      poses.map((n) => poseFront(p, n, true)),
    ],
    face: p.headF,
    parts: p,
  };
}

// ---------- made-up skins ----------

export interface Look {
  skin: string;
  hair: string;
  /** A lighter streak in the hair, or the inside of a cat hood's ears. */
  light: string;
  eye: string;
  top: string;
  legs: string;
  shoes: string;
  style: "short" | "long" | "hood" | "cap" | "ears";
  sleeves: "long" | "short";
  hands?: string;
  detail?: "belt" | "scarf" | "apron" | "buttons";
  trim?: string;
  glasses?: true;
}

function darker(hex: string, by = 0.28): string {
  const [r, g, b] = rgb(hex);
  const [ir, ig, ib] = rgb(INK);
  const m = (a: number, z: number): string =>
    Math.round(a + (z - a) * by)
      .toString(16)
      .padStart(2, "0");
  return `#${m(r, ir)}${m(g, ig)}${m(b, ib)}`;
}

/** A whole skin sheet for a made-up guild-mate, laid out like a real one. */
export function paintSkin(l: Look): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64);
  const covered = l.style === "hood" || l.style === "ears";
  const crown = l.style === "cap" ? (l.trim ?? l.hair) : l.hair;

  // Head: top, then front, the two sides and the back.
  R(g, 8, 0, 8, 8, crown);
  const f = 8;
  R(g, f, 8, 8, 8, l.skin);
  R(g, f, 8, 8, 2, crown);
  if (l.style === "short" || l.style === "long") R(g, f + 2, 9, 3, 1, l.light);
  if (l.style === "short") {
    R(g, f, 10, 3, 1, l.hair);
    R(g, f + 5, 10, 3, 1, l.hair);
    R(g, f, 11, 1, 1, l.hair);
    R(g, f + 7, 11, 1, 1, l.hair);
  } else if (l.style === "cap") {
    R(g, f, 10, 8, 1, darker(crown));
    R(g, f, 11, 1, 2, l.hair);
    R(g, f + 7, 11, 1, 2, l.hair);
  } else {
    R(g, f, 10, 8, 1, l.hair);
    R(g, f, 11, 1, 5, l.hair);
    R(g, f + 7, 11, 1, 5, l.hair);
    if (covered) R(g, f, 15, 8, 1, l.hair);
  }
  if (l.style === "ears") {
    R(g, f + 1, 8, 1, 1, l.light);
    R(g, f + 6, 8, 1, 1, l.light);
  }
  R(g, f + 1, 12, 1, 1, CREAM);
  R(g, f + 2, 12, 1, 1, l.eye);
  R(g, f + 5, 12, 1, 1, l.eye);
  R(g, f + 6, 12, 1, 1, CREAM);
  if (l.glasses) {
    R(g, f + 3, 12, 2, 1, INK);
    R(g, f, 12, 1, 1, INK);
    R(g, f + 7, 12, 1, 1, INK);
  }
  R(g, f + 3, 14, 2, 1, darker(l.skin, 0.35));

  // The sides: the face is towards the front face of the head on both.
  for (const [sx, front] of [
    [0, 1],
    [16, -1],
  ] as const) {
    const fx = (n: number): number => (front === 1 ? sx + n : sx + 7 - n);
    R(g, sx, 8, 8, 8, l.skin);
    R(g, sx, 8, 8, l.style === "cap" ? 2 : 3, crown);
    if (l.style === "cap") {
      for (let n = 4; n < 8; n++) R(g, fx(n), 10, 1, 1, darker(crown));
      for (let n = 0; n < 4; n++) R(g, fx(n), 10, 1, 3, l.hair);
    } else if (l.style === "short") {
      for (let n = 0; n < 3; n++) R(g, fx(n), 11, 1, 2, l.hair);
    } else if (l.style === "long") {
      for (let n = 0; n < 4; n++) R(g, fx(n), 11, 1, 5, l.hair);
    } else {
      for (let n = 0; n < 5; n++) R(g, fx(n), 11, 1, 5, l.hair);
      R(g, sx, 15, 8, 1, l.hair);
    }
    R(g, fx(6), 12, 1, 1, l.eye);
  }
  R(g, 24, 8, 8, 8, l.style === "short" || l.style === "cap" ? l.skin : l.hair);
  if (l.style === "short") R(g, 24, 8, 8, 6, l.hair);
  if (l.style === "cap") {
    R(g, 24, 8, 8, 2, crown);
    R(g, 24, 10, 8, 4, l.hair);
  }

  // Body: sides, front and back.
  const topDark = darker(l.top);
  R(g, 16, 20, 24, 12, l.top);
  R(g, 16, 20, 4, 12, topDark);
  R(g, 28, 20, 4, 12, topDark);
  R(g, 20, 30, 8, 2, topDark);
  R(g, 32, 30, 8, 2, topDark);
  const trim = l.trim ?? CREAM;
  if (l.detail === "belt") R(g, 16, 28, 24, 2, trim);
  if (l.detail === "scarf") {
    R(g, 16, 20, 24, 2, trim);
    R(g, 22, 22, 2, 4, trim);
  }
  if (l.detail === "apron") R(g, 22, 22, 4, 10, trim);
  if (l.detail === "buttons") {
    R(g, 23, 21, 2, 2, trim);
    R(g, 23, 25, 2, 2, trim);
  }

  // Arm and leg, four faces each in a row.
  R(g, 40, 20, 16, 12, l.sleeves === "long" ? l.top : l.skin);
  if (l.sleeves === "short") R(g, 40, 20, 16, 4, l.top);
  R(g, 40, 30, 16, 2, l.hands ?? l.skin);
  R(g, 0, 20, 16, 12, l.legs);
  R(g, 0, 29, 16, 3, l.shoes);
  return c;
}

/**
 * Nobody yet: a person all of one dusk colour, with the figure's own dark edge. For somebody who is
 * a member but not yet known which: any other face or clothes would be somebody else's.
 */
export const NOBODY: Look = {
  skin: SKY[2],
  hair: SKY[2],
  light: SKY[2],
  eye: SKY[2],
  top: SKY[2],
  legs: SKY[2],
  shoes: SKY[2],
  style: "short",
  sleeves: "long",
};

// ---------- how a member looks before their own skin arrives ----------

const SKINS = ["#f6dcc2", "#eec39a", "#d9a57c", "#a8714e", "#7a4a30", "#5a3420"] as const;
const HAIR = ["#2b2530", "#6f3826", "#c2382e", "#e0823a", "#f1e2a6", "#3f6fb0", "#4b8c4a", "#e8e4f0"] as const;
const TOPS = ["#b84d84", "#2f8a8a", "#5a296e", "#4b8c4a", "#6f3826", "#3a3340", "#efe2c0", "#243a66"] as const;
const LEGS = ["#3d2050", "#2f5c34", "#593d29", "#2e2e36", "#243a66"] as const;
const STYLES = ["short", "long", "hood", "cap"] as const;

const seedOf = (name: string): number => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};
const from = <T>(list: readonly T[], seed: number, shift: number, or: T): T =>
  list[(seed >>> shift) % list.length] ?? or;

/** A look of their own, always the same for the same name: what a member wears until their skin arrives. */
export function lookFor(name: string): Look {
  const s = seedOf(name);
  const hair = from(HAIR, s, 3, "#6f3826");
  return {
    skin: from(SKINS, s, 0, "#eec39a"),
    hair,
    light: hair,
    eye: "#3b1f19",
    top: from(TOPS, s, 7, "#b84d84"),
    legs: from(LEGS, s, 11, "#3d2050"),
    shoes: "#3b1f19",
    style: from(STYLES, s, 14, "short"),
    sleeves: (s >>> 17) % 2 ? "long" : "short",
    trim: "#f5b95e",
  };
}

// ---------- faces in a list ----------

/** Where a player's skin sheet is served. */
export const skinOf = (id: string): string => `/v1/game/skins/${encodeURIComponent(id)}`;

/** Somebody's own skin as their figure, once it has come; never, if it cannot be read: what stands for them stays. */
export function skinFigure(id: string, come: (body: Body) => void): void {
  const img = new Image();
  img.addEventListener("load", () => {
    try {
      come(bake(img));
    } catch {
      // A picture that cannot be read.
    }
  });
  img.src = skinOf(id);
}

/** Faces given by `faceFor`, by player. */
const faces = new Map<string, { face: HTMLCanvasElement }>();
let facesCome = 0;

/**
 * Somebody's face, for a list of people: a look of their own at once (`lookFor`), and if `fetch`,
 * their own skin once it has come, asked for once.
 */
export function faceFor(id: string, name: string, fetch: boolean): HTMLCanvasElement {
  const had = faces.get(id);
  if (had) return had.face;
  const got = { face: bake(paintSkin(lookFor(name))).face };
  faces.set(id, got);
  if (fetch)
    skinFigure(id, (body) => {
      got.face = body.face;
      facesCome++;
    });
  return got.face;
}

/** How many faces `faceFor` has had come so far: a list draws again when it goes up. */
export const facesCame = (): number => facesCome;
