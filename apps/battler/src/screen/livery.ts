/**
 * The colours anything of a figure's own is drawn in. A person's are their skin's strongest tones
 * as the palette has them (the kit's `tones.ts`), so a member's ability is in their own colours
 * and in the house's finish; anyone else's are their kin's colour. Each has a part to play: most
 * of a thing is `main`, its edging `trim`, what burns in it `core`, and what flies off it `spark`.
 */
import { rigOf } from "@sequoia-leaf/figures/sprites.ts";
import { CREAM, GOLD } from "@sequoia-leaf/kit/palette.ts";
import { lightOf, PALE, type Tone } from "@sequoia-leaf/kit/tones.ts";
import type { UnitKind } from "@sequoia-leaf/raid";

import { colourOf } from "./board.ts";

export interface Livery {
  readonly main: Tone;
  readonly trim: Tone;
  readonly core: Tone;
  readonly spark: Tone;
}

/** The parts a picture's own colours play, strongest first: the strongest is `main`, the lightest of the rest `core`, the darkest `trim`, and one between them `spark`. */
export function liveryFrom(tones: readonly Tone[]): Livery {
  const [main = PALE, ...rest] = tones;
  const light = rest.toSorted((a, b) => lightOf(b[1]) - lightOf(a[1]));
  const core = light[0] ?? PALE;
  return { main, core, trim: light.length > 1 ? (light.at(-1) ?? main) : main, spark: light[1] ?? core };
}

const worn = new WeakMap<object, Livery>();

/** A figure's own colours: a person's from their skin as it is now, anyone else's from their kin. */
export function liveryOf(kind: UnitKind): Livery {
  const body = rigOf(kind);
  if (!body) {
    const col = colourOf(kind);
    return { main: [col, col], trim: [col, col], core: [GOLD[1], CREAM], spark: [col, CREAM] };
  }
  let l = worn.get(body);
  if (!l) {
    l = liveryFrom(body.tones);
    worn.set(body, l);
  }
  return l;
}

/** A figure's own colours as a list, for sparks: the bright one of each. */
export const ownOf = (kind: UnitKind): readonly string[] => {
  const l = liveryOf(kind);
  return [l.main[1], l.trim[1], l.core[1], l.spark[1]];
};
