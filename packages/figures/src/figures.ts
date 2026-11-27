/**
 * Every figure on the stump, typed out as rows of letters (the letters are colours in `pal.ts`), kept
 * as text in `figures.txt`. Each has a picture for standing and, for the ones a member can own and
 * the bosses, one for using its ability (`cast`). `alt` is a second standing picture for things that
 * flap or wobble; without one a figure breathes by sinking a pixel at its `breath` row. A figure
 * that falls in a way of its own has a picture for it (`fall`); anyone else tips over.
 *
 * All of them face right. A dark edge is added when they are baked (`sprites.ts`).
 *
 * A few carry something that is drawn over them rather than typed in, so that how many they have can
 * change in a fight: Clutch's eggs (`<figure> prop`, and where each sits, `carried`).
 *
 * A figure a member can own is up to 22 wide and 26 tall, but for Seqwawa, a hex and a half tall,
 * whose small picture shows only its top rows (`room`), so a card keeps the room it had. Its
 * pictures are all typed to one width, so that a pose stays over the same feet, and its standing
 * picture has no empty row above it.
 *
 * They are drawn as the town draws its own (`apps/town`): in the town's colours only (`pal.ts`),
 * two or three flat tones to a material, small dark eyes. A gnome, a crab, the glorp, the cat and
 * the fox are the town's, larger: `folkart.ts`, `sprites.ts` and `campart.ts` there.
 */
import { type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";
import { hasTrueForm, type TrueFormId } from "@sequoia-leaf/raid/content/graid.ts";
import type { Form } from "@sequoia-leaf/raid/fight/types.ts";

import text from "./figures.txt";
import { readRows } from "./rows.ts";
import type { HowHeld, Swing } from "./tools.ts";

export interface FigureArt {
  readonly rows: readonly string[];
  readonly cast?: readonly string[];
  readonly alt?: readonly string[];
  /** How it lies once it has fallen, where that is its own (Bhlue slumped over its laptop); without one it tips over. */
  readonly fall?: readonly string[];
  /** For one that drums (Unc), its head back, shown by turns with its cast every step while it drums. */
  readonly peck?: readonly string[];
  /** For one that swings a tool (Leetanns), its picture at each beat of a swing but the point, which is its cast. */
  readonly beats?: Partial<Record<SwingPicture, readonly string[]>>;
  /** Where what it holds is in each of its pictures (`tools.ts`). */
  readonly grips?: Partial<Record<Pictured, Grip>>;
  /** The row that folds when it breathes in, counted from the top. */
  readonly breath?: number;
  /** Lies flat already (Jet, on its belly): it falls by turning belly up where it lies, not by tipping onto its side. */
  readonly flat?: true;
  /** Hovers: its shadow is small and it bobs rather than breathes. */
  readonly flies?: true;
  /** Has something written on it, so it is never mirrored to face the other way. */
  readonly sym?: true;
  /** The row its head starts at, for a small picture of it, where that is not the top. */
  readonly head?: number;
  /** How many of its rows, from the top, a small picture of it shows, where that is not all of them: the rest is cut off at its base. */
  readonly room?: number;
  /** The column that stands on its spot, where that is not its middle: Crab #8 stands half off its hex. */
  readonly feet?: number;
  /** What it carries, drawn over it (`carried`): the picture, and where each one sits standing and casting. */
  readonly prop?: Prop;
}
/** A column and a row of a picture, from its top left. */
export type Spot = readonly [x: number, y: number];
/** The beats of a swing that have a picture of their own: drawn back, at the top, brought down. */
export type SwingPicture = Exclude<Swing, "point">;
export const SWING_PICTURES: readonly SwingPicture[] = ["draw", "top", "down"];
/** A figure's pictures that can have something in hand: standing, casting, and the beats of a swing. */
export type Pictured = "rows" | "cast" | SwingPicture;
export const PICTURED: readonly Pictured[] = ["rows", "cast", ...SWING_PICTURES];
/** Where a figure has what it holds in one of its pictures: the pixel in its paw, and how the tool lies there. */
export interface Grip {
  readonly at: Spot;
  readonly how: HowHeld;
}
export interface Prop {
  readonly rows: readonly string[];
  readonly at: readonly Spot[];
  readonly castAt: readonly Spot[];
}
/** How many of what it carries it has now, and which of them rocks a pixel aside (-1 none). */
export interface Carried {
  readonly n: number;
  readonly rock: number;
}

/**
 * A picture with what it carries laid over it, letter by letter: the first `n` of the places, the
 * one that rocks a pixel to the right. A clear pixel of the prop leaves the picture's own.
 */
export function carrying(rows: readonly string[], prop: readonly string[], at: readonly Spot[], c: Carried): string[] {
  const out = rows.map((r) => r.split(""));
  at.slice(0, c.n).forEach(([x0, y0], i) => {
    const x1 = x0 + (i === c.rock ? 1 : 0);
    prop.forEach((line, dy) => {
      line.split("").forEach((ch, dx) => {
        const row = out[y0 + dy];
        if (ch !== "." && row && x1 + dx < row.length) row[x1 + dx] = ch;
      });
    });
  });
  return out.map((r) => r.join(""));
}

/** Where what a figure carries sits, standing and casting, beside its rows in `figures.txt`. */
type Places = Pick<Prop, "at" | "castAt">;

/** What a figure's pictures say beside their rows: where it breathes, where its head starts, whether it flies or has writing on it. */
/** What is kept of a figure beside its pictures. */
type Kept = Omit<FigureArt, "rows" | "cast" | "alt" | "fall" | "prop" | "beats" | "peck">;
const KEPT: Readonly<Partial<Record<UnitKind, Kept>>> = {
  emberkit: { breath: 12, head: 2 },
  mossmote: { breath: 13, head: 3 },
  moth: { flies: true },
  worm: { breath: 12 },
  finch: { breath: 11 },
  crab7: { sym: true },
  barrowgnome: { breath: 14, head: 2 },
  peep: { head: 4 },
  vi: { breath: 13 },
  kettle: { head: 3 },
  slug: { breath: 9 },
  glorp: { breath: 10 },
  chickaree: { breath: 14, head: 1 },
  jay: { breath: 12, head: 2 },
  crab12: { sym: true },
  flop: { breath: 9 },
  lanterngnome: { breath: 15, head: 5 },
  jet: { flat: true },
  leafling: { breath: 16, head: 3 },
  cindernewt: { breath: 9 },
  drizzlefrog: { breath: 10, head: 2 },
  rock: { breath: 99 },
  bushgnome: { breath: 14, head: 2 },
  crab23: { sym: true },
  munch: { breath: 12, head: 1 },
  crab31: { sym: true },
  larp: { head: 3 },
  bhlue: { breath: 12 },
  badger: { breath: 9 },
  fogowl: { breath: 15, head: 2 },
  heron: { breath: 12 },
  crab40: { sym: true },
  apothecary: { breath: 14, head: 2 },
  // A nest does not breathe: its eggs rock.
  clutch: { breath: 99 },
  pomp: { head: 2 },
  ace: { breath: 12 },
  greg: { breath: 14, head: 2 },
  whitefox: { breath: 18, head: 5 },
  hearthcat: { breath: 15, head: 1 },
  seqwawa: { head: 3, room: 25 },
  crab8: { sym: true, feet: 6 },
  yule: { head: 1 },
  // A stump does not breathe: its bird cocks its head.
  unc: { breath: 99 },
  // Its tool in its paw: at its side, behind its head drawn back, pointed ahead, straight up, brought down.
  leetanns: {
    breath: 12,
    grips: {
      rows: { at: [15, 14], how: "side" },
      cast: { at: [17, 10], how: "forward" },
      draw: { at: [1, 1], how: "side" },
      top: { at: [15, 0], how: "up" },
      down: { at: [18, 16], how: "forward" },
    },
  },
  glorplet: { breath: 2 },
  uncounted: { sym: true },
  biguncounted: { sym: true },
  sprout: { breath: 4 },
  hatchling: { breath: 7 },
  gnat: { flies: true },
  bramble: { breath: 9 },
  wasp: { flies: true },
  puddle: { breath: 99 },
  toadstool: { breath: 8 },
  gust: { flies: true },
  magpie: { breath: 7 },
  mud: { breath: 3 },
  crab: { sym: true },
  oldbramble: { breath: 14 },
  hoardmagpie: { breath: 12 },
  bigcrab: { sym: true },
};

/** The same for Graid's true forms (`<figure> true` in `figures.txt`). */
const KEPT_TRUE: Readonly<Record<TrueFormId, Kept>> = {
  worm: { breath: 13 },
  moth: { flies: true },
  rock: { breath: 9 },
  greg: { breath: 15, head: 2 },
  whitefox: { breath: 18, head: 5 },
};

/** Where each figure's prop sits (`<figure> prop` in `figures.txt`). */
const CARRIES: Readonly<Partial<Record<UnitKind, Places>>> = {
  // Three eggs in the nest's moss, standing and as it tips forward.
  clutch: {
    at: [
      [4, 0],
      [9, 0],
      [14, 0],
    ],
    castAt: [
      [5, 1],
      [10, 1],
      [15, 1],
    ],
  },
};

const ROWS = readRows(text);

/** A figure's pictures, as itself or (one of Graid's five) in its true form: its rows from `figures.txt`, and what is kept of it here. */
export function artOf(kind: UnitKind, form: Form = "plain"): FigureArt {
  const named = form === "true" && hasTrueForm(kind) ? `${kind} true` : kind;
  const cast = ROWS.get(`${named} cast`);
  const alt = ROWS.get(`${named} alt`);
  const fall = ROWS.get(`${named} fall`);
  const peck = ROWS.get(`${named} peck`);
  const beats = Object.fromEntries(
    SWING_PICTURES.flatMap((b) => {
      const rows = ROWS.get(`${named} ${b}`);
      return rows ? [[b, rows]] : [];
    }),
  );
  const prop = ROWS.get(`${named} prop`);
  const places = CARRIES[kind];
  return {
    rows: ROWS.get(named) ?? [],
    ...(cast ? { cast } : {}),
    ...(alt ? { alt } : {}),
    ...(fall ? { fall } : {}),
    ...(peck ? { peck } : {}),
    ...(Object.keys(beats).length > 0 ? { beats } : {}),
    ...(prop && places ? { prop: { rows: prop, ...places } } : {}),
    ...(named === kind ? KEPT[kind] : hasTrueForm(kind) ? KEPT_TRUE[kind] : {}),
  };
}
