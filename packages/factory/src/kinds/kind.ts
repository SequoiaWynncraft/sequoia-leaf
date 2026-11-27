/**
 * What a kind of piece is, written in one module of its own (`kinds/<kind>.ts`): what it is called
 * and costs, the power it draws and gives, what the rest of the rules read of it as plain data (it
 * holds things, it carries them across its tile, it keeps a line's colour, ...), and how it plays
 * (`rules`): which sides it takes things in from and where it hands them, what it wants and has room
 * for, its step in the tick, its checks where it is set down, how it stands and the words for that,
 * what it does a minute, and what it keeps.
 *
 * Nothing in this folder imports the rules at run time, only their types: the tables number the
 * kinds from their modules (`list.ts`), so a kind that imported the tables would be a loop. What a
 * kind plays with is handed to each of its hooks first instead, the kit (`Kit`, made with the
 * plumbing in `wire.ts`): the tables, the yard's reads and writes, the tiles about a piece, and the
 * one rule by which a piece hands a thing to another. The ways of playing kinds share (a carrier like
 * a belt, a holder, a maker of recipes, a sink) are modules here that kinds import and use; none
 * inherits from another.
 */
import type { Lay } from "../build.ts";
import type { KeptPiece } from "../cells.ts";
import type { Kept, Piece } from "../pieces.ts";
import type { Goal, Item, Open, Recipe } from "../tables.ts";
import type { Counts, Wire, Yard } from "../yard.ts";
import type { Kit } from "./kit.ts";

/** What a screen calls a kind, what one costs, the power it draws where power reaches it and the power it gives, and what it is for. */
export interface KindInfo {
  readonly name: string;
  /** Coins to build one; all of it comes back when it is taken away. */
  readonly cost: number;
  readonly draw: number;
  readonly gives: number;
  readonly what: string;
}

/** The words for how a piece stands (`status`): its sentence, and what the sentence names. */
export interface Words {
  readonly line: string;
  /** For a machine full of one part while it waits for another: the part to tip out. */
  readonly spare?: Item;
  /** What it waits for. */
  readonly missing?: readonly Item[];
  /** What it holds with nowhere to send it. */
  readonly stuck?: Item;
}

/** The commands that set something on a piece, by what each sets: each kind takes those it has (`Hooks.set`). */
export interface Setters {
  /** The one thing a machine makes, or none (`recipe`). Says why not, or nothing. */
  readonly recipe?: (k: Kit, y: Yard, i: number, out: Item | null) => string | null;
  /** The one thing a sorter sends to its side, or none (`sort`). */
  readonly sort?: (k: Kit, y: Yard, i: number, n: Item | null) => void;
  /** The side a sorter sends it: its right, or its left (`side`). */
  readonly side?: (k: Kit, y: Yard, i: number, right: boolean) => void;
  /** A crate let out, or shut (`crate`). */
  readonly open?: (k: Kit, y: Yard, i: number, open: boolean) => void;
  /** One of a splitter's ways out shut or opened (`way`). */
  readonly way?: (k: Kit, y: Yard, i: number, way: number, open: boolean) => void;
  /** One of a splitter's ways put first, or none (`first`). Says why not, or nothing. */
  readonly first?: (k: Kit, y: Yard, i: number, way: number | null) => string | null;
  /** One of a splitter's ways turned to take things in, or back (`wayIn`). */
  readonly in?: (k: Kit, y: Yard, i: number, way: number, on: boolean) => void;
}

/** A record of what a piece keeps, as read from anywhere: each part as yet unchecked. */
export type Unchecked = { readonly [K in keyof Kept]?: unknown };

/**
 * How a kind plays, as its module writes it: what it leaves out it does not do, as `rulesOf` (in
 * `wire.ts`) says for each. Each hook is given the kit first, then the yard and the tile.
 */
export interface Hooks {
  /** The sides it takes things in from, a bit for each way (east 1, south 2, west 4, north 8), whatever it holds just now. */
  readonly sides?: (k: Kit, y: Yard, i: number) => number;
  /** The one tile it hands to, or -1: none for a piece with ways (`KindDef.ways`), which hands by them. */
  readonly next?: (k: Kit, y: Yard, i: number) => number;
  /** Its ways out (1 ahead, 2 left, 4 right) that send nothing: for a piece with ways. */
  readonly closed?: (k: Kit, y: Yard, i: number) => number;
  /** The ways out (a bit each, as `closed`) a thing `n` may go by: for a piece with ways, all unless it says. */
  readonly sends?: (k: Kit, y: Yard, i: number, n: number) => number;
  /** Whether it takes the thing `n` at all, full or not. */
  readonly wants?: (k: Kit, y: Yard, i: number, n: number) => boolean;
  /** Whether it has room now for the thing `n`, handed it from its side `side`. */
  readonly room?: (k: Kit, y: Yard, i: number, n: number, side: number, wire: Wire) => boolean;
  /** Takes the thing `n` in from its side `side`, `over` eighths past the edge of the tile it came from. */
  readonly give?: (k: Kit, y: Yard, i: number, n: number, side: number, over: number, wire: Wire) => void;
  /** Whether it lets things in by turns: a thing it refuses does not wait (`tick.ts`). */
  readonly turns?: (k: Kit, y: Yard, i: number) => boolean;
  /** Its step in handing on, once a tick unless it waits: a piece without one hands nothing on. */
  readonly hands?: (k: Kit, y: Yard, i: number, wire: Wire) => void;
  /** Whether it has something finished that it means to hand to the tile at `to`. */
  readonly ready?: (k: Kit, y: Yard, i: number, to: number) => boolean;
  /**
   * Its work in a tick it works, at `speed` half-ticks, in its holder's row `r`: a piece with one
   * draws its power and works where power reaches it.
   */
  readonly work?: (k: Kit, y: Yard, i: number, r: number, speed: number, wire: Wire) => void;
  /** Power it gives every tick where power reaches it, in halves: counted when the plumbing is worked out. */
  readonly steady?: (k: Kit, y: Yard, i: number) => number;

  /** Why it cannot be set down on the tile `i` facing `d`, beyond the ground, its lock, its limit and the price; or nothing. */
  readonly refusal?: (k: Kit, y: Yard, i: number, d: number, lay: Lay) => string | null;
  /** Why it cannot be laid over a piece of its kind standing there, to turn it and raise or lower it; or nothing. */
  readonly over?: (k: Kit, y: Yard, i: number, d: number, grade: number, lay: Lay) => string | null;
  /** The other tiles it stands on, set down with it once it is set down on the tile `i` (a tunnel's far mouth). */
  readonly lays?: (k: Kit, y: Yard, i: number, d: number, grade: number, lay: Lay) => readonly number[];
  /** Sets what it is set down with beyond its kind, tile, way and grade, on the tile `i`: a sorter's side. */
  readonly laid?: (k: Kit, y: Yard, i: number, lay: Lay) => void;
  /** How a piece of it kept in a blueprint or a copy is set down (`stand`): as it is asked for, unless it says. */
  readonly asLaid?: (k: Kit, p: Piece) => Lay;
  /** What it takes being set: each command that sets something on a piece, by what it sets. */
  readonly set?: Setters;

  /** How it stands (`condition`): its state's place in `STATES`, with `TROUBLE` added while in trouble. `lit` is whether power reaches it. */
  readonly condition?: (k: Kit, y: Yard, i: number, lit: boolean) => number;
  /** The words for how it stands, its state given (`status`). */
  readonly words?: (k: Kit, y: Yard, i: number, state: string) => Words;
  /** The recipe it is working toward, for a machine (`aim`). */
  readonly aim?: (k: Kit, y: Yard, i: number) => Recipe | null;
  /** The recipe it last began, while it stands (`lastRecipe`). */
  readonly last?: (k: Kit, y: Yard, i: number) => Recipe | null;
  /** What it adds a minute to what the yard makes and needs, working each tick power lets it (`flow`). */
  readonly flow?: (k: Kit, y: Yard, i: number, made: Counts, needed: Counts) => void;

  /** How many of the thing `n` it may hold, as a kept one is put back (`cells.ts`). */
  readonly most?: (k: Kit, y: Yard, i: number, n: number) => number;
  /** Puts back what a kept piece of its kind held and was doing, on its holder's row `r` (-1 for none), as the rules let it be now. */
  readonly onto?: (k: Kit, y: Yard, i: number, r: number, o: KeptPiece, studied: Goal | undefined) => void;
  /** What a piece of it keeps in a blueprint or a copy, from a record of what one keeps: only what it may keep (`keptOf`). */
  readonly keeps?: (k: Kit, kind: number, v: Unchecked) => Kept;
  /** Sets the ways a kept piece of it keeps on the tile it stands on, as far as the yard may have them (`waysTo`). */
  readonly waysTo?: (k: Kit, y: Yard, i: number, kept: Kept) => void;
  /** Why a yard may not have a piece of it kept so, beyond its kind and grade and its colour (`pieceRefusal`). */
  readonly locks?: (k: Kit, open: Open, p: Piece) => string | null;
}

/** A kind of piece, as its module says it: see the head of this file. */
export interface KindDef<N extends string = string> {
  /** Its name on the wire and in a save. */
  readonly name: N;
  readonly info: KindInfo;
  /** Whether it has a grade, 1 to 3, kept on the piece. */
  readonly graded?: true;
  /**
   * How many a new yard has to hand: pieces left behind the workshop, enough for a first line.
   * Standing one costs nothing and taking it away gives nothing back, but it can be stood again
   * elsewhere, so a yard can always be started, and started over, from an empty purse.
   */
  readonly starters?: number;
  /** Whether it holds things, and so has a row in `holders`. */
  readonly holds?: true;
  /** Whether a holder of it may be shut, so that it lets nothing out (a crate's `open`). */
  readonly shuts?: true;
  /** Whether it carries a thing across its tile (`item`, `prog`, `via`), moved along by the tick at its grade's pace. */
  readonly carries?: true;
  /** Whether it has a line's colour: with its whole line (`"line"`, a belt or a tunnel mouth), or by itself (`"alone"`). */
  readonly tint?: "line" | "alone";
  /** How many ways out it has, ahead, left and right, for one that hands by ways; else it hands to one tile, `next`. */
  readonly ways?: 3;
  /** Whether it is the depot: land, never built, turned, moved, taken up or kept. */
  readonly fixed?: true;
  /** Whether it cannot be turned once it stands. */
  readonly fast?: true;
  /** Whether it runs under tiles: a tunnel, whose `span` is how many. */
  readonly spans?: true;
  /** For one that runs under tiles, what each tile it runs under past `past` adds to its cost, at grade 1. */
  readonly deeper?: { readonly past: number; readonly each: number };
  /** Whether power's reach goes out from it: a pylon. Standing or taken up, it moves where power reaches. */
  readonly reaches?: true;
  /** Whether it gathers what lies under it: what makes the things from the ground. */
  readonly gathers?: true;
  /** Whether it works for the research first in the line: its work is dropped when another comes first. */
  readonly studies?: true;
  /**
   * Whether it burns for power, where power reaches it: a piece of `fuel` (a thing, by name) at a
   * time, for `ticks` ticks, giving its power (`info.gives`) while it burns, and holding up to `holds`
   * pieces. The tick burns it (`tick.ts`'s `power`) from this alone, with no step of the kind's:
   * with a step a piece for every burner every tick cost the tick more than all the burning.
   */
  readonly burns?: { readonly fuel: string; readonly ticks: number; readonly holds: number };
  /** Half-ticks of work in each thing it finishes, for one whose work is not a recipe's (a gatherer, a Study). */
  readonly work?: number;
  /** The kinds it may be set down in the place of (a splitter on a belt), by name: not its own. */
  readonly over?: readonly string[];
  /** Whether version 6 of the codec kept it with no grade. */
  readonly regraded?: true;
  /** The numbers a goal raises that come with it, said as part of it when unlocked with it (`unlocks.ts`). */
  readonly owns?: readonly string[];
  /** What it does a minute, in a sentence of what a higher grade does more (`gradeSays`): the verb, and what it does it to. */
  readonly does?: readonly [verb: string, things: string];
  /** Whether its price is said as a tile's: a belt, laid a run at a time. */
  readonly perTile?: true;
  /** The number of what is open that says how many of it may stand: none for no limit. */
  readonly most?: "stops";
  /**
   * Tiles across and down, as it faces east; one tile if not said. A piece of more than one stands on
   * the tile it is set down on as the middle of its tiles, or for an even side the middle's top left,
   * whichever way it faces (`sizes.ts`).
   */
  readonly size?: readonly [across: number, down: number];
  /**
   * Where a piece of more than one tile takes things in and where each of its outputs leaves. A piece
   * of one tile says so by its hooks (`sides`, `next`), which may read the ways in its kind declares
   * here (`Kit.takesAt`): a tunnel's way-in mouth.
   */
  readonly ports?: Ports;
  /** How it plays. */
  readonly rules: Hooks;
}

/**
 * Where a piece of more than one tile takes things in and sends them out, as it faces east (its front
 * the east side), turned with it as it stands (`sizes.ts`; `ports.ts` writes the usual ones).
 */
export interface Ports {
  /**
   * The tile-sides it takes things in by: each a tile, across and down from its box's corner, and a
   * side of it, 0 its front, 1 its right, 2 its back and 3 its left; and, for one that takes things in
   * only once the yard has an unlock, that unlock (`Opened`).
   */
  readonly in: readonly (readonly [x: number, y: number, side: number, opened?: Opened])[];
  /**
   * Its outputs, each from a tile of its front to the tile ahead of it: the tile, across and down
   * from its box's corner, and what leaves there, the thing it finished (`"out"`) or what is made
   * beside it (`"also"`, a recipe's by-product).
   */
  readonly out: readonly { readonly at: readonly [x: number, y: number]; readonly sends: "out" | "also" }[];
}

/** An unlock that is one thing or none (`Open`), that a port may wait for. */
export type Opened = { readonly [K in keyof Open]: Open[K] extends boolean ? K : never }[keyof Open];

/** A kind's module says what it is with this: the name kept as written, for the tables to read. */
export const kind = <const N extends string>(def: KindDef<N>): KindDef<N> => def;
