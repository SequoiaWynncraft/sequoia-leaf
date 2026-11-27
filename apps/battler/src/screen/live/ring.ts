/**
 * The carousel: nine figures in a ring over the far half of the board, each holding a component.
 * The clock says whose turn it is (`turnLine`); when it is the member's, the ring is theirs to
 * click, and Leaf says what they got. A figure somebody takes is gone from the ring,
 * and the players' list shows who took what. Every place in the ring keeps its spot, taken or not.
 */
import { nameOf, portrait } from "@sequoia-leaf/figures/sprites.ts";
import { link } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { itemName } from "@sequoia-leaf/raid";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { itemIcon } from "../art/icons.ts";
import { BOARD_W } from "../geometry.ts";
import { boardToPage } from "../stage.ts";
import { figPic, pic } from "../ui/cards.ts";
import { figureRef } from "../ui/refs.ts";
import { focusAfter, turnOf } from "./reads.ts";

/** What the ring asks: to take the figure at a place. */
const RING: { box: HTMLElement | null; key: string; take: ((offer: number) => void) | null } = {
  box: null,
  key: "",
  take: null,
};

export function buildRing(take: (offer: number) => void): void {
  RING.box = el("div", "", { id: "live-ring", hidden: true, role: "group", "aria-label": "The carousel" });
  RING.take = take;
  document.body.append(RING.box);
}

/** The middle of the far half of the board, where the ring stands (the member's own half stays in view), and how wide it is. */
const RING_AT = { y: 31, rx: 0.46, ry: 20 };

/** Places the ring over the far half of the board, for the size of the window. */
function placeRing(box: HTMLElement): void {
  const mid = boardToPage(BOARD_W / 2, RING_AT.y);
  const edge = boardToPage(BOARD_W / 2 + BOARD_W * RING_AT.rx, RING_AT.y + RING_AT.ry);
  box.style.left = `${Math.round(mid.x)}px`;
  box.style.top = `${Math.round(mid.y)}px`;
  box.style.setProperty("--rx", `${Math.round(edge.x - mid.x)}px`);
  box.style.setProperty("--ry", `${Math.round(edge.y - mid.y)}px`);
}

/** Draws the ring, or hides it outside a carousel. `now` is Leaf's clock. */
export function renderRing(view: SittingView, now: number, busy: boolean): void {
  const box = RING.box;
  if (!box) return;
  const { stage } = view;
  if (stage.at !== "carousel") {
    box.hidden = true;
    RING.key = "";
    return;
  }
  box.hidden = false;
  placeRing(box);
  const turn = turnOf(view, now);
  const mine = turn.at === "choosing" && !busy;
  const key = JSON.stringify([stage.ring, mine, view.you]);
  if (key === RING.key) return;
  RING.key = key;
  box.classList.toggle("mine", mine);
  const n = stage.ring.length;
  const had = focusedPlace(box);
  box.replaceChildren(
    ...stage.ring.map((offer, i) => {
      const spot = `--a:${(i / n) * 360 - 90}deg`;
      if (offer.by !== null) return el("span", "ring-offer gone", { style: spot });
      const button = el(
        "button",
        "ring-offer",
        {
          type: "button",
          style: spot,
          "data-ring": i,
          "aria-disabled": String(!mine),
          "aria-label": `${nameOf(offer.kind)}, holding ${itemName(offer.item)}`,
          onclick: () => {
            if (mine) RING.take?.(i);
          },
        },
        figPic(portrait(offer.kind)),
        el("span", "holds", {}, pic(itemIcon(offer.item))),
      );
      link(button, figureRef(offer.kind), { acts: true });
      return button;
    }),
  );
  // Drawn again while a figure in it had the keyboard: that one keeps it, or the next still standing.
  const keep = had === null ? null : focusAfter(stage.ring, had);
  if (keep !== null) box.querySelector<HTMLElement>(`[data-ring="${keep}"]`)?.focus({ preventScroll: true });
}

/** The place in the ring whose figure has the keyboard, if one has. */
function focusedPlace(box: HTMLElement): number | null {
  const at = document.activeElement;
  return at instanceof HTMLElement && box.contains(at) && at.dataset.ring !== undefined
    ? Number(at.dataset.ring)
    : null;
}
