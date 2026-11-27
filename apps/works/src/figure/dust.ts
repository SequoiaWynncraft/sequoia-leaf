/**
 * What your feet meet: dust or blades of grass by the ground underfoot, at a walk, a run and pulling
 * up (`UNDERFOOT` in `feel.ts`), a puff where you bump into something or are put aside, and the step's
 * sound. Carried over from Outworks (`underfoot.ts` and `fx.ts`), for a yard whose ground is a kept
 * picture: what is underfoot is read from the yard's floor where the foot comes down, so dust is the
 * earth it was raised from and blades the green of the grass, each a tone lighter to show against it.
 *
 * A bit is part of the picture. It keeps the ground row it was raised from, and is drawn among what
 * stands at the depth of that row, just behind whatever stands on it: nobody's own dust is drawn over
 * them. It is drawn whole or not at all: one two pixels across is one across for the last third of
 * its life, and then it is gone.
 */
import { rgb as channels } from "@sequoia-leaf/kit/pix.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

import type { Ground } from "../art/ground.ts";
import { type Raised, UNDERFOOT } from "./feel.ts";

/** The most bits alive at once. */
const BITS_MOST = 160;
/** How quickly dust slows as it rises, as a share of its speed each second. */
const DUST_DRAG = 2.5;
/** The colour of what a bump or a hop aside knocks up: the yard's dust. */
const KNOCKED = "#cbb894";
/** How far toward cream what feet raise is from the floor it rose from: dust, and a blade of grass. */
const LIGHTER = { dust: 0.4, blade: 0.25 } as const;

/** One bit. */
export interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pull downward, and how quickly it slows. */
  pull: number;
  drag: number;
  life: number;
  ttl: number;
  colour: string;
  size: number;
  /** The ground row it was raised from: it is drawn at that row's depth. */
  row: number;
  /** It ends as it comes down to its row: a blade of grass. */
  lands: boolean;
}

/** A place, in the yard's pixels. */
interface At {
  readonly x: number;
  readonly y: number;
}

/** A bit's picture, by its colour and size: a pixel, or two by two. */
const dots = new Map<string, HTMLCanvasElement>();
export function dot(colour: string, size: number): HTMLCanvasElement {
  const key = `${colour}/${size}`;
  let c = dots.get(key);
  if (!c) {
    const made = makeCanvas(size, size);
    made.g.fillStyle = colour;
    made.g.fillRect(0, 0, size, size);
    c = made.c;
    dots.set(key, c);
  }
  return c;
}

/** The colour of the floor at a point, red, green and blue; nothing where there is no floor. */
export type Floor = (x: number, y: number) => readonly [number, number, number] | null;

/**
 * The yard's floor as the yard keeps it (`art/ground.ts`): the picture a figure walks on, its own
 * colour under whatever lies on it, worked out for the one pixel under a foot.
 */
export function floorOf(ground: Ground): Floor {
  return (x, y) => {
    const col = ground.colour(Math.floor(x), Math.floor(y));
    return col === null ? null : channels(col);
  };
}

/**
 * What the floor under a foot is: grass (greener than it is red or blue) or bare, and the colour of
 * what it raises, the floor's own a tone lighter so that it shows against it: dust well toward
 * cream, blades a little.
 */
export function trodden(rgb: readonly [number, number, number]): { colour: string; grass: boolean } {
  const [r, g, b] = rgb;
  const grass = g > r + 8 && g > b;
  const k = grass ? LIGHTER.blade : LIGHTER.dust;
  const up = (v: number, to: number): number => Math.round(v + (to - v) * k);
  return { colour: `rgb(${up(r, 255)},${up(g, 243)},${up(b, 207)})`, grass };
}

/** The dust and grass your feet raise, as it lives. */
export class Dust {
  readonly bits: Bit[] = [];
  readonly #floor: Floor;

  constructor(floor: Floor) {
    this.#floor = floor;
  }

  #bit(b: Partial<Bit> & { x: number; y: number }): void {
    if (this.bits.length >= BITS_MOST) this.bits.shift();
    this.bits.push({
      vx: 0,
      vy: 0,
      pull: 0,
      drag: 0,
      life: 0,
      ttl: 0.8,
      colour: KNOCKED,
      size: 1,
      row: b.y,
      lands: false,
      ...b,
    });
  }

  /**
   * What a foot raises at `x` on the ground row `row`: dust, which drifts up as it slows, each bit as
   * far as `raised.rise` or a quarter less; or blades, flicked straight up so far and falling back to
   * the row as their life ends.
   */
  #raise(x: number, row: number, raised: Raised, colour: string, blades: boolean): void {
    const { rise, life } = raised;
    for (let i = 0; i < raised.bits; i++) {
      const size = i < raised.big ? 2 : 1;
      const left = x - size / 2;
      if (blades) {
        this.#bit({
          x: left + (Math.random() - 0.5) * 4,
          y: row,
          vx: (Math.random() - 0.5) * 12,
          vy: (-4 * rise) / life,
          pull: (8 * rise) / (life * life),
          ttl: life,
          colour,
          size,
          lands: true,
        });
        continue;
      }
      const up = rise * (0.75 + Math.random() * 0.25);
      this.#bit({
        x: left + (Math.random() - 0.5) * 5,
        y: row - (size - 1) - Math.random(),
        row,
        vx: (Math.random() - 0.5) * 16,
        vy: (-up * DUST_DRAG) / (1 - Math.exp(-DUST_DRAG * life)),
        drag: DUST_DRAG,
        ttl: life,
        colour,
        size,
      });
    }
  }

  /** What the floor under a foot gives, and how much of it now (`pick`); nothing where it gives none. */
  #underfoot(at: At, pick: (t: (typeof UNDERFOOT)["bare"]) => Raised | null): void {
    const rgb = this.#floor(at.x, at.y);
    if (!rgb) return;
    const floor = trodden(rgb);
    const raised = pick(UNDERFOOT[floor.grass ? "grass" : "bare"]);
    if (raised) this.#raise(at.x, at.y, raised, floor.colour, floor.grass);
  }

  /** A soft puff about `y`, lying on the ground row `row`: what a bump or a hop aside knocks up. */
  #puff(x: number, y: number, row: number, count: number, rise: number): void {
    for (let i = 0; i < count; i++)
      this.#bit({
        x: x + (Math.random() - 0.5) * 5,
        y: y + (Math.random() - 0.5) * 2,
        row,
        vx: (Math.random() - 0.5) * 16,
        vy: -rise * (0.4 + Math.random()),
        drag: DUST_DRAG,
        ttl: 0.35 + Math.random() * 0.35,
        size: Math.random() < 0.4 ? 2 : 1,
      });
  }

  /** A foot comes down: the step's sound, and what the floor gives at a walk or a run. */
  footfall(at: At, run: boolean): void {
    sfx.step();
    this.#underfoot(at, (t) => (run ? t.run : t.walk));
  }

  /** Pulling up out of a run: a scuff, and what the floor gives for it. */
  pullUp(at: At): void {
    sfx.step();
    this.#underfoot(at, (t) => t.pullUp);
  }

  /** Running into something solid: a knock, and a little dust at the feet. */
  bump(at: At): void {
    sfx.knock();
    this.#puff(at.x, at.y - 2, at.y, 2, 8);
  }

  /** Put aside from where something was built: dust where the feet land. */
  aside(at: At): void {
    this.#puff(at.x, at.y - 1, at.y, 4, 6);
  }

  /** A frame's passing, `dt` seconds of it. */
  step(dt: number): void {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      if (b === undefined) continue;
      b.life += dt;
      if (b.life >= b.ttl) {
        this.bits.splice(i, 1);
        continue;
      }
      // It goes at the mean of its speeds at the start and the end of the frame: a flick rises as high at any frame rate.
      const [vx, vy] = [b.vx, b.vy];
      const k = Math.max(0, 1 - b.drag * dt);
      b.vx *= k;
      b.vy = (b.vy + b.pull * dt) * k;
      b.x += ((vx + b.vx) / 2) * dt;
      b.y += ((vy + b.vy) / 2) * dt;
      if (b.lands && b.vy > 0 && b.y >= b.row) this.bits.splice(i, 1);
    }
  }

  /** How big a bit is drawn now: two pixels across for its first two thirds, then the middle one of them. */
  static sizeOf(b: Bit): number {
    return b.size > 1 && b.life > (b.ttl * 2) / 3 ? 1 : b.size;
  }
}
