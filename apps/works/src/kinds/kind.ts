/**
 * What a kind of piece is on the page, in one module of its own (`kinds/<kind>.ts`), beside its rules
 * (`@sequoia-leaf/factory`'s `kinds/<kind>.ts`): its picture for a button and a card, how it is drawn
 * standing in the yard, what lies flat over its tile, its lamps, its card's rows and buttons, what
 * the dock says with it in hand, its colours on the map and in a blueprint's picture, and its place in
 * the dock. Every kind of the rules has one (`kinds/index.ts` is a record by name, so a kind without
 * one does not build).
 *
 * A kind's module imports nothing of the page that holds the yard or draws the frame: what a hook
 * needs of those is handed to it (`Drawn`, `LampsAt`, a card's print), so that a card is still drawn
 * from its print alone (`cards.test.ts`) and the frame from its own state.
 */
import type { Dir, Item, Kind, Yard } from "@sequoia-leaf/factory";
import type { Action, Block, Row, Stat } from "@sequoia-leaf/kit/card.ts";

import type { Arms } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import type { ItemArt } from "../art/items.ts";
import type { Machines } from "../art/machines.ts";
import type { Sprite } from "../art/pal.ts";
import type { Lamp } from "../lamps.ts";
import type { Hands, MachinePrint, StandingPrint } from "../ui/cards.ts";

/** What a kind's picture is put together from: the machines' art, the things', a sorter's top, and the depot's picture for a slot. */
export interface Parts {
  readonly m: Machines;
  readonly item: ItemArt;
  readonly sorter: Art["sorter"];
  readonly depot: HTMLCanvasElement;
}

/** What the frame remembers of the piece on each tile, by tile (`scene.ts`): a mill's face, a bench's hammer down, when it last puffed. */
export interface Remembered {
  readonly face: Uint8Array;
  readonly struck: Uint8Array;
  readonly puffAt: Float32Array;
}

/**
 * What drawing a piece standing on a tile is given, filled afresh for each piece (`scene.ts`): the
 * tile and the way it faces, its grade and the look of it, its tunnel's span and a crate open; where
 * it is in the picture (`x`, `top`, `w`, `h`: its tile, or for a piece of more than one tile the box
 * of tiles it covers; `cx` its middle, `foot` its bottom, `z` how near it stands) and how faint (`a`); whether it is real or a piece not yet built (`ghost` above 0); whether power
 * reaches it and it is at work; its holder's row and what that holds ready, makes and has done of it;
 * the screen's clock and the yard's pace; how the yard's pixels sit in the view (`seenX`, `seenY`, for
 * what flies off it); the frame's memory of the tile; and how a picture is put into the frame.
 */
export interface Drawn {
  i: number;
  d: Dir;
  grade: number;
  look: number;
  span: number;
  open: boolean;
  x: number;
  top: number;
  w: number;
  h: number;
  foot: number;
  cx: number;
  z: number;
  a: number;
  real: boolean;
  ghost: number;
  powered: boolean;
  working: boolean;
  r: number;
  out: number;
  /** What it made beside what it finished (a by-product), waiting to leave by its own way out, or `NONE`. */
  also: number;
  making: number;
  work: number;
  t: number;
  pace: number;
  seenX: number;
  seenY: number;
  mem: Remembered;
  /** Puts a sprite into the frame with its anchor at (x, y), `z` near, `a` faint. */
  readonly stand: (s: Sprite, x: number, y: number, z: number, a?: number) => void;
  /** Puts a picture into the frame with its corner at (x, y). */
  readonly put: (c: HTMLCanvasElement, x: number, y: number, z: number, a?: number) => void;
}

/** What a kind's lamps are given (`lamps.ts`): the yard's pace and how bright its lamps burn, how far a pylon's light reaches, whether pylons stand tall, and whether a piece is at work and a mill firing. */
export interface LampsAt {
  readonly pace: number;
  readonly bright: number;
  readonly reach: number;
  readonly tall: boolean;
  readonly working: (i: number) => boolean;
  readonly kiln: (i: number) => boolean;
}

/** A standing piece's own parts of its card: rows, buttons, blocks over its numbers, and the sentence under its name. */
export interface Standing {
  readonly rows?: (p: StandingPrint) => Row[];
  readonly actions?: (art: Art, p: StandingPrint, hands: Hands) => Action[];
  /** Its buttons after Empty, before those every piece has (Raise, Rotate, ...): for the depot, in place of those. */
  readonly more?: (art: Art, p: StandingPrint, hands: Hands) => Action[];
  readonly blocks?: (p: StandingPrint) => Block[];
  /** What it says of itself under its name while nothing is wrong, where its rules' line would say what every belt says. */
  readonly said?: (p: StandingPrint) => string;
}

/**
 * What the dock says with a kind in hand is given (`dock.ts`): `finger` for taps, `from` once a first
 * tile is chosen, `away` once a tile other than that one is aimed at, and `turns` the words for
 * turning it.
 */
export interface Hold {
  readonly finger: boolean;
  readonly from: boolean;
  readonly away: boolean;
  readonly turns: string;
}

export interface KindPage {
  /** How it is pictured standing idle at a grade, for the dock and the cards: every kind has one. */
  readonly picture: (p: Parts, grade: number, carrying: Item) => HTMLCanvasElement;
  /**
   * Draws it standing on its tile, and says where its head is, for a mark of trouble over it; nothing
   * where it lies flat with the floor (a belt, a joiner, a sorter), which then wears no mark, and is
   * not drawn here at all without one.
   */
  readonly draw?: (art: Art, y: Yard, at: Drawn) => number | null;
  /** What the frame remembers of a new one at first (a mill's face, from what feeds it). */
  readonly fresh?: (y: Yard, i: number) => number;
  /** Whether it is at its fire just now, for its lamp (a mill firing), by what the frame remembers of it. */
  readonly fire?: (y: Yard, i: number, mem: Remembered) => boolean;
  /** Whether it wears the brass pointer on its way out; with `"holding"`, what it holds ready shows at it. */
  readonly pointer?: "bare" | "holding";
  /** Whether it shows where power does not reach in its own way (a gatherer asleep), and wears no bolt. */
  readonly sleeps?: true;
  /** What lies flat over its tile, facing a way, as it would stand in hand: for one that lies flat with its belt. */
  readonly top?: (art: Art, y: Yard | null, i: number, d: Dir, right: boolean) => HTMLCanvasElement | undefined;
  /** What an empty one shows over its tile, over everything that lies flat: a splitter's vane, pointing where its next thing goes. */
  readonly vane?: (art: Art, y: Yard, i: number, a: Arms) => HTMLCanvasElement | undefined;
  /** What it shows in hand where it would come up, for one that stands on two tiles (a tunnel's far hood). */
  readonly far?: (art: Art, grade: number, d: Dir) => Sprite | undefined;
  /** What lies flat over its tile in the yard, given its belt's arms (a splitter's arrowheads on its ways that lead somewhere); its `top` unless it says. */
  readonly laid?: (
    art: Art,
    y: Yard,
    i: number,
    d: Dir,
    a: Arms,
    lay: (pic: HTMLCanvasElement | undefined) => void,
  ) => void;
  /** Its belt's arms where it stands, for one that carries (`layout.ts`). */
  readonly arms?: (y: Yard, i: number) => Arms;
  /** Its belt's arms in hand, facing `d`, sending its thing right with `right`. */
  readonly aimArms?: (d: Dir, right: boolean) => Arms;
  /** The side of its tile a thing it holds ready leaves by, as the frame shows it hop off: ahead, unless it says (a sorter's side). */
  readonly sends?: (y: Yard, i: number, n: number) => Dir;
  /** The side of its tile a thing on it leaves by: ahead, unless it says (a splitter's next way, a sorter's side). */
  readonly rides?: (y: Yard, i: number, a: Arms, n: number) => Dir;
  /** Its lamps and fires where power reaches it, with its tile's middle `x` and its foot. */
  readonly lamps?: (y: Yard, i: number, x: number, foot: number, at: LampsAt, out: Lamp[]) => void;
  /** Its block on the map, lit and in shade; none for what is drawn another way (what carries, a pylon's lamp, the depot). */
  readonly map?: readonly [string, string];
  /** The mark at the middle of its tile on the map, for one that carries: brass where a line parts or meets, stone at a tunnel's mouth. */
  readonly mapMark?: string;
  /** Its lamp on the map, in place of a block: a pylon's, small, so that a row of them does not read as machines. */
  readonly mapLamp?: string;
  /** Whether it sends each thing by what it is (a sorter), so the map carries no line's colour on through it. */
  readonly sorts?: true;
  /** Whether the map marks it, as a cart stop and a Study are marked, and with which mark. */
  readonly spot?: "stop" | "study";
  /** Its dot in a blueprint's picture; a belt's pale wood unless it says. */
  readonly dot?: string;
  /** Its place in the dock, after the four a line is built with (`line`); none for one nobody builds (the depot). */
  readonly dock?: number;
  /** Whether it is one of what a line of belt is built with: the dock's first four, in this order. */
  readonly line?: number;
  /** Whether what it is handed is drawn going into it, as into a cart stop's cart. */
  readonly cart?: true;
  /** What its card says it does a minute at a grade's pace, flat out (`paceOf`). */
  readonly pace?: (k: Kind, grade: number) => Stat | null;
  /** Its card's own rows, as a kind: what it can make, gathers, burns. */
  readonly rows?: (p: MachinePrint) => Row[];
  /** What standing in the yard adds to its card. */
  readonly standing?: Standing;
  /** How many its card says it may hold (`Holds, of 8`), where it says. */
  readonly holdsUp?: (y: Yard) => number;
  /** Whether its card empties it whatever it is doing (a crate); else only while it is idle or full of a part. */
  readonly empties?: true;
  /** Whether it has a way to face that its card turns (it hands on, or takes in from one side). */
  readonly faces?: true;
  /** Whether its card flips it, to send to its other side. */
  readonly flips?: true;
  /** What the dock says with it in hand, where it says more than "click to place it" (a belt, a tunnel). */
  readonly says?: (h: Hold) => string;
}
