/**
 * What a figure carries in its hand, drawn over it where its hand is, one at a time in turn where it
 * has several (`Shown.holds`): the Commodore's brass hand bell, his Chorus instrument, hanging from
 * its handle; Leetanns' axe, pickaxe, rod and scythe, in stone and bark with one gold pixel, each held
 * near the end of its handle. A tool lies as the picture it is in says (`Grip` in `figures.ts`):
 * upright at its side, turned a quarter to point ahead, or straight up over the head by the end of a
 * longer handle, so that the head of the tool is well above the figure's.
 */
import { INK } from "@sequoia-leaf/kit/palette.ts";
import { bitmap, flipped, outlined } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import type { UnitKind } from "@sequoia-leaf/raid/content/figures.ts";

import { PAL } from "./pal.ts";

/** How a tool lies in a hand: upright at the side, turned a quarter to point ahead, or held straight up over the head. */
export type HowHeld = "side" | "forward" | "up";
/** The beats of a tool swung at somebody, in the order they come: drawn back, pointed, held at the top, brought down. */
export type Swing = "draw" | "point" | "top" | "down";

/** Something carried: its rows, and the pixel of it that is in the hand. */
interface Held {
  readonly rows: readonly string[];
  readonly grip: readonly [x: number, y: number];
}
/** And how it is held straight up over the head, where that is its own. */
interface Carry extends Held {
  readonly up?: Held;
}

const IN_HAND: Readonly<Partial<Record<UnitKind, readonly Carry[]>>> = {
  commodore: [{ rows: ["..n..", ".yYy.", "yyYyy", "..o.."], grip: [2, 0] }],
  leetanns: [
    {
      rows: ["tS...", "SSSn.", "tS.n.", "...n.", "...n.", "...n.", "...y."],
      grip: [3, 5],
      up: { rows: ["tS...", "SSSn.", "tS.n.", "...n.", "...n.", "...n.", "...n.", "...n.", "...y."], grip: [3, 7] },
    },
    {
      rows: [".tSSS..", "S..n.St", "...n...", "...n...", "...n...", "...y..."],
      grip: [3, 4],
      up: {
        rows: [".tSSS..", "S..n.St", "...n...", "...n...", "...n...", "...n...", "...n...", "...n...", "...y..."],
        grip: [3, 7],
      },
    },
    {
      rows: ["....n", "...n.", "...n.", "..n..", "..n..", ".n...", ".y..."],
      grip: [1, 5],
      up: { rows: ["..n..", "..n..", "..n..", "..n..", "..n..", "..n..", "..n..", "..n..", "..y.."], grip: [2, 7] },
    },
    {
      rows: [".tSSS.", "S...n.", "....n.", "...n..", "...n..", "..n...", "..y..."],
      grip: [2, 5],
      up: {
        rows: [".tSSS.", "S...n.", "....n.", "....n.", "....n.", "....n.", "....n.", "....n.", "....y."],
        grip: [4, 7],
      },
    },
  ],
};

/** Whether a figure carries anything in its hand. */
export const carriesInHand = (kind: UnitKind): boolean => (IN_HAND[kind]?.length ?? 0) > 0;

/** A picture turned a quarter round to the right, and where a pixel of it went. */
function turned(pic: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = makeCanvas(pic.height, pic.width);
  g.translate(pic.height, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(pic, 0, 0);
  return c;
}

/** A picture of what is in a hand, and the pixel of it in the hand, from its top left. */
export interface InHand {
  readonly pic: HTMLCanvasElement;
  readonly grip: readonly [x: number, y: number];
}
const made = new Map<string, InHand>();
/**
 * What a figure has in hand now (the `holds`th of what it carries), lying as said and facing left or
 * right, edged, made the first time it is asked for; null for one with nothing in hand.
 */
export function inHandOf(kind: UnitKind, holds: number, how: HowHeld, left: boolean): InHand | null {
  const all = IN_HAND[kind] ?? [];
  const carry = all[holds % Math.max(1, all.length)];
  if (!carry) return null;
  const key = `${kind} ${holds % all.length} ${how} ${left}`;
  const had = made.get(key);
  if (had) return had;
  const held = (how === "up" && carry.up) || carry;
  // Edged, the picture is a pixel larger all round.
  const upright = outlined(bitmap(held.rows, PAL), INK);
  let pic = upright;
  let grip: readonly [number, number] = [held.grip[0] + 1, held.grip[1] + 1];
  if (how === "forward") {
    pic = turned(upright);
    grip = [upright.height - 1 - grip[1], grip[0]];
  }
  if (left) {
    pic = flipped(pic);
    grip = [pic.width - 1 - grip[0], grip[1]];
  }
  const out = { pic, grip };
  made.set(key, out);
  return out;
}
