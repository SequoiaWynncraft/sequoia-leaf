/**
 * An item in the hand, on the page: the tip that says what letting it go would do, on a figure or
 * on a component on the rack (one tip for both, `drop:` in the kit's cards: shown while the item is
 * carried over its aim, and pinned, with the button that does it, when the aim was tapped); the
 * marks on the rack for the hand; and what the page says besides the hand (`Seen`).
 */
import { deck, type Description, register } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { HOLDS, type ItemId, itemName, picksOf, type RaidNote, type RunView } from "@sequoia-leaf/raid";

import { itemIcon, itemPic } from "../art/icons.ts";
import { burst, fly } from "../fx.ts";
import type { Marks, Seen } from "../gesture.ts";
import { type Drop, dropOf, wanters } from "../making.ts";
import { snd } from "../sounds.ts";
import { boardSpot } from "../stage.ts";
import { catalogFor, doNow, S } from "../state.ts";
import { itemDesc } from "./cards.ts";
import { dropOfId, itemOfRef } from "./refs.ts";

/** The place of the rack on the page. */
export const rackSlot = (at: number): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#rack [data-item="${at}"]`);

/**
 * The tip: the finished item two components would make, as its own card says it; or what the figure
 * gets, and how many of its places are full then; or why it cannot be given. Pinned, it has the
 * button that does it, after which `done` puts the item in the hand down.
 */
function tipOf(drop: Drop, done: () => void): Description {
  if (drop.does === "nothing")
    return {
      name: itemName(catalogFor(S.run), drop.item),
      icon: itemIcon(drop.item),
      blocks: [{ body: el("span", "k-coral", { text: drop.why }) }],
    };
  const act = {
    label: drop.does === "make" ? "Make" : "Give",
    look: "sm wide",
    on: () => {
      done();
      doNow(drop.command);
    },
  };
  if (drop.does === "make") return { ...itemDesc(catalogFor(S.run), drop.item, null), actions: [act] };
  return {
    ...itemDesc(catalogFor(S.run), drop.item, null),
    rows: [],
    stats: [{ label: "Holds", value: `${drop.holds}/${HOLDS}` }],
    actions: [act],
  };
}

/** Says what the tip of an item in the hand is. `done` puts the item down, once its button has been pressed. */
export function registerDrop(done: () => void): void {
  register("drop", (id) => {
    const named = dropOfId(id);
    const drop = S.run && named ? dropOf(S.run, named.item, named.aim) : null;
    return drop ? tipOf(drop, done) : null;
  });
}

/** The component of the pick card the mouse or the keyboard is on, while a component is being picked. */
function pickPointed(run: RunView): ItemId | null {
  const choice = picksOf(run)[0];
  if (choice?.kind !== "component") return null;
  const card = document.querySelector<HTMLElement>("#picks [data-pick]:is(:hover, :focus-visible)");
  return (card && choice.options[Number(card.dataset.pick)]) ?? null;
}

/**
 * What the page says besides the hand: what a tapped item is aimed at (the thing its pinned tip is
 * about), and the item pointed at (a place on the rack, a name in a card, a component to pick).
 */
export function seenNow(run: RunView | null): Seen {
  const pinned = deck.pinned();
  const named = pinned?.startsWith("drop:") ? dropOfId(pinned.slice(5)) : null;
  return { aim: named?.aim ?? null, item: itemOfRef(deck.pointed) ?? (run ? pickPointed(run) : null) };
}

/**
 * Marks the rack for the hand: the item in it, the components it pairs with, the one it is aimed
 * at; and, at a glance, each item somebody fielded wants.
 */
export function paintRack(run: RunView | null, marks: Pick<Marks, "item" | "pairs" | "pair">): void {
  for (const slot of document.querySelectorAll<HTMLElement>("#rack [data-item]")) {
    const at = Number(slot.dataset.item);
    const item = run?.items[at];
    slot.classList.toggle("lit", at === marks.item);
    slot.classList.toggle("pairs", marks.pairs.includes(at));
    slot.classList.toggle("aimed", at === marks.pair);
    slot.classList.toggle("wanted", run !== null && item !== undefined && wanters(run, item).length > 0);
  }
}

/** Two components became an item on the rack: it lands in its place with a ring of sparks. */
export function hearMade(notes: readonly RaidNote[]): void {
  for (const note of notes) {
    const at = note.t === "made" ? boardSpot(rackSlot(note.at)) : null;
    if (note.t !== "made" || !at) continue;
    snd.forge();
    burst(at.x, at.y, 14, [GOLD[2], GOLD[1], "#ffffff"], { speed: 30, ttl: 0.5 });
    fly(itemPic(note.item), { x: at.x, y: at.y - 14 }, at, { dur: 0.35, arc: 6 });
  }
}
