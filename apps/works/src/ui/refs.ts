/**
 * The names cards go by. A card is named by a reference, by its number in the rules' tables:
 *
 * - `item:<item>` a thing;
 * - `machine:<kind>` a kind of piece, and `machine:<kind>.<grade>` that kind at a grade above the
 *   first ("Belt II");
 * - `tile:<index>` whatever stands on a tile of the yard;
 * - `plot:<plot>` a plot of land;
 * - `node:<goal>` a goal: a lesson, a project, a commission or a piece of research; `order:story` is
 *   the node in hand, and `order:<id>` a side order, by the id it keeps wherever it hangs on the
 *   board (the rules' `orderAt`);
 * - `tool:<tool>` a tool a goal unlocks;
 * - `perk:<what>.<number>` a number a goal raises, as it will be (`perk:blueprints.<count>.<pieces>`,
 *   `perk:board`);
 * - `tier:<n>` a tier, and `gift:<goal>` what a finished goal leaves in town.
 *
 * What each prints is in `prints.ts`, and how each is drawn in `cards.ts`.
 */
import {
  ALL_ITEMS,
  type Goal,
  GOALS,
  type Item,
  type Kind,
  type Plot,
  type Tool,
  type Unlock,
  unlockedBy,
} from "@sequoia-leaf/factory";

export const itemRef = (k: Item): string => `item:${k}`;
/** A kind of piece; with a grade above the first, that kind at that grade. */
/** A kind, at a grade, and for a tunnel the tiles it passes under, which its price goes by: `machine:<kind>.<grade>.<span>`. */
export const machineRef = (k: Kind, grade = 1, span = 0): string =>
  span > 0 ? `machine:${k}.${grade}.${span}` : grade > 1 ? `machine:${k}.${grade}` : `machine:${k}`;
export const tileRef = (i: number): string => `tile:${i}`;
export const plotRef = (id: Plot): string => `plot:${id}`;
/** A goal: a lesson, a project, a commission or a piece of research. */
export const nodeRef = (g: Goal): string => `node:${g}`;
/** A side order by its id, or the node in hand. */
export const orderRef = (id: number | "story"): string => `order:${id}`;
export const toolRef = (tool: Tool): string => `tool:${tool}`;
export const tierRef = (tier: number): string => `tier:${tier}`;
/** What a finished goal leaves in town. */
export const giftRef = (g: Goal): string => `gift:${g}`;

/** The card of a thing unlocked: a kind's, an item's, a plot's, a tool's, or the card of a number as it will be. */
export function unlockRef(u: Unlock): string {
  switch (u.is) {
    case "kind":
      return machineRef(u.kind);
    case "grade":
      return machineRef(u.kind, u.grade);
    case "recipe":
      return itemRef(u.item);
    case "plot":
      return plotRef(u.plot);
    case "tool":
      return toolRef(u.tool);
    case "blueprints":
      return `perk:blueprints.${u.count}.${u.pieces}`;
    case "number":
      return `perk:${u.of}.${u.to}`;
    case "board":
      return "perk:board";
    case "first":
      return "perk:first";
    case "ins":
      return "perk:ins";
    case "felling":
      return "perk:felling";
    case "mouths":
      return "perk:mouths";
  }
}

/**
 * The thing whose picture stands for a goal: the first thing it unlocks, which is what the yard gets
 * for it; for a goal that unlocks nothing, the first thing it asks for.
 */
export function pictureRef(g: Goal): string | null {
  const [first] = unlockedBy(g);
  if (first) return unlockRef(first);
  const want = GOALS[g]?.want;
  const wanted = ALL_ITEMS.find((k) => (want?.[k] ?? 0) > 0);
  return wanted === undefined ? null : itemRef(wanted);
}
