/**
 * The kit: everything of the rules a kind's hooks are given, and so everything a kind can read or do
 * to a yard (`kinds/kind.ts` says why a kind is handed it rather than importing it). It is made once,
 * with the plumbing, as `KIT` in `wire.ts`; this says what is in it. A kind that needs more of the
 * rules adds it here and there, where the rest of the rules can see it.
 */
import type * as Burning from "../burns.ts";
import type * as Land from "../land.ts";
import type * as Orders from "../orders.ts";
import type * as Planner from "../planner.ts";
import type * as Power from "../power.ts";
import type * as Smog from "../smog.ts";
import type * as Tables from "../tables.ts";
import type * as Tiles from "../tiles.ts";
import type * as Wire from "../wire.ts";
import type { Yard } from "../yard.ts";
import type * as Yards from "../yard.ts";

/** The rule by which a piece whose ways in take turns finds whose turn it is: the tile its way in `s` takes from. */
export type Slots = (k: Kit, y: Yard, to: number, s: number) => number;

export interface Kit {
  // The tables.
  readonly NONE: typeof Tables.NONE;
  readonly ITEM_COUNT: typeof Tables.ITEM_COUNT;
  readonly ALL_ITEMS: typeof Tables.ALL_ITEMS;
  readonly ITEM_INFO: typeof Tables.ITEM_INFO;
  readonly RECIPE: typeof Tables.RECIPE;
  readonly GOALS: typeof Tables.GOALS;
  readonly FOLIOS: typeof Tables.FOLIOS;
  readonly DEADFALL: typeof Tables.DEADFALL;
  readonly PACE: typeof Tables.PACE;
  readonly HALF: typeof Tables.HALF;
  readonly TOP: typeof Tables.TOP;
  readonly TINTS: typeof Tables.TINTS;
  readonly SPAN_MOST: typeof Tables.SPAN_MOST;
  readonly WORK_OF: typeof Tables.WORK_OF;
  readonly FIXED: typeof Tables.FIXED;
  readonly SINKS: typeof Tables.SINKS;
  readonly KIND_INFO: typeof Tables.KIND_INFO;
  readonly MIX_OF: typeof Tables.MIX_OF;
  readonly GROW_OF: typeof Tables.GROW_OF;
  readonly GATHERING: typeof Tables.GATHERING;
  readonly GATHER_WORK: typeof Planner.GATHER_WORK;
  readonly SMOG_OF: typeof Tables.SMOG_OF;
  readonly TINTED: typeof Tables.TINTED;
  readonly GRADED: typeof Tables.GRADED;
  readonly isItem: typeof Tables.isItem;
  readonly isKind: typeof Tables.isKind;
  readonly isRaw: typeof Tables.isRaw;
  readonly isFolio: typeof Tables.isFolio;
  readonly isMaker: typeof Tables.isMaker;
  readonly drawnAt: typeof Tables.drawnAt;
  readonly holdsMost: typeof Tables.holdsMost;
  readonly timesOf: typeof Tables.timesOf;
  readonly makesThing: typeof Tables.makesThing;
  readonly TIMES_MOST: typeof Tables.TIMES_MOST;
  readonly BUFFER: number;
  readonly locked: typeof Tables.locked;
  readonly recipesFor: typeof Tables.recipesFor;
  readonly makes: typeof Planner.makes;
  readonly mixPerMinute: typeof Planner.mixPerMinute;
  readonly mixShare: typeof Planner.mixShare;
  readonly gathers: typeof Planner.gathers;
  readonly growPerMinute: typeof Planner.growPerMinute;
  readonly grownPerRun: typeof Planner.grownPerRun;
  readonly MINUTE: typeof Planner.MINUTE;
  readonly carried: typeof Planner.carried;
  readonly BURNS: typeof Burning.BURNS;
  readonly whole: (v: unknown, most: number) => number | null;

  // The yard's reads and writes.
  readonly holderOf: typeof Yards.holderOf;
  readonly tunnelOf: typeof Yards.tunnelOf;
  readonly put: typeof Yards.put;
  readonly take: typeof Yards.take;
  readonly held: typeof Yards.held;
  readonly enough: typeof Yards.enough;
  readonly counts: typeof Yards.counts;
  readonly changed: typeof Yards.changed;
  readonly place: typeof Yards.place;
  readonly tunnelRow: typeof Yards.tunnelRow;
  readonly insTo: typeof Yards.insTo;
  readonly unpackWays: typeof Tiles.unpackWays;
  /** Adds smog to the plot of the tile `i`, as a piece there finishes a thing (`smog.ts`). */
  readonly smogged: typeof Smog.smogged;
  /** The share of ticks the piece on a tile works at, as the smog on its plot lets it. */
  readonly smogPace: typeof Smog.smogPace;
  /** How many of a thing the piece on a tile may hold, as its kind says (`Hooks.most`). */
  readonly mostHeld: (y: Yard, i: number, n: number) => number;

  // The tiles about a piece.
  readonly DX: typeof Tiles.DX;
  readonly DY: typeof Tiles.DY;
  readonly WAY_TURN: typeof Tiles.WAY_TURN;
  readonly at: typeof Tiles.at;
  readonly kindAt: typeof Tiles.kindAt;
  readonly ground: typeof Tiles.ground;
  readonly ahead: typeof Tiles.ahead;
  readonly behind: typeof Tiles.behind;
  readonly wayIn: typeof Tiles.wayIn;
  readonly farMouth: typeof Tiles.farMouth;
  readonly otherMouth: typeof Tiles.otherMouth;
  readonly toward: typeof Land.toward;
  readonly besideWater: typeof Land.besideWater;

  // Who hands to whom, and the one rule of handing a thing on.
  readonly nextOf: typeof Wire.nextOf;
  readonly carries: typeof Wire.carries;
  readonly closedOf: typeof Wire.closedWays;
  readonly wayOut: typeof Wire.wayOut;
  readonly waysOf: typeof Wire.waysOf;
  readonly sendsOf: typeof Wire.sendsOf;
  readonly takes: typeof Wire.takes;
  readonly wants: typeof Wire.wants;
  readonly ready: typeof Wire.ready;
  readonly takesTurns: typeof Wire.takesTurns;
  /** Whether it is the turn of the way in `slot` of a piece whose `ways` ways in take turns, the next being `turn` (`wire.ts`). */
  readonly onTurn: (k: Kit, y: Yard, to: number, slot: number, ways: number, turn: number, from: Slots) => boolean;
  readonly passTo: typeof Wire.passTo;
  readonly passWay: typeof Wire.passWay;
  readonly sendOut: typeof Wire.sendOut;
  readonly sendPort: typeof Wire.sendPort;
  readonly portTo: typeof Wire.portTo;
  readonly outsOf: typeof Wire.outsOf;
  readonly sendsThing: typeof Wire.sendsThing;
  readonly takesAt: typeof Wire.takesAt;
  readonly refused: typeof Wire.refused;
  readonly roomBeside: typeof Wire.roomBeside;
  readonly wireOf: typeof Wire.wireOf;
  readonly ringHalted: typeof Wire.ringHalted;

  // What reaches the depot and the research; power.
  readonly deliver: typeof Orders.deliver;
  readonly giveGoal: typeof Orders.giveGoal;
  readonly litOf: typeof Power.litOf;
  readonly litAt: typeof Power.litAt;
  /** The share of ticks the yard's machines work at, as its power lets them (`power`). */
  readonly pace: (y: Yard) => number;
}
