/**
 * How a piece in the yard stands, and whether it is in trouble: decided in one place (`condition`,
 * a number, making nothing, so that a screen can ask it of every piece in view each frame), and put
 * in a sentence for a screen to show (`status`, which words what `condition` decides). Each kind says
 * both for itself (`kinds/`), in the words they share (`kinds/say.ts`). Nothing here changes the yard
 * but working out its power and plumbing if a change left them unknown.
 */
import { alight, fuelNow } from "./kinds/burner.ts";
import { RULES } from "./kinds/list.ts";
import { holding as holdingOf, type MachineRate, rateOf, type State, STATES, TROUBLE } from "./kinds/say.ts";
import { litAt } from "./power.ts";
import { pieceOf } from "./sizes.ts";
import { ALL_KINDS, BURNS, isMaker, type Item, type Kind, NONE, type Recipe } from "./tables.ts";
import { KIT, rewire } from "./wire.ts";
import { type Counts, holderOf, type Yard } from "./yard.ts";

export { type MachineRate, type State, STATES, TROUBLE } from "./kinds/say.ts";

export interface Status {
  readonly state: State;
  readonly line: string;
  readonly trouble: boolean;
  /** For a machine that has filled up with one part while it waits for another: the part to tip out. */
  readonly spare?: Item;
  /** What a machine is waiting for. */
  readonly missing?: readonly Item[];
  /** What it holds with nowhere to send it. */
  readonly stuck?: Item;
}

/** What a holder's row holds, as words: "3 planks and 1 pot". */
export const holding = (y: Yard, r: number): string => holdingOf(KIT, y, r);

/** The recipe a machine is working toward: the one it is pinned to, or the first that uses everything it holds. */
export function aim(y: Yard, i: number): Recipe | null {
  const r = RULES[y.kind[i] ?? NONE];
  return r ? r.aim(KIT, y, pieceOf(y, i)) : null;
}

/** The recipe a machine last began, while it stands: what it is counted for while it holds nothing and is told nothing (`flow`); none before it has begun one. */
export function lastRecipe(y: Yard, i: number): Recipe | null {
  const r = i >= 0 ? RULES[y.kind[i] ?? NONE] : undefined;
  return r ? r.last(KIT, y, pieceOf(y, i)) : null;
}

/**
 * A yard read afresh (`into`) takes what each machine last began from the copy it replaces (`from`):
 * no save keeps it, so without this a machine holding nothing for a moment would be counted for
 * nothing after every read. Only where the same kind of machine still stands, and has begun nothing
 * since; one taken away on the page already has none to give.
 */
export function keepLast(from: Yard, into: Yard): void {
  if (from.kind.length !== into.kind.length) return;
  for (let i = 0; i < into.kind.length; i++) {
    const k = into.kind[i] ?? NONE;
    if (!isMaker(k) || from.kind[i] !== k) continue;
    const [was, now] = [holderOf(from, i), holderOf(into, i)];
    if (was < 0 || now < 0 || (into.holders.last[now] ?? NONE) !== NONE) continue;
    into.holders.last[now] = from.holders.last[was] ?? NONE;
  }
}

/**
 * The recipe a machine is counted for, by its card, the yard's Items and its plot's smog alike: what it
 * is working toward (`aim`), or between batches, holding nothing and told nothing, what it last began
 * (`lastRecipe`). None for a piece that makes nothing by recipe, or a machine that has begun nothing.
 */
export const countedFor = (y: Yard, i: number): Recipe | null => aim(y, i) ?? lastRecipe(y, i);

/**
 * What a gatherer, a machine or a Study does a minute (the planner's `makes`), as every screen says
 * it: what it turns out (or a Study takes in) at full power, for what it is counted for (`countedFor`,
 * or the recipe given); the share of ticks it works, none where power does not reach and else the yard's
 * pace; what it does now at that share; and the power it draws now, its grade's where power reaches
 * it and none where it does not. Anything else does nothing a minute.
 */
export const machineRate = (y: Yard, i: number, recipe: Recipe | null = countedFor(y, i)): MachineRate =>
  rateOf(KIT, y, i < 0 ? i : pieceOf(y, i), recipe);

/**
 * What the pieces standing in a yard can make of each thing a minute, and what they need of each a
 * minute to do it: added to `made` and `needed`, which the caller clears. Every gatherer, machine and
 * Study power reaches is taken as working each tick the yard's power lets it (as `machineRate` takes it),
 * never waiting for a part or for room: so `made` is a ceiling, not a count of anything.
 *
 * A machine is counted for the recipe it is working toward (`aim`). One that holds nothing and is
 * told nothing has none for the moment: it is counted for the recipe it last began (`lastRecipe`),
 * which goes with it when it is taken away. A Study needs the folios the research first in line still
 * wants, in the shares it wants them. Each counts at the rate every screen says (`machineRate`), as
 * its kind says (`Hooks.flow`). What burns for power in reach needs what it burns (`KindDef.burns`):
 * a kind's need a minute for as many of it as stand, added once.
 *
 * It runs down the plumbing's lists, so it costs in step with the pieces that work, and makes nothing.
 */
export function flow(y: Yard, made: Counts, needed: Counts): void {
  const wire = y.wire ?? rewire(y);
  const { work, burners } = wire;
  for (let c = 0; c < work.length; c++) flowAt(y, work[c] ?? 0, made, needed);
  // Each kind's fuel once, as many as burn it now times what one burns, in the tables' order.
  for (const k of BURNING)
    for (const f of BURNS[k]?.fuels ?? []) {
      let n = 0;
      for (let c = 0; c < burners.length; c++) {
        const i = burners[c] ?? 0;
        if (y.kind[i] === k && fuelNow(KIT, y, i) === f) n++;
      }
      needed[f.fuel] = (needed[f.fuel] ?? 0) + n * (KIT.MINUTE / f.ticks);
    }
}

/** Whether the burner on a tile (any of a big one's tiles) is burning, as its card and its picture say it: power reaches it, and it is alight (`alight`). */
export const burningAt = (y: Yard, i: number): boolean => litAt(y, i) && alight(KIT, y, pieceOf(y, i));

/** The kinds that burn for power, in the tables' order. */
const BURNING: readonly Kind[] = ALL_KINDS.filter((k) => BURNS[k] !== null);

/** What the piece on a tile adds a minute to what the yard makes and needs, as its kind says. */
const flowAt = (y: Yard, i: number, made: Counts, needed: Counts): void =>
  RULES[y.kind[i] ?? NONE]?.flow(KIT, y, i, made, needed);

/**
 * How the piece on a tile stands: its state's place in `STATES`, and `TROUBLE` more while it is in
 * trouble; -1 if nothing stands there. The one place either is decided (`status` words it). It
 * makes nothing, so a screen can ask it of every piece in view.
 */
export function condition(y: Yard, i: number): number {
  const r = i < 0 ? undefined : RULES[y.kind[i] ?? NONE];
  if (!r) return -1;
  // A piece of more than one tile stands as one, from any of its tiles.
  return r.condition(KIT, y, pieceOf(y, i), litAt(y, i));
}

/**
 * What the piece on a tile is doing, in a sentence: the state and trouble `condition` decides, and
 * the words for it, with what they name (the part to tip out, what is waited for). Nothing if nothing
 * stands there.
 */
export function status(y: Yard, i: number): Status | null {
  const c = condition(y, i);
  const state = STATES[c % TROUBLE];
  const r = RULES[y.kind[i] ?? NONE];
  if (c < 0 || state === undefined || !r) return null;
  return { state, trouble: c >= TROUBLE, ...r.words(KIT, y, pieceOf(y, i), state) };
}
