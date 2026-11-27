/**
 * Items on a figure's card. For one of the party's own while planning: what it holds, then the
 * three finished items that suit it, each with the button that gets it for the figure now (made
 * from the rack and what the figure holds, and handed over, in one press) or with what is in the
 * way: the components still missing, by their pictures. For anybody else: pictures only.
 *
 * And the small pictures of the fielded figures that want an item, for a component's recipes.
 */
import { type Block, type Row, thing } from "@sequoia-leaf/kit/card.ts";
import { el, shown } from "@sequoia-leaf/kit/dom.ts";
import {
  catalogOf,
  figureIn,
  type FinishedId,
  isFigureId,
  type ItemId,
  type Piece,
  pieceAt,
  type RunView,
  spotOf,
  type UnitKind,
} from "@sequoia-leaf/raid";

import { commandsFor, type Offer, offerOf, offersFor, onOffer, wanters } from "../making.ts";
import { doNow, S } from "../state.ts";
import { headOf } from "./heads.ts";
import { itemRef } from "./refs.ts";

/**
 * The small pictures of the fielded figures that want an item, each figure once; nothing where
 * nobody does. At half the tally's size: a hint beside a recipe, smaller than the items it is about.
 */
export function wantedBy(run: RunView | null, item: ItemId): HTMLElement | null {
  const kinds = [...new Set(run ? wanters(run, item).map((p) => p.kind) : [])];
  if (kinds.length === 0) return null;
  const names = kinds.map((kind) => (run ? figureIn(catalogOf(run), kind).name : kind)).join(", ");
  return el(
    "span",
    "wantedby",
    { role: "img", "aria-label": `For ${names}` },
    ...kinds.map((k) => shown(headOf(k), 0.5)),
  );
}

/** Gets a finished item for one of the party's figures, as its card offers it now. */
function have(id: number, item: FinishedId): void {
  const run = S.run;
  const to = run ? spotOf(run, id) : null;
  const piece = run && to ? pieceAt(run, to) : null;
  if (!run || !to || !piece) return;
  for (const command of commandsFor(run, offerOf(run, piece, item), to)) if (!doNow(command)?.ok) return;
}

/** What stands at the end of an offer's line: its button, the components it needs, or why it is not offered. */
function ending(offer: Offer, id: number): HTMLElement {
  if (offer.how === "needs")
    return el("span", "needs k-dim", {}, "needs", ...offer.needs.map((part) => thing(itemRef(part), { bare: true })));
  if (!onOffer(offer)) return el("span", "k-info-tagged", { text: offer.how === "held" ? "held" : "no room" });
  return el(
    "button",
    "k-btn sm",
    { type: "button", onclick: () => have(id, offer.item) },
    offer.how === "give" ? "Give" : "Make",
  );
}

const row = (label: string, look: string, ...things: Node[]): HTMLElement =>
  el(
    "div",
    `k-info-row ${look}`.trim(),
    {},
    el("span", "k-label", { text: label }),
    el("div", "k-info-things", {}, ...things),
  );

/** One of the party's own: what it holds, and each of its three on a line of its own. */
function ownItems(run: RunView, piece: Piece): HTMLElement {
  const held = piece.items.map((item) => el("span", "k-slot k-info-icon", {}, thing(itemRef(item), { bare: true })));
  const lines = offersFor(run, piece).map((offer) =>
    el(
      "div",
      `suit${onOffer(offer) ? " lit" : ""}`,
      {},
      thing(itemRef(offer.item), { lit: onOffer(offer) }),
      ending(offer, piece.id),
    ),
  );
  return el(
    "div",
    "suits",
    {},
    held.length > 0 ? row("Holds", "k-look-icons", ...held) : null,
    row("Good with", "", ...lines),
  );
}

/**
 * What a figure's card says of items: for one of the party's own while planning (`own`), a block
 * with its buttons; for anybody else, what it holds and the three that suit it as pictures, lit if
 * the rack could make one for it.
 */
export function itemsOf(
  kind: UnitKind,
  items: readonly ItemId[],
  run: RunView | null,
  own: Piece | undefined,
): { blocks: Block[]; rows: Row[] } {
  if (run && own) return { blocks: [{ body: ownItems(run, own) }], rows: [] };
  const rows: Row[] = [{ label: "Holds", look: "icons", things: items.map((item) => ({ ref: itemRef(item) })) }];
  if (isFigureId(kind))
    rows.push({
      label: "Good with",
      look: "icons",
      things: offersFor(run ?? { items: [], era: S.era }, { kind, items: [...items] }).map((offer) => ({
        ref: itemRef(offer.item),
        lit: run !== null && onOffer(offer),
      })),
    });
  return { blocks: [], rows };
}
