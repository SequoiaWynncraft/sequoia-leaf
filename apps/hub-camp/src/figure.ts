/**
 * People. Everyone stands on the block-game skin: a 64x64 sheet cut into a head, a body, two arms
 * and two legs, and drawn small, one skin pixel to one scene pixel. The member's own sheet is used
 * if it loads; guild-mates wear sheets made up here.
 */
import { canvas, type Cv, type G2, INK, mix, R, sprite, type Spr } from "./gfx.ts";

export type Face = "down" | "up" | "left" | "right";
export type Pose = "stand" | "walk" | "cheer" | "wave";

interface Parts {
  head: Cv;
  body: Cv;
  armR: Cv;
  armL: Cv;
  legR: Cv;
  legL: Cv;
}
export interface Figure {
  /** Arm width: 3 on the slim model, 4 otherwise. */
  aw: number;
  front: Parts;
  back: Parts;
  side: { head: Cv; body: Cv; arm: Cv; leg: Cv };
  hat: Spr | null;
  /** The face alone, for cards. */
  portrait: Cv;
}

// ---------- cutting a sheet into parts ----------

function cut(sheet: Cv, x: number, y: number, w: number, h: number, over?: [number, number]): Cv {
  const [c, g] = canvas(w, h);
  g.drawImage(sheet, x, y, w, h, 0, 0, w, h);
  if (over && over[1] + h <= sheet.height) g.drawImage(sheet, over[0], over[1], w, h, 0, 0, w, h);
  return c;
}
function mirrored(src: Cv): Cv {
  const [c, g] = canvas(src.width, src.height);
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}
function hasInk(sheet: Cv, x: number, y: number, w: number, h: number): boolean {
  if (y + h > sheet.height) return false;
  const d = sheet.getContext("2d")!.getImageData(x, y, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return true;
  return false;
}

export function figureFrom(sheet: Cv, hat: Spr | null = null): Figure {
  // The slim model leaves the last two columns of the arm block empty.
  const slim = !hasInk(sheet, 54, 20, 2, 12);
  const aw = slim ? 3 : 4;
  const newLeft = hasInk(sheet, 36, 52, aw, 12);
  const newLeg = hasInk(sheet, 20, 52, 4, 12);
  const armR = cut(sheet, 44, 20, aw, 12, [44, 36]);
  const legR = cut(sheet, 4, 20, 4, 12, [4, 36]);
  const armRb = cut(sheet, slim ? 51 : 52, 20, aw, 12, [slim ? 51 : 52, 36]);
  const legRb = cut(sheet, 12, 20, 4, 12, [12, 36]);
  const head = cut(sheet, 8, 8, 8, 8, [40, 8]);
  const front: Parts = {
    head,
    body: cut(sheet, 20, 20, 8, 12, [20, 36]),
    armR,
    armL: newLeft ? cut(sheet, 36, 52, aw, 12, [52, 52]) : mirrored(armR),
    legR,
    legL: newLeg ? cut(sheet, 20, 52, 4, 12, [4, 52]) : mirrored(legR),
  };
  const back: Parts = {
    head: cut(sheet, 24, 8, 8, 8, [56, 8]),
    body: cut(sheet, 32, 20, 8, 12, [32, 36]),
    armR: armRb,
    armL: newLeft ? cut(sheet, slim ? 43 : 44, 52, aw, 12, [slim ? 59 : 60, 52]) : mirrored(armRb),
    legR: legRb,
    legL: newLeg ? cut(sheet, 28, 52, 4, 12, [12, 52]) : mirrored(legRb),
  };
  const side = {
    head: cut(sheet, 0, 8, 8, 8, [32, 8]),
    body: cut(sheet, 16, 20, 4, 12, [16, 36]),
    arm: cut(sheet, 40, 20, 4, 12, [40, 36]),
    leg: cut(sheet, 0, 20, 4, 12, [0, 36]),
  };
  const [portrait, pg] = canvas(10, hat ? 8 + hat.h - 1 : 8);
  if (hat) {
    pg.drawImage(head, 1, hat.h - 1);
    pg.drawImage(hat.c, 5 - hat.ax, 0);
  } else pg.drawImage(head, 1, 0);
  return { aw, front, back, side, hat, portrait };
}

// ---------- drawing one ----------

const SW = 30;
const SH = 48;
const [scratch, sg] = canvas(SW, SH);
const [shade, hg] = canvas(SW, SH);
const CX = 15;
const FOOT = 44;

function sheared(g: G2, src: Cv, x: number, y: number, lean: number, flipY = false): void {
  const h = src.height;
  for (let i = 0; i < h; i++) {
    const dx = Math.round((lean * i) / (h - 1));
    if (flipY) g.drawImage(src, 0, h - 1 - i, src.width, 1, x + dx, y - i, src.width, 1);
    else g.drawImage(src, 0, i, src.width, 1, x + dx, y + i, src.width, 1);
  }
}

/**
 * Draws a person with their feet at (x, y). `step` is how far through a stride they are (it only
 * matters when walking), `t` is the clock, for breathing and waving.
 */
export function drawFigure(
  g: G2,
  f: Figure,
  x: number,
  y: number,
  face: Face,
  pose: Pose,
  step: number,
  t: number,
  sit = false,
): void {
  sg.clearRect(0, 0, SW, SH);
  const aw = f.aw;
  const swing = pose === "walk" ? Math.sin(step) : 0;
  const bob = pose === "walk" ? (Math.abs(swing) > 0.55 ? 1 : 0) : 0;
  const drop = sit ? 6 : 0;
  const top = FOOT - 32 + drop - bob;
  if (face === "left" || face === "right") {
    const s = f.side;
    if (sit) {
      // thighs out toward the fire, shins down
      sg.save();
      sg.translate(CX, FOOT - 10);
      sg.rotate(-Math.PI / 2);
      sg.drawImage(s.leg, 0, 0, 4, 6, -4, 0, 4, 6);
      sg.restore();
      sg.drawImage(s.leg, 0, 6, 4, 6, CX + 4, FOOT - 7, 4, 6);
    } else {
      sheared(sg, s.leg, CX - 2, FOOT - 12, Math.round(-swing * 4));
      sg.fillStyle = "rgba(26,15,30,0.3)";
      for (let i = 0; i < 12; i++) sg.fillRect(CX - 2 + Math.round((-swing * 4 * i) / 11), FOOT - 12 + i, 4, 1);
      sheared(sg, s.leg, CX - 2, FOOT - 12, Math.round(swing * 4));
    }
    sg.drawImage(s.body, CX - 2, top + 8);
    sg.drawImage(s.head, CX - 4, top);
    if (pose === "cheer" || pose === "wave") sheared(sg, s.arm, CX - 2, top + 9, pose === "wave" ? Math.round(2 + Math.sin(t * 14)) : 2, true);
    else if (sit) sheared(sg, s.arm, CX - 2, top + 8, 3);
    else sheared(sg, s.arm, CX - 2, top + 8, Math.round(-swing * 3));
    if (f.hat) sg.drawImage(f.hat.c, CX - f.hat.ax, top - f.hat.h + 1);
  } else {
    const p = face === "down" ? f.front : f.back;
    // In the front view the person's right is on our left; from behind it is on our right.
    const lArm = face === "down" ? p.armR : p.armL;
    const rArm = face === "down" ? p.armL : p.armR;
    const lLeg = face === "down" ? p.legR : p.legL;
    const rLeg = face === "down" ? p.legL : p.legR;
    if (sit) {
      if (face === "down") {
        sg.drawImage(lLeg, 0, 0, 4, 12, CX - 4, FOOT - 6, 4, 6);
        sg.drawImage(rLeg, 0, 0, 4, 12, CX, FOOT - 6, 4, 6);
      }
    } else {
      const liftL = pose === "walk" ? Math.max(0, Math.round(swing * 2)) : 0;
      const liftR = pose === "walk" ? Math.max(0, Math.round(-swing * 2)) : 0;
      sg.drawImage(lLeg, 0, 0, 4, 12 - liftL, CX - 4, FOOT - 12, 4, 12 - liftL);
      sg.drawImage(rLeg, 0, 0, 4, 12 - liftR, CX, FOOT - 12, 4, 12 - liftR);
    }
    sg.drawImage(p.body, CX - 4, top + 8);
    const armY = top + 8;
    if (pose === "cheer") {
      sheared(sg, lArm, CX - 4 - aw, armY + 1, -1, true);
      sheared(sg, rArm, CX + 4, armY + 1, 1, true);
    } else if (pose === "wave") {
      sg.drawImage(lArm, CX - 4 - aw, armY);
      sheared(sg, rArm, CX + 4, armY + 1, Math.round(1 + Math.sin(t * 14) * 2), true);
    } else {
      const sway = pose === "walk" ? Math.round(swing) : 0;
      sg.drawImage(lArm, CX - 4 - aw, armY + sway);
      sg.drawImage(rArm, CX + 4, armY - sway);
    }
    sg.drawImage(p.head, CX - 4, top);
    if (f.hat) sg.drawImage(f.hat.c, CX - f.hat.ax, top - f.hat.h + 1);
  }
  // a dark line round the whole of them
  hg.globalCompositeOperation = "copy";
  hg.drawImage(scratch, 0, 0);
  hg.globalCompositeOperation = "source-in";
  hg.fillStyle = "#2a1733";
  hg.fillRect(0, 0, SW, SH);
  const dx = Math.round(x) - CX;
  const dy = Math.round(y) - FOOT;
  const flipX = face === "left";
  if (flipX) {
    g.save();
    g.translate(Math.round(x) * 2, 0);
    g.scale(-1, 1);
  }
  g.drawImage(shade, dx - 1, dy);
  g.drawImage(shade, dx + 1, dy);
  g.drawImage(shade, dx, dy - 1);
  g.drawImage(shade, dx, dy + 1);
  g.drawImage(scratch, dx, dy);
  if (flipX) g.restore();
}

// ---------- made-up skins ----------

export interface Look {
  skin: string;
  hair: string;
  cut: "short" | "long" | "bun" | "bald" | "hood" | "spiky";
  eyes: string;
  shirt: string;
  trim: string;
  sleeves: "long" | "short";
  pants: string;
  boots: string;
  extra?: "scarf" | "beard" | "goggles" | "apron" | "glasses" | "visor" | "stripe";
  extraInk?: string;
  hat?: "wizard" | "frog" | "ears" | "leaf" | "cap";
  hatInk?: string;
}

const HATS: Record<NonNullable<Look["hat"]>, readonly string[]> = {
  wizard: ["....1.....", "....11....", "...111....", "...1211...", "..111111..", "..122221..", "1111111111"],
  frog: [".11....11.", "1j11..11j1", "1B11111B11"],
  ears: ["1........1", "11......11", "121....121"],
  leaf: ["...12.....", "..1221....", "...21....."],
  cap: ["..111111..", ".11111111.", "1111111122"],
};

/** Paints one made-up skin onto a sheet, in the same places a real one keeps its parts. */
export function inventSheet(k: Look): Cv {
  const [c, g] = canvas(64, 64);
  const dark = (col: string, t = 0.28): string => mix(col, "#1a0f1e", t);
  const lite = (col: string, t = 0.22): string => mix(col, "#fff3cf", t);
  const hood = k.cut === "hood";
  const scalp = k.cut === "bald" ? k.skin : hood ? k.shirt : k.hair;
  // head: right side, front, left side, back
  for (const hx of [0, 8, 16, 24]) R(g, hx, 8, 8, 8, k.skin);
  const sideRows = k.cut === "long" || hood ? 8 : k.cut === "bald" ? 0 : k.cut === "spiky" ? 3 : 4;
  for (const hx of [0, 16]) {
    R(g, hx, 8, 8, sideRows, scalp);
    R(g, hx, 8, 8, 1, lite(scalp, 0.12));
    if (hx === 0 && sideRows < 8) R(g, 5, 8 + sideRows, 3, 8 - sideRows, k.skin);
  }
  // On the side faces the front of the head is toward the front face: keep that edge as face.
  if (!hood && sideRows === 8) {
    R(g, 5, 11, 3, 5, k.skin);
    R(g, 16, 11, 3, 5, k.skin);
  }
  if (hood) {
    R(g, 6, 10, 2, 5, k.skin);
    R(g, 16, 10, 2, 5, k.skin);
  }
  R(g, 24, 8, 8, k.cut === "bald" ? 0 : k.cut === "short" || k.cut === "spiky" ? 5 : 8, scalp);
  // one eye on each side face, toward the front
  R(g, 6, 12, 1, 1, k.eyes);
  R(g, 17, 12, 1, 1, k.eyes);
  if (k.cut === "bun") R(g, 26, 9, 4, 3, dark(k.hair));
  // the face
  if (k.cut !== "bald") {
    R(g, 8, 8, 8, 2, scalp);
    R(g, 8, 8, 8, 1, lite(scalp, 0.12));
    R(g, 8, 10, 1, hood || k.cut === "long" ? 6 : 2, scalp);
    R(g, 15, 10, 1, hood || k.cut === "long" ? 6 : 2, scalp);
    if (k.cut === "spiky") {
      R(g, 10, 10, 1, 1, scalp);
      R(g, 13, 10, 1, 1, scalp);
    } else if (!hood) R(g, 9, 10, 3, 1, scalp);
    if (hood) R(g, 8, 15, 8, 1, scalp);
  }
  R(g, 9, 12, 1, 1, "#fff3cf");
  R(g, 10, 12, 1, 1, k.eyes);
  R(g, 13, 12, 1, 1, k.eyes);
  R(g, 14, 12, 1, 1, "#fff3cf");
  R(g, 11, 14, 2, 1, dark(k.skin, 0.3));
  if (k.extra === "beard") {
    R(g, 9, 13, 6, 3, k.extraInk ?? k.hair);
    R(g, 11, 14, 2, 1, dark(k.skin, 0.35));
    R(g, 4, 13, 4, 3, k.extraInk ?? k.hair);
    R(g, 16, 13, 4, 3, k.extraInk ?? k.hair);
  }
  if (k.extra === "goggles") {
    R(g, 8, 11, 8, 1, INK.k);
    R(g, 9, 11, 2, 2, INK.g);
    R(g, 13, 11, 2, 2, INK.g);
    R(g, 9, 12, 1, 1, INK.F);
    R(g, 14, 12, 1, 1, INK.F);
    R(g, 0, 11, 8, 1, INK.k);
    R(g, 16, 11, 8, 1, INK.k);
    R(g, 24, 11, 8, 1, INK.k);
  }
  if (k.extra === "glasses") {
    R(g, 9, 11, 2, 1, INK.g);
    R(g, 13, 11, 2, 1, INK.g);
    R(g, 9, 13, 2, 1, INK.g);
    R(g, 13, 13, 2, 1, INK.g);
    R(g, 11, 12, 2, 1, INK.g);
  }
  if (k.extra === "visor") {
    R(g, 8, 10, 8, 1, k.extraInk ?? INK.s);
    R(g, 8, 11, 8, 1, dark(k.extraInk ?? INK.s));
    R(g, 0, 10, 8, 1, k.extraInk ?? INK.s);
    R(g, 16, 10, 8, 1, k.extraInk ?? INK.s);
  }
  // body: right side, front, left side, back
  R(g, 16, 20, 24, 12, k.shirt);
  R(g, 16, 20, 4, 12, dark(k.shirt, 0.15));
  R(g, 28, 20, 4, 12, dark(k.shirt, 0.15));
  R(g, 20, 20, 8, 1, lite(k.shirt, 0.15));
  R(g, 23, 20, 2, 2, k.skin);
  R(g, 16, 29, 24, 1, k.trim);
  R(g, 16, 30, 24, 2, k.pants);
  R(g, 23, 29, 2, 1, INK.g);
  if (k.extra === "stripe") {
    R(g, 20, 23, 8, 2, k.extraInk ?? k.trim);
    R(g, 32, 23, 8, 2, k.extraInk ?? k.trim);
    R(g, 16, 23, 4, 2, dark(k.extraInk ?? k.trim, 0.15));
  }
  if (k.extra === "apron") {
    R(g, 21, 23, 6, 7, k.extraInk ?? INK.K);
    R(g, 22, 21, 1, 2, k.extraInk ?? INK.K);
    R(g, 25, 21, 1, 2, k.extraInk ?? INK.K);
    R(g, 23, 25, 2, 2, dark(k.extraInk ?? INK.K, 0.2));
  }
  if (k.extra === "scarf") {
    const s = k.extraInk ?? INK.R;
    R(g, 16, 20, 24, 2, s);
    R(g, 25, 22, 2, 4, s);
    R(g, 25, 25, 2, 1, dark(s));
    R(g, 20, 21, 8, 1, dark(s, 0.18));
  }
  if (hood) R(g, 32, 20, 8, 3, dark(k.shirt, 0.12));
  if (k.cut === "long") {
    R(g, 32, 20, 8, 4, k.hair);
    R(g, 32, 23, 8, 1, dark(k.hair, 0.2));
  }
  // right arm: outer side, front, inner side, back
  const sleeve = k.sleeves === "long" ? 9 : 4;
  R(g, 40, 20, 16, 12, k.skin);
  R(g, 40, 20, 16, sleeve, k.shirt);
  R(g, 40, 20, 4, sleeve, dark(k.shirt, 0.15));
  R(g, 40, 20 + sleeve - 1, 16, 1, k.trim);
  R(g, 44, 20, 4, 1, lite(k.shirt, 0.15));
  // right leg: outer side, front, inner side, back
  R(g, 0, 20, 16, 12, k.pants);
  R(g, 0, 20, 4, 12, dark(k.pants, 0.15));
  R(g, 0, 29, 16, 3, k.boots);
  R(g, 4, 29, 4, 1, lite(k.boots, 0.2));
  R(g, 7, 20, 1, 9, dark(k.pants, 0.18));
  return c;
}

export function inventFigure(k: Look): Figure {
  let hat: Spr | null = null;
  if (k.hat) {
    const ink = k.hatInk ?? k.shirt;
    hat = sprite(HATS[k.hat], { "1": ink, "2": mix(ink, "#fff3cf", 0.35) }, 5);
  }
  return figureFrom(inventSheet(k), hat);
}

/** The member's own sheet from beside the page, or `null` when there is none. */
export function loadSkin(url: string): Promise<Figure | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) return resolve(null);
      const [c, g] = canvas(64, 64);
      g.drawImage(img, 0, 0);
      resolve(figureFrom(c));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** A face at a size that suits a card, as a fresh canvas. */
export function portraitCanvas(f: Figure, scale = 4): Cv {
  const [c, g] = canvas(f.portrait.width * scale, f.portrait.height * scale);
  g.drawImage(f.portrait, 0, 0, c.width, c.height);
  c.className = "face";
  return c;
}
