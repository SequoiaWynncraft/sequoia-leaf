/**
 * The names things at the table go by on a card (the kit's `card.ts`): `kind:id`. `cards.ts` says
 * what each kind of thing is; whoever shows or follows one names it with these.
 */
import { type BoonId, type FigureId, isRackItem, isTraitId, type RackItem, type TraitId } from "@sequoia-leaf/raid";

import type { Aim } from "../making.ts";

export const figureRef = (kind: FigureId): string => `figure:${kind}`;
export const pieceRef = (id: number): string => `piece:${id}`;
export const foeRef = (seat: number): string => `foe:${seat}`;
export const unitRef = (id: number): string => `unit:${id}`;
export const traitRef = (id: TraitId): string => `trait:${id}`;
/**
 * A trait's card from a figure's card: the table's; from the almanac a lore card in Leaf's era,
 * never an idle run's (`lore`); from the member's collection, in their own terms, every step (`own`).
 */
export const traitRefFrom = (id: TraitId, lore: boolean | undefined, own: boolean): string =>
  lore === true ? `${traitRef(id)}/lore${own ? "/own" : ""}` : traitRef(id);
/** An item or a tool; `@rack` for its tile on the rack. */
export const itemRef = (id: RackItem, onRack = false): string => (onRack ? `item:${id}@rack` : `item:${id}`);
export const boonRef = (id: BoonId): string => `boon:${id}`;
/** What letting one of a kind go on its aim would do: `drop:thorn:piece:12`, `drop:thorn:rack:bark`. */
export const dropRef = (item: RackItem, aim: Aim): string =>
  "piece" in aim ? `drop:${item}:piece:${aim.piece}` : `drop:${item}:rack:${aim.rack}`;

/** The trait a reference names, if it names one. */
export const traitOfRef = (ref: string | null): TraitId | null => {
  const id = ref?.startsWith("trait:") ? (ref.slice(6).split("/")[0] ?? "") : "";
  return isTraitId(id) ? id : null;
};
/** The item or tool a reference names, if it names one: `item:thorn`, `item:thorn@rack`, `item:thorn/lore`. */
export const itemOfRef = (ref: string | null): RackItem | null => {
  const id = ref?.startsWith("item:") ? (ref.slice(5).split(/[@/]/)[0] ?? "") : "";
  return isRackItem(id) ? id : null;
};
/** The kind and the aim a `drop:` reference's id names (`thorn:piece:12`), if it names them. */
export function dropOfId(id: string): { item: RackItem; aim: Aim } | null {
  const [item, what, n] = id.split(":");
  if (!isRackItem(item) || n === undefined) return null;
  if (what === "piece") return { item, aim: { piece: Number(n) } };
  return what === "rack" && isRackItem(n) ? { item, aim: { rack: n } } : null;
}
