/**
 * How the town's own are drawn: never with a player's skin. The cats, the glorp and the fox are the
 * camp's own pets (`campart.ts`) in their coats; the gnomes are the Works' gatherer (`apps/works`,
 * `art/machines.ts`), copied here with hats in a few colours and a two-step waddle. Nothing in this
 * file reads a skin.
 */

import { BARK, CREAM, GOLD, GREEN, SKY, WATER } from "@sequoia-leaf/kit/palette.ts";
import { flipped, R } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import type { CampArt, PetArt } from "./campart.ts";
import type { Townsperson } from "./folk.ts";
import { spr, type Sprite } from "./sprites.ts";

/** A townsperson's pictures: the camp's pets' set, and for a gnome a few poses more. */
export interface FolkArt extends PetArt {
  /** Bent to the ground, counting something; leaning, reading something. */
  bend: Sprite | null;
  lean: Sprite | null;
  /** The picture for a card: standing still, facing us. */
  face: HTMLCanvasElement;
  /** How tall it stands, for where its name goes and what a touch finds. */
  tall: number;
}

// ---------- the gnome, as the Works draws its gatherers ----------

const CLAY = ["#7a2f2a", "#b0483a", SKY[5], "#f4a08c"] as const;
/** The gnomes' hats, by `HAT` in `folk.ts`: red, gold, blue, green. */
const HATS: readonly (readonly [string, string])[] = [
  [CLAY[2], CLAY[1]],
  [GOLD[1], GOLD[0]],
  [WATER[3], WATER[2]],
  [GREEN[4], GREEN[3]],
];
const FACE = "#e9d8b8";

/**
 * A gnome in one of five poses (standing, leaning, bent to the ground, arms up, sat down asleep),
 * or standing on one foot of a waddle (`step` 1 or 2): that boot lifted and the rest of him leant
 * a pixel over the other.
 */
function gnome(hat: readonly [string, string], pose: number, step = 0): Sprite {
  const { c, g } = makeCanvas(12, 15);
  const [hx, hy] = pose === 1 ? [1, 1] : pose === 2 ? [2, 4] : pose === 4 ? [0, 3] : [0, 0];
  const lean = step === 1 ? -1 : step === 2 ? 1 : 0;
  const tunic = WATER[1];
  const dark = WATER[0];
  // Boots and body.
  if (pose === 4) {
    R(g, 2, 13, 3, 2, BARK[1]);
    R(g, 7, 13, 3, 2, BARK[1]);
    R(g, 3, 9, 6, 5, tunic);
    R(g, 3, 13, 6, 1, dark);
  } else {
    R(g, 3, step === 1 ? 12 : 13, 2, 2, BARK[1]);
    R(g, 7, step === 2 ? 12 : 13, 2, 2, BARK[1]);
    R(g, 3 + lean, 8 + (pose === 2 ? 2 : 0), 6, 5 - (pose === 2 ? 2 : 0), tunic);
    R(g, 3 + lean, 12, 6, 1, dark);
    R(g, 3 + lean, 11, 6, 1, BARK[0]);
    R(g, 5 + lean, 11, 2, 1, GOLD[1]);
  }
  // Arms.
  if (pose === 3) {
    R(g, 2, 3, 1, 5, tunic);
    R(g, 9, 3, 1, 5, tunic);
    R(g, 2, 2, 1, 1, FACE);
    R(g, 9, 2, 1, 1, FACE);
  } else if (pose === 2) {
    R(g, 9, 9, 1, 4, tunic);
    R(g, 10, 12, 1, 2, FACE);
  } else if (pose === 4) {
    R(g, 2, 10, 1, 3, tunic);
    R(g, 9, 10, 1, 3, tunic);
  } else {
    R(g, 2 + lean, 8 + hy, 1, 3, tunic);
    R(g, 9 + lean, 8 + hy, 1, 3, tunic);
    R(g, 9 + hx + lean, 11 + hy, 1, 1, FACE);
  }
  // Head: a nose, a beard, and the hat down over the eyes.
  const x = 3 + hx + lean;
  const y = 4 + hy;
  R(g, x + 1, y, 4, 2, FACE);
  R(g, x + 2, y + 1, 2, 1, CLAY[3]);
  R(g, x + 1, y + 2, 4, 2, CREAM);
  R(g, x + 2, y + 4, 2, 1, CREAM);
  R(g, x + 1, y + 3, 1, 1, "#cbb894");
  // The hat: a tall cone with a brim, its tip flopped over when he sleeps.
  R(g, x, y - 1, 6, 1, hat[1]);
  R(g, x + 1, y - 2, 4, 1, hat[0]);
  R(g, x + 1, y - 3, 3, 1, hat[0]);
  if (pose === 4) {
    R(g, x + 2, y - 4, 3, 1, hat[0]);
    R(g, x + 4, y - 3, 2, 1, hat[1]);
  } else {
    R(g, x + 2, y - 4, 2, 1, hat[0]);
    R(g, x + 2 + (pose === 2 ? 1 : 0), y - 5 + (pose === 2 ? 1 : 0), 1, 1, hat[0]);
  }
  R(g, x + 1, y - 2, 1, 1, CREAM);
  return spr(c, 6, 15);
}

const mirror = (s: Sprite): Sprite => ({ c: flipped(s.c), ax: s.c.width - s.ax, ay: s.ay });

function gnomeArt(hue: number): FolkArt {
  const hat = HATS[hue % HATS.length] ?? HATS[0] ?? [CLAY[2], CLAY[1]];
  const stand = gnome(hat, 0);
  const walkR = [gnome(hat, 0, 1), gnome(hat, 0, 2)];
  return {
    sit: [stand],
    walk: walkR.map(mirror),
    walkR,
    sleep: gnome(hat, 4),
    glad: gnome(hat, 3),
    bend: gnome(hat, 2),
    lean: gnome(hat, 1),
    face: stand.c,
    tall: 16,
  };
}

// ---------- everybody ----------

let pets: CampArt["pets"] | null = null;
const made = new Map<string, FolkArt>();

/** Hands over the camp's pets, which the cats, the glorp and the fox are drawn as. Once, before anybody is drawn. */
export function initFolkArt(art: CampArt): void {
  pets = art.pets;
}

/** How a townsperson is drawn. Made once each. */
export function folkArt(t: Townsperson): FolkArt {
  const had = made.get(t.id);
  if (had) return had;
  let art: FolkArt;
  if (t.kind === "gnome") art = gnomeArt(t.hue);
  else {
    if (!pets) throw new Error("the town's pictures are not ready");
    const p = pets(t.kind, t.hue);
    const still = p.sit[0];
    art = {
      ...p,
      bend: null,
      lean: null,
      face: still?.c ?? makeCanvas(1, 1).c,
      tall: t.kind === "fox" ? 13 : t.kind === "cat" ? 10 : 9,
    };
  }
  made.set(t.id, art);
  return art;
}
