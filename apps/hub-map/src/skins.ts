/**
 * Who people are, to look at. A member plays as their block-game skin: a 64x64 sheet with the head
 * front at (8,8), the body at (20,20), an arm at (44,20) and a leg at (4,20). From one sheet come the
 * face on their pin, a small walking figure for when the map is close, and a standing portrait.
 * Guild-mates get made-up sheets, drawn here from a number.
 */
import { P } from "./palette.ts";
import { type Ctx, makeCanvas } from "./pix.ts";
import { mulberry } from "./rand.ts";

export type Skin = {
  sheet: HTMLCanvasElement;
  /** The face, 8x8. */
  face: HTMLCanvasElement;
  /** Five small figures side by side, each `FW` by `FH`: standing, two steps, sitting, cheering. */
  frames: HTMLCanvasElement;
  /** The whole character from the front, 16x32. */
  doll: HTMLCanvasElement;
};
export const FW = 12;
export const FH = 18;
export const FRAME = { stand: 0, stepA: 1, stepB: 2, sit: 3, cheer: 4 } as const;

const SKIN_TONES = ["#f2c9a0", "#e0a877", "#c68a5a", "#9a6240", "#6f4428", "#f6d8bd", "#9cc487"];
const HAIR = [P.bark0, P.bark2, "#1f1626", P.gold1, P.cream, P.rose, P.teal, P.coral, P.plum3, "#8a8fa0", P.bark4];
const CLOTH = [P.plum3, P.rose, P.coral, P.gold0, P.g3, P.teal, P.w2, P.cream, P.s1, P.bark3, P.g1, P.plum1, P.w3];

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export type Look = { tone?: number; hair?: number; style?: number; cloth?: number; beard?: boolean; trim?: string };

/** A made-up skin sheet from a number: the same number always gives the same person. */
export function madeUp(seed: number, look: Look = {}): Skin {
  const rnd = mulberry(seed * 7919 + 13);
  const pick = <T>(list: readonly T[], forced?: number): T => {
    const roll = Math.floor(rnd() * list.length);
    return list[(forced ?? roll) % list.length] as T;
  };
  const tone = pick(SKIN_TONES, look.tone);
  const hair = pick(HAIR, look.hair);
  const cloth = pick(CLOTH, look.cloth);
  const trousers = pick([P.bark1, P.plum1, P.s0, P.g0, P.w0, P.bark2]);
  const styleRoll = Math.floor(rnd() * 6);
  const style = look.style ?? styleRoll;
  const beardRoll = rnd() < 0.25;
  const beard = look.beard ?? beardRoll;
  const eye = pick(["#2a1733", "#24482a", "#34407f", "#3b1f19"]);
  const hat = look.trim ?? pick([P.plum2, P.g1, P.coral, P.gold0, P.s0]);

  const [sheet, g] = makeCanvas(64, 64);
  const R = (x: number, y: number, w: number, h: number, c: string): void => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // Head.
  R(8, 8, 8, 8, tone);
  R(8, 15, 8, 1, shade(tone, 0.9));
  switch (style) {
    case 0:
      R(8, 8, 8, 2, hair);
      R(8, 10, 1, 1, hair);
      R(15, 10, 1, 1, hair);
      break;
    case 1:
      R(8, 8, 8, 2, hair);
      R(8, 10, 1, 6, hair);
      R(15, 10, 1, 6, hair);
      break;
    case 2:
      R(8, 8, 8, 3, hair);
      R(8, 11, 2, 1, hair);
      R(14, 11, 2, 1, hair);
      break;
    case 3:
      R(8, 8, 8, 2, cloth);
      R(8, 10, 1, 6, cloth);
      R(15, 10, 1, 6, cloth);
      R(9, 10, 6, 1, shade(tone, 0.8));
      break;
    case 4:
      R(8, 8, 8, 2, hat);
      R(8, 10, 8, 1, shade(hat, 0.7));
      R(8, 11, 1, 2, hair);
      R(15, 11, 1, 2, hair);
      break;
    default:
      R(8, 8, 8, 1, hair);
      R(8, 9, 8, 1, hat);
  }
  R(9, 12, 1, 1, "#ffffff");
  R(10, 12, 1, 1, eye);
  R(13, 12, 1, 1, eye);
  R(14, 12, 1, 1, "#ffffff");
  R(9, 13, 1, 1, shade(tone, 0.92));
  R(14, 13, 1, 1, shade(tone, 0.92));
  if (beard) {
    R(9, 14, 6, 2, hair);
    R(8, 13, 1, 3, hair);
    R(15, 13, 1, 3, hair);
  }
  R(11, 14, 2, 1, beard ? shade(tone, 0.75) : shade(tone, 0.7));
  // Body.
  R(20, 20, 8, 12, cloth);
  R(20, 20, 8, 1, shade(cloth, 1.2));
  R(23, 21, 2, 6, shade(cloth, 0.8));
  R(20, 28, 8, 1, P.bark1);
  R(23, 28, 2, 1, P.gold1);
  R(20, 29, 8, 3, trousers);
  // Arm.
  R(44, 20, 4, 8, shade(cloth, 0.86));
  R(44, 28, 4, 4, tone);
  // Leg.
  R(4, 20, 4, 9, trousers);
  R(4, 29, 4, 3, P.bark0);
  return fromSheet(sheet);
}

/** A skin from a loaded skin image. */
export function fromImage(img: HTMLImageElement): Skin {
  const [sheet, g] = makeCanvas(64, 64);
  g.drawImage(img, 0, 0);
  return fromSheet(sheet);
}

function fromSheet(sheet: HTMLCanvasElement): Skin {
  const src = (sheet.getContext("2d") as Ctx).getImageData(0, 0, 64, 64).data;
  /** A pixel of the sheet, with the overlay layer (hat, jacket) laid over it when it has one. */
  const at = (x: number, y: number, ox = -1, oy = -1): string | null => {
    if (ox >= 0) {
      const o = (oy * 64 + ox) * 4;
      if ((src[o + 3] as number) > 128) return `rgb(${src[o]},${src[o + 1]},${src[o + 2]})`;
    }
    const i = (y * 64 + x) * 4;
    return (src[i + 3] as number) > 128 ? `rgb(${src[i]},${src[i + 1]},${src[i + 2]})` : null;
  };

  const [face, fg] = makeCanvas(8, 8);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const c = at(8 + x, 8 + y, 40 + x, 8 + y);
      if (c) {
        fg.fillStyle = c;
        fg.fillRect(x, y, 1, 1);
      }
    }

  const [doll, dg] = makeCanvas(16, 32);
  const part = (
    sx: number,
    sy: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
    ox: number,
    oy: number,
    flip = false,
  ): void => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = at(sx + x, sy + y, ox + x, oy + y);
        if (!c) continue;
        dg.fillStyle = c;
        dg.fillRect(dx + (flip ? w - 1 - x : x), dy + y, 1, 1);
      }
  };
  part(8, 8, 8, 8, 4, 0, 40, 8);
  part(20, 20, 8, 12, 4, 8, 20, 36);
  part(44, 20, 4, 12, 0, 8, 44, 36);
  part(44, 20, 4, 12, 12, 8, 44, 36, true);
  part(4, 20, 4, 12, 4, 20, 4, 36);
  part(4, 20, 4, 12, 8, 20, 4, 36, true);

  // The small figure: the whole face for a head, and the rest sampled down to a few pixels.
  const bodyCols = [0, 1, 3, 4, 6, 7];
  const bodyRows = [0, 3, 6, 9, 11];
  const armRows = [1, 4, 7, 9, 11];
  const legRows = [2, 7, 11];
  const body = (c: number, r: number): string =>
    at(
      20 + (bodyCols[c] as number),
      20 + (bodyRows[r] as number),
      20 + (bodyCols[c] as number),
      36 + (bodyRows[r] as number),
    ) ?? P.plum2;
  const arm = (r: number): string => at(45, 20 + (armRows[r] as number), 45, 36 + (armRows[r] as number)) ?? P.plum1;
  const leg = (c: number, r: number): string => at(5 + c, 20 + (legRows[r] as number)) ?? P.bark1;

  const [frames, g] = makeCanvas(FW * 5, FH);
  for (let f = 0; f < 5; f++) {
    const [cell, cg] = makeCanvas(FW, FH);
    const dot = (x: number, y: number, c: string): void => {
      cg.fillStyle = c;
      cg.fillRect(x, y, 1, 1);
    };
    const sit = f === FRAME.sit;
    const drop = sit ? 2 : 0;
    cg.drawImage(face, 2, 1 + drop);
    for (let r = 0; r < 5; r++) for (let col = 0; col < 6; col++) dot(3 + col, 9 + drop + r, body(col, r));
    if (f === FRAME.cheer) {
      for (let r = 0; r < 5; r++) {
        dot(1, 9 - r, arm(r));
        dot(10, 9 - r, arm(r));
      }
    } else {
      const swing = f === FRAME.stepA ? 1 : f === FRAME.stepB ? -1 : 0;
      for (let r = 0; r < 5; r++) {
        dot(2, 9 + drop + r, arm(r));
        dot(9, 9 + drop + r, arm(r));
      }
      if (swing !== 0) {
        // A swinging arm: the hand reaches forward on one side.
        dot(swing > 0 ? 1 : 10, 12, arm(4));
      }
    }
    if (sit) {
      for (let col = 0; col < 6; col++) dot(3 + col, 16, leg(col % 2, 1));
      dot(2, 16, leg(0, 2));
      dot(9, 16, leg(1, 2));
    } else {
      const liftL = f === FRAME.stepA ? 1 : 0;
      const liftR = f === FRAME.stepB ? 1 : 0;
      for (let r = 0; r < 3 - liftL; r++)
        for (let col = 0; col < 2; col++) dot(4 + col, 14 + r, leg(col, r === 2 - liftL ? 2 : r));
      for (let r = 0; r < 3 - liftR; r++)
        for (let col = 0; col < 2; col++) dot(6 + col, 14 + r, leg(1 - col, r === 2 - liftR ? 2 : r));
    }
    // A dark edge all round, so a figure reads against grass, road or roof.
    const px = cg.getImageData(0, 0, FW, FH).data;
    const solid = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < FW && y < FH && (px[(y * FW + x) * 4 + 3] as number) > 0;
    cg.fillStyle = P.ink;
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++)
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)))
          cg.fillRect(x, y, 1, 1);
    g.drawImage(cell, f * FW, 0);
  }
  return { sheet, face, frames, doll };
}

/** A copy of a skin's face or portrait for the page, drawn `scale` times its size. */
export function skinEl(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  c.className = "px";
  return c;
}
