/**
 * The yard's things in the kit's one card (`card.ts`). Each kind of thing is registered once and
 * named by a reference (`refs.ts` lists them). A card is its print, what it shows of the yard and
 * the purse as plain values (`prints.ts`), drawn by `cards.ts`, which reaches no yard; its buttons
 * are the page's tools, handed in here. The card that is up is kept by its print: it is drawn again
 * exactly when that differs, so no value it shows can be missing from what it is kept by.
 *
 * Pointing at a thing on the yard says what it is; clicking or tapping pins its card.
 */
import { at, carries, isItem, NONE, pieceOf, piecesAt, redwoodAt, tilesOf } from "@sequoia-leaf/factory";
import { canvasCard, close, moveCard, pick, refresh, register, shown, watch } from "@sequoia-leaf/kit/card.ts";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { TILE } from "../art/belts.ts";
import type { Art } from "../art/index.ts";
import { buyLand, takeInHand } from "../plots.ts";
import { yardSfx } from "../sound.ts";
import { S, toolHooks, toPage } from "../state.ts";
import { flipAt, hold, pickFrom, raiseAt, setTool, takeAway, turnAt, usable, wayAt } from "../tools.ts";
import { fellAt } from "../trees.ts";
import { doNow } from "../yard.ts";
import { cardOf, type Hands } from "./cards.ts";
import { togglePanel } from "./panels.ts";
import { printOf } from "./prints.ts";
import { itemRef, plotRef, tileRef } from "./refs.ts";
import { showView } from "./views.ts";

export { itemRef, machineRef, nodeRef, orderRef, plotRef, tileRef } from "./refs.ts";

// ---------- the yard's tiles ----------

/** What a tile of the yard stands for: what is built on it, the land it is part of, or what lies in it. */
export function refAt(x: number, y: number): string | null {
  const w = S.world;
  const i = at(w, x, y);
  if (i < 0) return null;
  const plot = w.land.plots[w.land.plot[i] ?? NONE];
  if (plot && !w.plots.includes(plot.plot)) return plotRef(plot.plot);
  // A piece of more than one tile is one card, its own tile's, from any of its tiles.
  if (w.kind[i] !== NONE) return tileRef(pieceOf(w, i));
  const raw = w.land.deposit[i] ?? NONE;
  if (isItem(raw)) return itemRef(raw);
  if (w.land.water[i] === 1 || redwoodAt(w, i)) return tileRef(i);
  return null;
}

/** What is riding a belt on a tile, if anything: pointing there is asking about it. */
export function riderAt(x: number, y: number): string | null {
  const w = S.world;
  const i = at(w, x, y);
  const carried = i < 0 ? NONE : (w.item[i] ?? NONE);
  return i >= 0 && carries(w.kind[i] ?? NONE) && isItem(carried) ? itemRef(carried) : null;
}

/**
 * Takes the piece on a tile in hand to move it, as Select's Move would with that piece alone marked:
 * its own tiles, so a tunnel goes without the belts that cross over it. Nothing, before Select is open.
 */
export function moveFrom(x: number, y: number): void {
  const pieces = piecesAt(S.world, [at(S.world, x, y)]);
  if (pieces.length === 0 || !usable("select")) return;
  setTool("select");
  hold("move", tilesOf(S.world, pieces));
}

/** What a card's buttons do: the page's own tools. */
const HANDS: Hands = {
  act: (a) => !("refused" in doNow(a)),
  turn: (x, y) => void turnAt(x, y),
  flip: (x, y) => void flipAt(x, y),
  another: (x, y) => void pickFrom(x, y),
  move: moveFrom,
  remove: (x, y) => void takeAway(x, y),
  raise: (x, y) => void raiseAt(x, y),
  way: (x, y, way) => void wayAt(x, y, way),
  buy: buyLand,
  fell: fellAt,
  refuse: (why) => {
    yardSfx.no();
    toolHooks.said(`${why}.`);
  },
  take: (g) => void takeInHand(g),
  // The rules say why a piece of research cannot go in the line, on the line over the dock.
  study: (g, into) => {
    const did = doNow({ do: into ? "study" : "unstudy", research: g });
    if ("refused" in did) {
      yardSfx.no();
      toolHooks.said(`${did.why}.`);
    } else yardSfx.plan();
  },
  // The depot's own panel is the third view of the yard's sheet, which the card would lie over: the card is put away.
  panel: (id) => {
    if (id !== "depot") return togglePanel(id);
    close();
    showView("needs");
  },
};

/** Says what every kind of thing in the yard is: each card drawn from its print. */
export function initCard(art: Art): void {
  for (const kind of ["item", "machine", "tile", "plot", "node", "order", "tool", "perk", "tier", "gift"]) {
    register(kind, (id) => {
      const p = printOf(`${kind}:${id}`);
      return p && cardOf(art, p, HANDS);
    });
  }
}

/** What the card a reference names prints now, as one string: the key it is kept by. */
export const cardKey = (ref: string | null): string => (ref ? `${ref}|${JSON.stringify(printOf(ref))}` : "");

/** Where a tile is on the page, for a card to sit beside. */
export function tileBox(x: number, y: number): { x: number; y: number; w: number; h: number } {
  const a = toPage(x * TILE, y * TILE);
  const b = toPage((x + 1) * TILE, (y + 1) * TILE);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Kept on this device once a card has been asked for from the yard: the line over the dock stops saying how (`dock.ts`). */
const LEARNT = "works.card.v1";
/** Whether a card has been asked for from the yard on this device. */
export const cardLearnt = (): boolean => keptText(LEARNT) !== null;

/**
 * Pins the card for what is on a tile (or puts it away, if it was the one pinned), and gives whether
 * one is up: the one way the yard asks for a card, by a tap, a click or a finger kept on a tile.
 * Asking where nothing has a card puts the card that is up away; a finger kept there (`held`: a pan
 * that paused) leaves it. A finger kept on a belt asks first about what rides it. Asking for a card
 * is kept as learnt on this device.
 */
export function openCard(x: number, y: number, held = false): boolean {
  const ref = (held ? riderAt(x, y) : null) ?? refAt(x, y);
  if (!ref) {
    if (!held) close();
    return false;
  }
  if (!cardLearnt()) keepText(LEARNT, "1");
  const b = tileBox(x, y);
  return pick(ref, b.x, b.y, b.w, b.h);
}

export function closeCard(): void {
  close();
}

let lastKey = "";
/** The card that is up says again what its thing is, when what it prints has changed. */
export function refreshCard(): void {
  const key = cardKey(shown()?.ref ?? null);
  if (key === lastKey) return;
  lastKey = key;
  refresh();
}

/**
 * Keeps the yard in step with the cards: the tile whose card is pinned is marked on the yard, with a
 * tap. A finger's card is a sheet the kit keeps off its tile (along the bottom, or the top); where
 * that leaves it too short to show whole, the yard moves the tile up under the top bar, and the card
 * is placed again beside it, whole along the bottom.
 */
export function followCards(pan: (dx: number, dy: number) => void): void {
  let was = -1;
  const own = scope();
  watch(() => {
    const now = S.picked;
    if (now === was) return;
    was = now;
    if (now < 0) return;
    sfx.tap();
    own.frame(() => {
      const sheet = document.querySelector(".k-info.sheet");
      if (!sheet || S.picked < 0 || sheet.scrollHeight <= sheet.clientHeight) return;
      const w = S.world.land.w;
      const box = (): ReturnType<typeof tileBox> => tileBox(S.picked % w, Math.floor(S.picked / w));
      const top = Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--sheet-top")) || 0;
      pan(0, top + 16 - box().y);
      moveCard(canvasCard, box());
    });
  });
}
