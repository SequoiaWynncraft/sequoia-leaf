/**
 * The street as a plan: how long it is, where each trunk stands, where each place is and where one
 * stands to use it. Distances are in art pixels along the street; heights are measured up from the
 * line the buildings stand on.
 */

export const WW = 1960;

export type PlaceId = "camp" | "quests" | "treasury" | "market" | "fire" | "works" | "pond";

export interface Place {
  readonly id: PlaceId;
  readonly name: string;
  /** One word, for the dock. */
  readonly short: string;
  readonly icon: string;
  /** The middle of the place, and where a visitor stands to use it. */
  readonly x: number;
  readonly stand: number;
  /** How far either side of `stand` still counts as being there. */
  readonly reach: number;
  /** What a tap must land on: from x0 to x1 along the street, and up to `top` above the base line. */
  readonly x0: number;
  readonly x1: number;
  readonly top: number;
  /** Where guild-mates loiter, and what they are doing when they do. */
  readonly spots: readonly number[];
  readonly doing: string;
  /** How high the "press E" bubble floats. */
  readonly prompt: number;
}

export const PLACES: readonly Place[] = [
  {
    id: "camp",
    name: "Your camp",
    short: "Camp",
    icon: "camp",
    x: 118,
    stand: 132,
    reach: 26,
    x0: 96,
    x1: 142,
    top: 42,
    spots: [150, 176],
    doing: "Reading the signpost",
    prompt: 46,
  },
  {
    id: "quests",
    name: "Quest board",
    short: "Quests",
    icon: "scroll",
    x: 330,
    stand: 306,
    reach: 36,
    x0: 302,
    x1: 358,
    top: 54,
    spots: [292, 352, 374],
    doing: "Reading the quest board",
    prompt: 60,
  },
  {
    id: "treasury",
    name: "Treasury",
    short: "Treasury",
    icon: "sun",
    x: 520,
    stand: 501,
    reach: 34,
    x0: 494,
    x1: 546,
    top: 70,
    spots: [474, 562, 584],
    doing: "Haggling with Cinfy",
    prompt: 76,
  },
  {
    id: "market",
    name: "Market",
    short: "Market",
    icon: "stall",
    x: 767,
    stand: 767,
    reach: 62,
    x0: 694,
    x1: 840,
    top: 54,
    spots: [712, 736, 800, 826],
    doing: "Browsing the stalls",
    prompt: 60,
  },
  {
    id: "fire",
    name: "Campfire",
    short: "Fire",
    icon: "fire",
    x: 1070,
    stand: 1055,
    reach: 44,
    x0: 1052,
    x1: 1088,
    top: 26,
    spots: [1012, 1124],
    doing: "Warming up by the fire",
    prompt: 44,
  },
  {
    id: "works",
    name: "The Works",
    short: "Works",
    icon: "gear",
    x: 1420,
    stand: 1388,
    reach: 40,
    x0: 1356,
    x1: 1488,
    top: 78,
    spots: [1366, 1438, 1466],
    doing: "Peering into the Works",
    prompt: 68,
  },
  {
    id: "pond",
    name: "Crab pond",
    short: "Pond",
    icon: "crab",
    x: 1760,
    stand: 1738,
    reach: 60,
    x0: 1668,
    x1: 1690,
    top: 30,
    spots: [1700, 1776, 1812],
    doing: "Counting crabs",
    prompt: 40,
  },
];

export function place(id: PlaceId): Place {
  const found = PLACES.find((p) => p.id === id);
  if (!found) throw new Error(`no such place: ${id}`);
  return found;
}

/** The giant trunks the street runs between: middle and width. The third holds the Treasury. */
export const TRUNKS: readonly { readonly x: number; readonly w: number }[] = [
  { x: 26, w: 78 },
  { x: 216, w: 62 },
  { x: 520, w: 118 },
  { x: 918, w: 68 },
  { x: 1228, w: 74 },
  { x: 1596, w: 64 },
  { x: 1934, w: 86 },
];

export const WORKS_X = 1420;
/** The middle of the Works' doorway. */
export const WORKS_DOOR = 1408;
export const FIRE_X = 1070;
export const POND_X = 1760;
export const POND_RX = 64;
export const STALLS: readonly number[] = [722, 812];

/** Where one can sit by the fire: along the street, and which way one then faces. */
export const SEATS: readonly { readonly x: number; readonly face: 1 | -1 }[] = [
  { x: FIRE_X - 44, face: 1 },
  { x: FIRE_X - 29, face: 1 },
  { x: FIRE_X + 27, face: -1 },
  { x: FIRE_X + 44, face: -1 },
];

/** Lamp posts along the back of the path. */
export const LAMPS: readonly number[] = [168, 420, 628, 864, 990, 1160, 1318, 1538, 1652, 1862];

export interface Lantern {
  readonly x: number;
  /** Below the string's fixing height, by how much. */
  readonly drop: number;
  lit: boolean;
  /** Who it was lit for, shown when it is touched. */
  note: string;
  /** Seconds since it was last lit or touched, for its flare and swing. */
  age: number;
  swing: number;
}
export interface BannerSlot {
  readonly x: number;
  readonly drop: number;
  /** Null while nothing hangs here. */
  name: string | null;
  note: string;
  colour: number;
  age: number;
  flutter: number;
}
export interface Span {
  readonly x0: number;
  readonly x1: number;
  readonly sag: number;
}

export const SPANS: readonly Span[] = TRUNKS.slice(0, -1).map((t, i) => {
  const next = TRUNKS[i + 1] ?? t;
  const x0 = t.x + t.w / 2 - 3;
  const x1 = next.x - next.w / 2 + 3;
  return { x0, x1, sag: Math.min(26, (x1 - x0) * 0.085) };
});

export function sagAt(span: Span, x: number): number {
  const u = (x - span.x0) / (span.x1 - span.x0);
  return span.sag * 4 * u * (1 - u);
}

/** Lanterns every so often along each string, and between some of them a place for a banner. */
export function hangings(): { lanterns: Lantern[]; banners: BannerSlot[] } {
  const lanterns: Lantern[] = [];
  const banners: BannerSlot[] = [];
  for (const span of SPANS) {
    const length = span.x1 - span.x0;
    const count = Math.max(2, Math.round(length / 25));
    const gap = length / count;
    for (let i = 0; i < count; i++) {
      const x = span.x0 + gap * (i + 0.5);
      lanterns.push({ x, drop: sagAt(span, x), lit: false, note: "", age: 99, swing: 0 });
    }
    // A banner hangs midway between two lanterns, on every third gap or so.
    for (let i = 1; i < count; i++) {
      if (count < 5 ? i !== Math.round(count / 2) : i % 3 !== 1) continue;
      const x = span.x0 + gap * i;
      banners.push({ x, drop: sagAt(span, x), name: null, note: "", colour: 0, age: 99, flutter: 0 });
    }
  }
  return { lanterns, banners };
}
