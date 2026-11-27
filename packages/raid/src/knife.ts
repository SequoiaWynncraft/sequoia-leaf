import type { PlanningCommand } from "./command.ts";
/**
 * The bot's play of the Carving Knife (Penguin Month), beside `bot.ts`, which hands it a figure's
 * worth to it as its habit has it. A Knife is taken only where it has a use: toward An Extra Chair,
 * or for an emblem that puts a step on now. Two make the chair while the run has none; otherwise a
 * Knife and a component go to the worthiest figure for whom the emblem they make puts a step on, and
 * a Knife with no such use waits on the rack.
 */
import { catalogOf } from "./content/catalog.ts";
import { type ComponentId, type EmblemId, HOLDS, isComponentId, isEmblemId, itemIn } from "./content/items.ts";
import { combine } from "./content/recipes.ts";
import type { RackItem } from "./content/tools.ts";
import { stepFor } from "./content/traits.ts";
import { lastRoom } from "./endless.ts";
import { countTraits } from "./party.ts";
import { countOn, kindsOn } from "./racks.ts";
import type { Done, Piece, RunView } from "./run.ts";

/** How much a figure on the board of a run is worth, as the bot's habit has it. */
export type Worth = (run: RunView, p: Piece) => number;
type Hands<R extends RunView> = (run: R, c: PlanningCommand) => Done;

/** Whether a figure on the board holding an emblem would put its trait's step on: it counts once a figure, so not on a twin of one that carries it. */
export function raisesStep(run: RunView, p: Piece, item: EmblemId): boolean {
  const cat = catalogOf(run);
  const board = run.board.flatMap((b) => (b ? [b] : []));
  const trait = cat.items[item]?.grants;
  if (trait === undefined) return false;
  const before = countTraits(cat, board)[trait] ?? 0;
  const after =
    countTraits(
      cat,
      board.map((b) => (b === p ? { kind: b.kind, items: [...b.items, item] } : b)),
    )[trait] ?? 0;
  return stepFor(cat, trait, after) > stepFor(cat, trait, before);
}

/** Whether an item is the Carving Knife (one that turns up only after a boss), which only this hands out. */
export const isKnife = (run: RunView, item: RackItem | undefined): item is ComponentId =>
  isComponentId(item) && itemIn(catalogOf(run), item).turnsUp !== undefined;

/** The worthiest figure on the board, and the component (null: one it holds loose), for whom a Knife makes an emblem that puts a step on. */
function knifeFor(run: RunView, knife: ComponentId, worth: Worth): { seat: number; part: ComponentId | null } | null {
  const cat = catalogOf(run);
  const rack = kindsOn(run.rack).flatMap((item) => (isComponentId(item) && !isKnife(run, item) ? [item] : []));
  let best: { seat: number; part: ComponentId | null; score: number } | null = null;
  for (const [seat, p] of run.board.entries()) {
    if (!p) continue;
    const loose = p.items.find((item) => isComponentId(item) && !isKnife(run, item));
    // One holding a loose component forges with that; one holding none takes one from the rack first.
    const parts: (ComponentId | null)[] = loose !== undefined ? [null] : p.items.length < HOLDS ? rack : [];
    for (const part of parts) {
      const comp = part ?? loose;
      const made = comp === undefined ? null : combine(cat, knife, comp);
      if (made?.gives !== "item" || !isEmblemId(made.id) || !raisesStep(run, p, made.id)) continue;
      const score = worth(run, p);
      if (!best || score > best.score) best = { seat, part, score };
    }
  }
  return best;
}

/**
 * Whether a Knife would be of use: toward An Extra Chair while the run has none (one on the rack
 * already, or a boss still to come before the last), or as an emblem that puts a step on now.
 */
export function knifeUse(run: RunView, knife: ComponentId, worth: Worth): boolean {
  const toCome = run.room < lastRoom(run) - 5;
  if (!run.boons.includes("extrachair") && (countOn(run.rack, knife) > 0 || toCome)) return true;
  return knifeFor(run, knife, worth) !== null;
}

/** Plays the Knives on the rack: An Extra Chair of two, then emblems that put a step on, for as long as any is of use. */
export function useKnives<R extends RunView>(run: R, hands: Hands<R>, worth: Worth): void {
  for (let guard = 0; guard < 6; guard++) {
    const knife = kindsOn(run.rack).find((item) => isKnife(run, item));
    if (knife === undefined || !isKnife(run, knife)) return;
    if (countOn(run.rack, knife) >= 2 && !run.boons.includes("extrachair")) {
      if (!hands(run, { do: "forge", item: knife, with: knife }).ok) return;
      continue;
    }
    const best = knifeFor(run, knife, worth);
    if (!best) return;
    const to = { on: "board", at: best.seat } as const;
    // The component first, then the Knife onto it; one held loose already takes the Knife at once.
    if (best.part !== null && !hands(run, { do: "give", item: best.part, to }).ok) return;
    if (!hands(run, { do: "give", item: knife, to }).ok) return;
  }
}
