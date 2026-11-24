/**
 * A sorter's own parts of its card: the row that says which side the item it is set to goes out
 * of, and the buttons that set it, one for each item it may be set to and one for none.
 */
import { type Item, ITEM_INFO } from "@sequoia-leaf/factory";
import type { Action, Row } from "@sequoia-leaf/kit/card.ts";
import { icon } from "@sequoia-leaf/kit/dom.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import type { Art } from "../art/index.ts";
import { itemRef } from "./refs.ts";

/** What a sorter's parts are drawn from: the item it is set to, the items it may be, and whether it sends to its right. */
export interface SorterPrint {
  readonly set: Item | null;
  readonly sorts: readonly Item[];
  readonly right: boolean;
}

/** The row naming the item it is set to and the side it goes out of; none while it is set to nothing. */
export const sorterRows = (p: SorterPrint): Row[] =>
  p.set === null ? [] : [{ label: p.right ? "Sends right" : "Sends left", things: [{ ref: itemRef(p.set) }] }];

/** The item it sends to its side, chosen as a machine's recipe is, or none: `sort` sets it. */
export function sorterActions(art: Art, p: SorterPrint, sort: (item: Item | null) => void): Action[] {
  const pick = (item: Item | null): void => {
    sort(item);
    sfx.tap();
  };
  return [
    {
      label: "Nothing",
      look: "slot",
      icon: icon("more"),
      lit: p.set === null,
      hint: "Nothing",
      about: "With nothing set it is a belt.",
      on: () => pick(null),
    },
    ...p.sorts.map((t) => ({
      label: ITEM_INFO[t]?.name ?? "",
      look: "slot",
      icon: art.item(t),
      lit: p.set === t,
      hint: ITEM_INFO[t]?.name ?? "",
      on: () => pick(p.set === t ? null : t),
    })),
  ];
}
