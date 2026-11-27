/**
 * An item in the hand, on the page: the tip that says what letting it go would do, on a figure or
 * on a component on the rack (one tip for both, `drop:` in the kit's cards: shown while the item is
 * carried over its aim, and pinned, with the button that does it, when the aim was tapped); the
 * marks on the rack for the hand; and what the page says besides the hand (`Seen`).
 */
import { deck, type Description, register } from "@sequoia-leaf/kit/card.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import {
  HOLDS,
  isRackItem,
  type Pickable,
  picksOf,
  type RackItem,
  rackName,
  type RaidNote,
  type RunView,
  TOOLS,
} from "@sequoia-leaf/raid";

import { itemIcon, itemPic } from "../art/icons.ts";
import { burst, fly } from "../fx.ts";
import type { Marks, Seen } from "../gesture.ts";
import { type Drop, dropOf, wanters } from "../making.ts";
import { pawns } from "../pawns.ts";
import { snd } from "../sounds.ts";
import { boardSpot } from "../stage.ts";
import { catalogFor, doOrAsk, S } from "../state.ts";
import { itemDesc } from "./cards.ts";
import { dropOfId, itemOfRef } from "./refs.ts";

/** A kind's tile on the rack, on the page. */
export const rackSlot = (kind: RackItem): HTMLElement | null =>
  document.querySelector<HTMLElement>(`#rack [data-item="${kind}"]`);

/**
 * The tip: the finished item two components would make, as its own card says it; or what the figure
 * gets, and how many of its places are full then; or why it cannot be given. Pinned, it has the
 * button that does it, after which `done` puts the item in the hand down.
 */
function tipOf(drop: Drop, done: () => void): Description {
  if (drop.does === "nothing")
    return {
      name: rackName(catalogFor(S.run), drop.item),
      icon: itemIcon(drop.item),
      blocks: [{ body: el("span", "k-coral", { text: drop.why }) }],
    };
  const act = {
    label: drop.does === "make" ? "Make" : drop.does === "give" ? "Give" : "Use",
    look: "sm wide",
    on: () => {
      done();
      doOrAsk(drop.command);
    },
  };
  if (drop.does === "tongs" || drop.does === "whetstone") {
    const back = drop.does === "tongs" ? drop.items.length : drop.holds;
    const what = back === 1 ? "1 item" : `${back} items`;
    return {
      name: TOOLS[drop.item].name,
      icon: itemIcon(drop.item),
      blocks: [
        {
          body:
            drop.does === "tongs"
              ? `${what} back to the rack.`
              : `${what} each become another of the same sort, at random.`,
        },
      ],
      actions: [act],
    };
  }
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

/** The component (or tool) of the pick card the mouse or the keyboard is on, while a component is being picked. */
function pickPointed(run: RunView): Pickable | null {
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
 * Marks the rack for the hand: the tile of the item in it, the tiles it pairs with, the one it is
 * aimed at; and, at a glance, each item somebody fielded wants.
 */
export function paintRack(run: RunView | null, marks: Pick<Marks, "item" | "pairs" | "pair">): void {
  for (const slot of document.querySelectorAll<HTMLElement>("#rack [data-item]")) {
    const kind = slot.dataset.item;
    if (!isRackItem(kind)) continue;
    slot.classList.toggle("lit", kind === marks.item);
    slot.classList.toggle("pairs", marks.pairs.includes(kind));
    slot.classList.toggle("aimed", kind === marks.pair);
    slot.classList.toggle("wanted", run !== null && wanters(run, kind).length > 0);
  }
}

/** Two components became an item on the rack: it lands in its place with a ring of sparks. */
export function hearMade(notes: readonly RaidNote[]): void {
  for (const note of notes) {
    const at = note.t === "made" ? boardSpot(rackSlot(note.item)) : null;
    if (note.t !== "made" || !at) continue;
    snd.forge();
    burst(at.x, at.y, 14, [GOLD[2], GOLD[1], "#ffffff"], { speed: 30, ttl: 0.5 });
    fly(itemPic(note.item), { x: at.x, y: at.y - 14 }, at, { dur: 0.35, arc: 6 });
  }
}

/**
 * The rack's other news. Something melted: the sound of selling, as its acorns go in the purse. The
 * Tongs: what the figure held flies back to the rack. A Whetstone: sparks over the figure as what it
 * holds changes.
 */
export function hearRack(notes: readonly RaidNote[]): void {
  for (const note of notes) {
    if (note.t === "melted") snd.sell();
    if (note.t !== "tongs" && note.t !== "whetted") continue;
    const p = pawns.get(note.piece);
    if (!p) continue;
    const from = { x: p.x, y: p.y - 8 };
    if (note.t === "whetted") {
      snd.forge();
      burst(from.x, from.y, 12, [GOLD[2], GOLD[1], "#ffffff"], { speed: 26, ttl: 0.45 });
      continue;
    }
    snd.lift();
    note.items.forEach((item, i) => {
      const to = boardSpot(rackSlot(item)) ?? boardSpot(document.getElementById("rack")) ?? from;
      fly(itemPic(item), from, to, { delay: i * 0.12, dur: 0.5, arc: 20, land: () => snd.give() });
    });
  }
}
