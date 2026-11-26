/**
 * A picture's own colours, on the guild's palette: its strongest tones, each snapped to the pair
 * of palette colours of its hue, so that whatever is drawn in somebody's colours (an effect of
 * theirs, a trim) is in the house's finish whatever their skin is painted in.
 */
import { CORAL, CREAM, GOLD, GREEN, PAPER, SKY, WATER } from "./palette.ts";

/** One colour as the palette has it: deep, and bright. */
export type Tone = readonly [deep: string, bright: string];

/** The palette's colours by hue (degrees round the wheel), each a deep one and a bright one. */
const HUES: readonly (readonly [hue: number, tone: Tone])[] = [
  [350, [SKY[4], CORAL]],
  [286, [SKY[2], SKY[3]]],
  [38, [GOLD[0], GOLD[2]]],
  [112, [GREEN[3], GREEN[4]]],
  [190, [WATER[2], WATER[3]]],
];
/** What a picture with no strong colour in it gets: paper. */
export const PALE: Tone = [PAPER[1], CREAM];

/** A pixel counts as a strong colour when its largest and smallest of red, green and blue are this far apart, of 255. */
const STRONG = 96;
/** A hue has to be at least this many pixels of a picture to be one of its colours. */
const FEW = 4;

/** Where a colour is round the wheel, in degrees; `spread` is its largest of red, green and blue less its smallest. */
function hueOf(r: number, g: number, b: number, spread: number): number {
  const top = Math.max(r, g, b);
  const h = top === r ? ((g - b) / spread) % 6 : top === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  return (h * 60 + 360) % 360;
}

/**
 * The strong colours of a picture given as its pixels (red, green, blue and how solid, one after
 * another), the one there is most of first: every solid pixel of a strong colour counts toward
 * the palette's colour nearest its hue, by how strong it is.
 */
export function strongTones(rgba: ArrayLike<number>): Tone[] {
  const votes = HUES.map(() => ({ weight: 0, pixels: 0 }));
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const [r, g, b] = [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if ((rgba[i + 3] ?? 0) < 128 || spread < STRONG) continue;
    const hue = hueOf(r, g, b, spread);
    const far = HUES.map(([at]) => Math.min(Math.abs(hue - at), 360 - Math.abs(hue - at)));
    const vote = votes[far.indexOf(Math.min(...far))];
    if (!vote) continue;
    vote.weight += spread;
    vote.pixels += 1;
  }
  return HUES.map(([, tone], i) => ({ tone, pixels: votes[i]?.pixels ?? 0, weight: votes[i]?.weight ?? 0 }))
    .filter((v) => v.pixels >= FEW)
    .toSorted((a, b) => b.weight - a.weight)
    .map((v) => v.tone);
}

/** How light a colour written as `#rrggbb` is, from 0 to 255. */
export function lightOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
}
