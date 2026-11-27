/**
 * Everything a player can do at the table (`RaidCommand`), and reading one off the wire
 * (`readCommand`). A table keeps two runs, each picked up and put down on its own: the run in hand
 * (the main way or the member's own figures) and the endless run. A command that acts on a run acts
 * on the run in hand, or with `endless: true` on the endless run; every other field is the same.
 */
import { type EndlessWay, isEndlessWay } from "./content/endless.ts";
import { isLookKind, type LookKind } from "./content/looks.ts";
import { TRAIL_COUNT } from "./content/rooms.ts";
import { isRecord, isWhole } from "./party.ts";
import type { Spot } from "./run.ts";

/** What can be done to a run. */
export type RunCommand =
  /** Take one of the options of the pick waiting. */
  | { do: "choose"; option: number }
  /** Ask for three other boons. */
  | { do: "redraw" }
  | { do: "buy"; offer: number }
  | { do: "sell"; from: Spot }
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

/** A command for a run: the run in hand, or with `endless` the endless run. */
export type Aimed<C extends RunCommand = RunCommand> = C extends unknown ? C & { endless?: true } : never;

/**
 * Whose each command of a run is at a live table, where one clock keeps the moment for every seat:
 * the member plans their room with it (`plan`), or the clock does it for every seat at once
 * (`clock`: sending the party in, taking what the fight paid, walking home). Setting out is the
 * clock's too, but it is the table's command, not a run's. A command of a run missing here, or
 * named twice, does not compile; one marked `plan` is planned at every table, Leaf's and the page's.
 */
export const WHOSE = {
  choose: "plan",
  redraw: "plan",
  buy: "plan",
  sell: "plan",
  move: "plan",
  bench: "plan",
  rustle: "plan",
  hold: "plan",
  xp: "plan",
  give: "plan",
  forge: "plan",
  fight: "clock",
  take: "clock",
  abandon: "clock",
} as const satisfies Record<RunCommand["do"], "plan" | "clock">;
type Planning = { [D in keyof typeof WHOSE]: (typeof WHOSE)[D] extends "plan" ? D : never }[keyof typeof WHOSE];
/** A command a member plans a room with, at any table. */
export type PlanningCommand = Extract<RunCommand, { do: Planning }>;
export const isPlanning = <C extends { do: string }>(c: C): c is Extract<C, { do: Planning }> =>
  Object.entries(WHOSE).some(([name, whose]) => whose === "plan" && name === c.do);

/** Everything a player can do at the table. */
export type RaidCommand =
  /**
   * Set out on a trail: with all figures, or (`own`) with those the member has pulled. A run in hand
   * is put down first, as walking home, once it has fought a room. The endless run is not touched.
   */
  | { do: "start"; trail: number; own?: boolean }
  /**
   * Set out on an endless run, one way or the other. An endless run in hand is put down first, as
   * walking home, once it has fought a room. The run in hand is not touched.
   */
  | { do: "endless"; way: EndlessWay }
  /** Pick the trail to set out on next, on the front page. */
  | { do: "trail"; trail: number }
  /** Put a look on the table. (A command's `id` on the wire is its own, so the look is `look`.) */
  | { do: "look"; kind: LookKind; look: string }
  /** Buy a look with Leaf, and put it on the table. */
  | { do: "buyLook"; kind: LookKind; look: string }
  | Aimed;

export type RaidCommandName = RaidCommand["do"];

/** The commands that act on the table rather than on a run. */
const TABLE_COMMANDS = ["start", "endless", "trail", "look", "buyLook"] as const satisfies readonly RaidCommandName[];
/** Whether a command acts on a run. */
export const isRunCommand = (c: RaidCommand): c is Aimed => !TABLE_COMMANDS.some((name) => name === c.do);
/** Whether a command is for the endless run. */
export const forEndless = (c: RaidCommand): boolean => isRunCommand(c) && c.endless === true;

/** The planning commands a page may show before Leaf answers: they draw nothing, so Leaf will do just the same. */
const predicted = ["move", "bench", "sell", "give", "forge", "hold", "buy", "xp"] as const;
export const PREDICTED = predicted satisfies readonly Planning[];
/** A command a page may show before Leaf answers. */
export type Predicted = Extract<RunCommand, { do: (typeof PREDICTED)[number] }>;
export const isPredicted = <C extends { do: string }>(c: C): c is Extract<C, { do: (typeof PREDICTED)[number] }> =>
  PREDICTED.some((name) => name === c.do);

// ---------- off the wire ----------

/** A place as a command names it. Anything past the board and bench is turned down by the rules. */
function spotOf(v: unknown): Spot | null {
  if (!isRecord(v) || (v.on !== "board" && v.on !== "bench") || !isWhole(v.at, 0, 63)) return null;
  return { on: v.on, at: v.at };
}
const trailOf = (v: unknown): number | null => (isWhole(v, 0, TRAIL_COUNT - 1) ? v : null);
const lookOf = (v: Record<string, unknown>): { kind: LookKind; look: string } | null =>
  isLookKind(v.kind) && typeof v.look === "string" && v.look.length <= 32 ? { kind: v.kind, look: v.look } : null;
/** A command read as nothing but its name. */
const bare =
  <D extends RaidCommandName>(name: D) =>
  (): { do: D } => ({ do: name });

type Reader = (v: Record<string, unknown>) => RaidCommand | null;
/** How each command is read: its fields, each checked; null when one is not what it should be. */
const READERS = new Map<string, Reader>(
  Object.entries({
    start: (v) => {
      const trail = trailOf(v.trail);
      return trail === null ? null : v.own === true ? { do: "start", trail, own: true } : { do: "start", trail };
    },
    endless: (v) => (isEndlessWay(v.way) ? { do: "endless", way: v.way } : null),
    trail: (v) => {
      const trail = trailOf(v.trail);
      return trail === null ? null : { do: "trail", trail };
    },
    look: (v) => {
      const look = lookOf(v);
      return look && { do: "look", ...look };
    },
    buyLook: (v) => {
      const look = lookOf(v);
      return look && { do: "buyLook", ...look };
    },
    choose: (v) => (isWhole(v.option, 0, 15) ? { do: "choose", option: v.option } : null),
    buy: (v) => (isWhole(v.offer, 0, 15) ? { do: "buy", offer: v.offer } : null),
    sell: (v) => {
      const from = spotOf(v.from);
      return from && { do: "sell", from };
    },
    move: (v) => {
      const from = spotOf(v.from);
      const to = spotOf(v.to);
      return from && to && { do: "move", from, to };
    },
    bench: (v) => (isWhole(v.seat, 0, 63) ? { do: "bench", seat: v.seat } : null),
    hold: (v) => (typeof v.on === "boolean" ? { do: "hold", on: v.on } : null),
    give: (v) => {
      const to = spotOf(v.to);
      return to && isWhole(v.item, 0, 399) ? { do: "give", item: v.item, to } : null;
    },
    forge: (v) =>
      isWhole(v.item, 0, 399) && isWhole(v.with, 0, 399) ? { do: "forge", item: v.item, with: v.with } : null,
    redraw: bare("redraw"),
    rustle: bare("rustle"),
    xp: bare("xp"),
    fight: bare("fight"),
    take: bare("take"),
    abandon: bare("abandon"),
  } satisfies Record<RaidCommandName, Reader>),
);

/**
 * A command off the wire, or null. A command for a run is for the endless run with `endless: true`.
 * Fields it does not use (the command's id) are let be.
 */
export function readCommand(v: unknown): RaidCommand | null {
  if (!isRecord(v)) return null;
  const c = READERS.get(String(v.do))?.(v) ?? null;
  return c !== null && v.endless === true && isRunCommand(c) ? { ...c, endless: true } : c;
}
