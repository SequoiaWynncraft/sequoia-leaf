/**
 * The names things at the table go by on a card (the kit's `card.ts`): `kind:id`. `cards.ts` says
 * what each kind of thing is; whoever shows or follows one names it with these.
 */
import { type BoonId, type FigureId, isItemId, isTraitId, type ItemId, type TraitId } from "@sequoia-leaf/raid";

import type { Aim } from "../making.ts";

export const figureRef = (kind: FigureId): string => `figure:${kind}`;
export const pieceRef = (id: number): string => `piece:${id}`;
export const foeRef = (seat: number): string => `foe:${seat}`;
export const unitRef = (id: number): string => `unit:${id}`;
export const traitRef = (id: TraitId): string => `trait:${id}`;
export const itemRef = (id: ItemId, at = -1): string => (at >= 0 ? `item:${id}@${at}` : `item:${id}`);
export const boonRef = (id: BoonId): string => `boon:${id}`;
/** What letting the item at a place on the rack go on its aim would do: `drop:2:piece:12`, `drop:2:rack:0`. */
export const dropRef = (item: number, aim: Aim): string =>
  "piece" in aim ? `drop:${item}:piece:${aim.piece}` : `drop:${item}:rack:${aim.rack}`;

/** The trait a reference names, if it names one. */
export const traitOfRef = (ref: string | null): TraitId | null => {
  const id = ref?.startsWith("trait:") ? (ref.slice(6).split("/")[0] ?? "") : "";
  return isTraitId(id) ? id : null;
};
/** The item a reference names, if it names one: `item:thorn`, `item:thorn@2`, `item:thorn/lore`. */
export const itemOfRef = (ref: string | null): ItemId | null => {
  const id = ref?.startsWith("item:") ? (ref.slice(5).split(/[@/]/)[0] ?? "") : "";
  return isItemId(id) ? id : null;
};
/** The place on the rack and the aim a `drop:` reference's id names (`2:piece:12`), if it names them. */
export function dropOfId(id: string): { item: number; aim: Aim } | null {
  const [item, what, n] = id.split(":");
  if (item === undefined || n === undefined || (what !== "piece" && what !== "rack")) return null;
  return { item: Number(item), aim: what === "piece" ? { piece: Number(n) } : { rack: Number(n) } };
}
