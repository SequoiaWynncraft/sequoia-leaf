/**
 * A card's Upgrade: the grade command for the one piece the card is of (`{ do: "upgrade", tiles,
 * grade, kind, from, price }`). It names the piece as the card saw it, its kind and the grade it stood
 * at, so that when something else has been set there since (by another tab, or a command before it in
 * the same batch), it is refused rather than raising what is there now. Upgrade on a marked area, or
 * the whole yard, raises whatever stands there, and names nothing.
 *
 * Every Upgrade says the price the player was shown for all of it, as buying a plot and felling a
 * redwood do, and is refused if the price now is another: what stands there may have changed in a way
 * the names do not tell (a longer tunnel of the same kind and grade), or more may stand in the area.
 */
import { coinsText } from "@sequoia-leaf/core";

import type { Spent } from "./build.ts";
import { piecesAt, upgrade, upgradePrice } from "./pieces.ts";
import { type Kind, KIND_INFO, kindName } from "./tables.ts";
import { numeral } from "./unlocks.ts";
import type { Yard } from "./yard.ts";

/** One piece raised from its card: the kind and grade it was seen at, and the grade it is raised to. */
export interface Raise {
  readonly kind: Kind;
  readonly from: number;
  readonly grade: number;
}

/** A card's Raise as the wire has it: the grade raised to, and the kind (by name) and grade the piece was seen at. */
export const raiseWire = (r: Raise | undefined): { grade: number; kind: string; from: number } | undefined =>
  r && { grade: r.grade, kind: kindName(r.kind), from: r.from };

/** "a Study". */
const named = (k: Kind): string => {
  const name = KIND_INFO[k]?.name ?? "";
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`;
};

/** Why the piece on some tiles is no longer the one its card was of, or null while it is. */
function changedSince(y: Yard, tiles: readonly number[], r: Raise): string | null {
  const [p, more] = piecesAt(y, tiles);
  if (!p || more) return "It has changed since: nothing stands there now.";
  if (p.kind !== r.kind) return `It has changed since: it is now ${named(p.kind)}.`;
  const grade = p.grade ?? 1;
  return grade === r.from ? null : `It has changed since: it is now at grade ${numeral(grade)}.`;
}

/**
 * Why raising what stands on some tiles (to `to`) would not cost `shown`, the price the player was
 * shown, or null if it would. Where nothing can be raised, raising says so itself.
 */
function priceChanged(y: Yard, tiles: readonly number[], shown: number, to?: number): string | null {
  const now = upgradePrice(y, tiles, to);
  return now === 0 || now === shown ? null : `The price has changed: it is now ${coinsText(now)}`;
}

/**
 * The grade command: raises what stands on some tiles, or with a card's Raise, that one piece if it
 * is still the one the card was of; either at the price the player was shown (`shown`), or not at all.
 */
export function upgradeAs(y: Yard, tiles: readonly number[], shown: number, coins: number, r?: Raise): Spent {
  const why = (r ? changedSince(y, tiles, r) : null) ?? priceChanged(y, tiles, shown, r?.grade);
  return why === null ? upgrade(y, tiles, coins, r?.grade) : { ok: false, why };
}
