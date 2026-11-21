/**
 * Which trait is lit on the table: the one the pointer is on, or else the one clicked (tapped) and
 * kept. A lit trait's figures get a gold outline and hop once; everyone else on the table dims a
 * little. Clicking the same chip again, clicking anywhere else, or Escape lets a kept one go.
 *
 * Only the state is here, with the time it last changed so the hop can be timed; who draws what is
 * in `scene.ts` and `ui/table.ts`. Nothing here touches the page.
 */
import { isFigureId, type TraitId, traitsOf, type UnitKind } from "../game/index.ts";

export interface Light {
  /** The trait the pointer is on, if any. */
  pointed: TraitId | null;
  /** The trait clicked and kept, if any. */
  kept: TraitId | null;
  /** When the lit trait last changed, by the stage's clock. */
  since: number;
}

export const light: Light = { pointed: null, kept: null, since: -9 };

/** The trait lit now: the one pointed at, or else the one kept. */
export const litTrait = (l: Light = light): TraitId | null => l.pointed ?? l.kept;

const changing = (l: Light, now: number, change: () => void): boolean => {
  const was = litTrait(l);
  change();
  if (litTrait(l) !== was) l.since = now;
  return litTrait(l) !== was;
};

/** The pointer has come onto a trait's chip. Gives whether what is lit changed. */
export const point = (trait: TraitId, now: number, l: Light = light): boolean =>
  changing(l, now, () => {
    l.pointed = trait;
  });
/** The pointer has left a trait's chip. */
export const unpoint = (trait: TraitId, now: number, l: Light = light): boolean =>
  changing(l, now, () => {
    if (l.pointed === trait) l.pointed = null;
  });
/** A trait's chip was clicked: it is kept, or let go if it was the one kept. Gives whether it is kept now. */
export function toggle(trait: TraitId, now: number, l: Light = light): boolean {
  changing(l, now, () => {
    l.kept = l.kept === trait ? null : trait;
  });
  return l.kept === trait;
}
/** A trait is kept whatever was kept before: a chip on a card always opens its trait. */
export const keep = (trait: TraitId, now: number, l: Light = light): boolean =>
  changing(l, now, () => {
    l.kept = trait;
  });
/** Lets the kept trait go: a click elsewhere, Escape, a new run. */
export const letGo = (now: number, l: Light = light): boolean =>
  changing(l, now, () => {
    l.kept = null;
  });
/** Forgets everything, pointed and kept: a new run, the front page. */
export const forget = (now: number, l: Light = light): boolean =>
  changing(l, now, () => {
    l.kept = null;
    l.pointed = null;
  });

/** How high a lit figure is off its spot this moment: one small hop, a little after the one before it. */
export function hopOf(since: number, now: number, order: number): number {
  const k = (now - since - order * 0.05) / 0.28;
  return k <= 0 || k >= 1 ? 0 : Math.sin(k * Math.PI) * 4;
}

/** How far a figure is dimmed while a trait it does not carry is lit. */
export const DIM = 0.45;
/** How the lit trait shows on a figure standing `x` pixels along the table: lit (and how high it hops), dimmed, or neither. */
export function shineOf(
  kind: UnitKind,
  x: number,
  now: number,
  l: Light = light,
): { lit: boolean; dim: boolean; hop: number } {
  const trait = litTrait(l);
  if (!trait) return { lit: false, dim: false, hop: 0 };
  const has = isFigureId(kind) && traitsOf(kind).includes(trait);
  // One after another from the left, so the hop runs along the table.
  return { lit: has, dim: !has, hop: has ? hopOf(l.since, now, Math.max(0, Math.round(x / 18))) : 0 };
}
