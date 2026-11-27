/**
 * Everything a player can do at the table (`RaidCommand`). Each command of a run is said once, in
 * `COMMANDS`: how it is read off the wire, whose it is at a live table, whether the page may do it at
 * once, and what it does to the run. Leaf's table, a seat at a live table, the page's predictions
 * and the bot all do a command by its spec, so no table can be missing one.
 *
 * A table keeps two runs, each in a slot of its own (`Slot`, read from how the run set out:
 * `way.ts`): the main run (a trail) and the endless run. On the wire a command for a run says its slot
 * (`slot: "endless"`); one that says none is for the main run, and `endless: true` is still read as
 * the endless slot. A seat at a live table has one run, the caller's, and reads no slot. The table's
 * own commands are `game.ts`'s; a sitting's, `sitting/commands.ts`'s.
 */
import type { Met } from "@sequoia-leaf/core";

import type { EndlessWay } from "./content/endless.ts";
import type { LookKind } from "./content/looks.ts";
import { feed } from "./feed.ts";
import { isRecord, isWhole } from "./party.ts";
import { forgeItems } from "./rack.ts";
import {
  abandon,
  beginFight,
  buy,
  buyXp,
  choose,
  type Done,
  giveItem,
  hold,
  move,
  redraw,
  type Run,
  type RunView,
  rustle,
  sell,
  type Spot,
  takeTakings,
  toBench,
} from "./run.ts";
import type { Slot } from "./way.ts";

export type { Slot } from "./way.ts";

/** What can be done to a run. */
export type RunCommand =
  /** Take one of the options of the pick waiting. */
  | { do: "choose"; option: number }
  /** Ask for three other boons. */
  | { do: "redraw" }
  | { do: "buy"; offer: number }
  | { do: "sell"; from: Spot }
  /** Give Greg (at `to`, on the board or the bench) the figure on the bench at `from` to eat (`feed.ts`). */
  | { do: "feed"; from: Spot; to: Spot }
  /** Move a figure, changing places with whoever is there. */
  | { do: "move"; from: Spot; to: Spot }
  /** Take a figure off the board to the first free hollow of the bench. */
  | { do: "bench"; seat: number }
  | { do: "rustle" }
  /** Keep the stall as it is for the next room, or let it go. */
  | { do: "hold"; on: boolean }
  /** Buy experience. */
  | { do: "xp" }
  /** Hand the item at a place on the rack to a figure. */
  | { do: "give"; item: number; to: Spot }
  /** Make the finished item of two components on the rack, in the first one's place. */
  | { do: "forge"; item: number; with: number }
  /** Send the party in: the boards are locked and the fight is decided. */
  | { do: "fight" }
  /** Take what the fight paid, and go on to the next room or to the end. */
  | { do: "take" }
  /** Walk home early, once a room has been fought. */
  | { do: "abandon" };
type RunDo = RunCommand["do"];
type CommandOf<D extends RunDo> = Extract<RunCommand, { do: D }>;

/** What a run's command is told besides itself: another member's board that a `take` meets (`Ctx.met`). */
export interface RunCtx {
  readonly met?: Met | undefined;
}

/**
 * One command of a run, said once. `whose`: at a live table, where one clock keeps the moment for
 * every seat, the member plans their room with it (`plan`), or the clock does it for every seat at
 * once (`clock`). `draws`: false for one the page does at once and sends, worked out on its copy
 * exactly as Leaf will, which a run without its streams can do and only a planning command may be;
 * true for one only Leaf can answer.
 */
export type Spec<C extends RunCommand> = {
  /** Its fields off the wire, each checked; null when one is not what it should be. Fields it does not use are let be. */
  readonly read: (v: Record<string, unknown>) => C | null;
} & (
  | { readonly whose: "plan"; readonly draws: false; readonly run: (run: RunView, c: C) => Done }
  | { readonly whose: "plan" | "clock"; readonly draws: true; readonly run: (run: Run, c: C, ctx: RunCtx) => Done }
);

/** A place as a command names it. Anything past the board and bench is turned down by the rules. */
function spotOf(v: unknown): Spot | null {
  if (!isRecord(v) || (v.on !== "board" && v.on !== "bench") || !isWhole(v.at, 0, 63)) return null;
  return { on: v.on, at: v.at };
}
/** A place on the rack as a command names it. */
const rackOf = (v: unknown): number | null => (isWhole(v, 0, 399) ? v : null);

/** Every command of a run. One missing, or with a field missing, does not compile. */
export const COMMANDS = {
  choose: {
    read: (v) => (isWhole(v.option, 0, 15) ? { do: "choose", option: v.option } : null),
    whose: "plan",
    draws: true,
    run: (run, c) => choose(run, c.option),
  },
  redraw: { read: () => ({ do: "redraw" }), whose: "plan", draws: true, run: (run) => redraw(run) },
  buy: {
    read: (v) => (isWhole(v.offer, 0, 15) ? { do: "buy", offer: v.offer } : null),
    whose: "plan",
    draws: false,
    run: (run, c) => buy(run, c.offer),
  },
  sell: {
    read: (v) => {
      const from = spotOf(v.from);
      return from && { do: "sell", from };
    },
    whose: "plan",
    draws: false,
    run: (run, c) => sell(run, c.from),
  },
  feed: {
    read: (v) => {
      const from = spotOf(v.from);
      const to = spotOf(v.to);
      return from && to && { do: "feed", from, to };
    },
    whose: "plan",
    draws: false,
    run: (run, c) => feed(run, c.from, c.to),
  },
  move: {
    read: (v) => {
      const from = spotOf(v.from);
      const to = spotOf(v.to);
      return from && to && { do: "move", from, to };
    },
    whose: "plan",
    draws: false,
    run: (run, c) => move(run, c.from, c.to),
  },
  bench: {
    read: (v) => (isWhole(v.seat, 0, 63) ? { do: "bench", seat: v.seat } : null),
    whose: "plan",
    draws: false,
    run: (run, c) => toBench(run, c.seat),
  },
  rustle: { read: () => ({ do: "rustle" }), whose: "plan", draws: true, run: (run) => rustle(run) },
  hold: {
    read: (v) => (typeof v.on === "boolean" ? { do: "hold", on: v.on } : null),
    whose: "plan",
    draws: false,
    run: (run, c) => hold(run, c.on),
  },
  xp: { read: () => ({ do: "xp" }), whose: "plan", draws: false, run: (run) => buyXp(run) },
  give: {
    read: (v) => {
      const item = rackOf(v.item);
      const to = spotOf(v.to);
      return to && item !== null ? { do: "give", item, to } : null;
    },
    whose: "plan",
    draws: false,
    run: (run, c) => giveItem(run, c.item, c.to),
  },
  forge: {
    read: (v) => {
      const item = rackOf(v.item);
      const other = rackOf(v.with);
      return item !== null && other !== null ? { do: "forge", item, with: other } : null;
    },
    whose: "plan",
    draws: false,
    run: (run, c) => forgeItems(run, c.item, c.with),
  },
  fight: { read: () => ({ do: "fight" }), whose: "clock", draws: true, run: (run) => beginFight(run) },
  take: { read: () => ({ do: "take" }), whose: "clock", draws: true, run: (run, _, ctx) => takeTakings(run, ctx.met) },
  abandon: { read: () => ({ do: "abandon" }), whose: "clock", draws: true, run: (run) => abandon(run) },
} as const satisfies { readonly [D in RunDo]: Spec<CommandOf<D>> };

/** The same specs, each typed by its command's name, for doing a command by its own. */
const SPECS: { readonly [D in RunDo]: Spec<CommandOf<D>> } = COMMANDS;
const specOf = <D extends RunDo>(name: D): Spec<CommandOf<D>> => SPECS[name];
const isRunDo = (name: unknown): name is RunDo => typeof name === "string" && Object.hasOwn(SPECS, name);
const specNamed = (name: unknown): Spec<RunCommand> | null => (isRunDo(name) ? specOf(name) : null);

type Specs = typeof COMMANDS;
type Planning = { [D in RunDo]: Specs[D]["whose"] extends "plan" ? D : never }[RunDo];
type DrawsNothing = { [D in RunDo]: Specs[D]["draws"] extends false ? D : never }[RunDo];
/** A command a member plans a room with, at any table. */
export type PlanningCommand = CommandOf<Planning>;
/** A command a page may show before Leaf answers: it draws nothing, so Leaf will do just the same. */
export type Predicted = CommandOf<DrawsNothing>;

/** Whether a command is one a member plans with (its spec's `whose`). */
export const isPlanning = <C extends { do: string }>(c: C): c is Extract<C, { do: Planning }> =>
  specNamed(c.do)?.whose === "plan";
/** Whether a command is one a page may show before Leaf answers (its spec's `draws`). */
export const isPredicted = <C extends { do: string }>(c: C): c is Extract<C, { do: DrawsNothing }> =>
  specNamed(c.do)?.draws === false;

/** A command for a run, aimed at a slot of the table: none is the main run. */
export type Aimed<C extends RunCommand = RunCommand> = C extends unknown ? C & { slot?: Slot } : never;
/** The slot a command for a run is aimed at. */
export const aimedAt = (c: Aimed): Slot => c.slot ?? "main";

/** The table's own commands, which act on the table rather than on a run (`game.ts` does them). */
export type TableCommand =
  /**
   * Set out on a trail: with all figures, or (`own`) with those the member has pulled. The main run,
   * if one has fought a room, is put down first, as walking home. The endless run is not touched.
   */
  | { do: "start"; trail: number; own?: boolean }
  /**
   * Set out on an endless run, one way or the other, with all figures, or (`own`, where its course
   * offers it) with those the member has pulled. The endless run, if one has fought a room, is put
   * down first, as walking home. The main run is not touched.
   */
  | { do: "start"; course: EndlessWay; own?: boolean }
  /** Pick the trail to set out on next, on the front page. */
  | { do: "trail"; trail: number }
  /** Put a look on the table. (A command's `id` on the wire is its own, so the look is `look`.) */
  | { do: "look"; kind: LookKind; look: string }
  /** Buy a look with Leaf, and put it on the table. */
  | { do: "buyLook"; kind: LookKind; look: string };

/** Everything a player can do at the table. */
export type RaidCommand = TableCommand | Aimed;
export type RaidCommandName = RaidCommand["do"];

/** Whether a command acts on a run. */
export const isRunCommand = (c: RaidCommand): c is Aimed => isRunDo(c.do);

// ---------- doing one ----------

/**
 * What a command that draws nothing does to a run, Leaf's or the page's copy without its streams;
 * null for one that draws, which only Leaf can do (`act`).
 */
export function plan(run: RunView, c: RunCommand): Done | null {
  const spec = specOf(c.do);
  return spec.draws ? null : spec.run(run, c);
}

/** A command done to a run, by its spec. */
export function act(run: Run, c: RunCommand, ctx: RunCtx = {}): Done {
  const spec = specOf(c.do);
  return spec.draws ? spec.run(run, c, ctx) : spec.run(run, c);
}

/**
 * Whether a command that draws nothing would be done to a run as it stands: the rules asked, on a
 * copy, so that a page lights only what Leaf would do and never works the rules out again.
 */
export const legal = (run: RunView, c: Predicted): boolean => plan(structuredClone(run), c)?.ok === true;

// ---------- off the wire ----------

/** A command of a run off the wire, as a seat reads one: no slot. Null for anything else. */
export const readRunCommand = (v: Record<string, unknown>): RunCommand | null => specNamed(v.do)?.read(v) ?? null;

/** The slot a command off the wire says, or null for one that is not a slot. */
function slotSaid(v: Record<string, unknown>): Slot | null {
  if (v.slot === undefined) return v.endless === true ? "endless" : "main";
  return v.slot === "main" || v.slot === "endless" ? v.slot : null;
}

/** A command for a run of a table off the wire, aimed at the slot it says; null for anything else. */
export function readAimed(v: Record<string, unknown>): Aimed | null {
  const c = readRunCommand(v);
  const slot = slotSaid(v);
  if (c === null || slot === null) return null;
  return slot === "main" ? c : { ...c, slot };
}
