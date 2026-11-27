/**
 * A card's Upgrade: the grade command for the one piece the card is of (`{ do: "upgrade", tiles,
 * grade, kind, from }`). It names the piece as the card saw it, its kind and the grade it stood at, so
 * that when something else has been set there since (by another tab, or a command before it in the
 * same batch), it is refused rather than raising what is there now for another price. Upgrade on a
 * marked area raises whatever stands there, and names nothing.
 */
import type { Spent } from "./build.ts";
import { piecesAt, upgrade } from "./pieces.ts";
import { type Kind, KIND_INFO } from "./tables.ts";
import { numeral } from "./unlocks.ts";
import type { Yard } from "./yard.ts";

/** One piece raised from its card: the kind and grade it was seen at, and the grade it is raised to. */
export interface Raise {
  readonly kind: Kind;
  readonly from: number;
  readonly grade: number;
}

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

/** The grade command: raises what stands on some tiles, or with a card's Raise, that one piece if it is still the one the card was of. */
export function upgradeAs(y: Yard, tiles: readonly number[], coins: number, r?: Raise): Spent {
  const why = r ? changedSince(y, tiles, r) : null;
  return why === null ? upgrade(y, tiles, coins, r?.grade) : { ok: false, why };
}
