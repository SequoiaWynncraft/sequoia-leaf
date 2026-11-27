/**
 * Feeding Greg on the page. While a figure from the bench is carried over the stall and the party
 * has a Greg, the stall's sell target splits in two: "Sell for +2" and beside it "Feed Greg +6%",
 * the number being what this figure would add, shown before it is let go (`feeding.ts`; "Greg is
 * full", with no target, when he has all he can). Let go on the second half, the figure is fed to
 * him (`feed`, shown at once as the run's planning is). The keyboard and a finger reach it as they
 * reach selling: a button on a bench figure's card.
 *
 * Fed, the figure hops into Greg and is gone, Greg gulps and his number rises over him, and what it
 * held flies back to the rack as selling sends it.
 */
import type { Action } from "@sequoia-leaf/kit/card.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { LEAF } from "@sequoia-leaf/kit/palette.ts";
import {
  catalogOf,
  meltValue,
  type Piece,
  pieceAt,
  type RackItem,
  type RaidCommand,
  type RaidNote,
  type RunView,
  sellValue,
  type Spot,
  spotOf,
} from "@sequoia-leaf/raid";

import { itemPic } from "../art/icons.ts";
import { type FeedOffer, feedOffer, feedWords } from "../feeding.ts";
import { fly, later, say } from "../fx.ts";
import { gulp, pawns, spotXY } from "../pawns.ts";
import { snd } from "../sounds.ts";
import { boardSpot } from "../stage.ts";
import { doNow, S } from "../state.ts";

/** What the feed target is for, while a figure is carried: Greg's place and what this one would add; null for no target. */
const SHOP: { feed: Exclude<FeedOffer, { full: true }> } = { feed: null };

/** Whether the pointer at a point of the page is over the feed target, over the stall. */
function overFeed(x: number, y: number): boolean {
  const r = document.querySelector("#sellhint .feed:not(.full)")?.getBoundingClientRect();
  return r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * What the stall says while a figure from `from` is carried: what selling it gives, and beside it,
 * for a figure from the bench in a party with a Greg, what feeding him would.
 */
export function fillShopHint(run: RunView, from: Spot | null): void {
  const hint = document.getElementById("sellhint");
  const piece = from ? pieceAt(run, from) : null;
  document.body.classList.remove("feed-hot");
  SHOP.feed = null;
  if (!hint || !piece || !from) return;
  const offer = feedOffer(run, from);
  SHOP.feed = offer && "to" in offer ? offer : null;
  hint.classList.toggle("two", SHOP.feed !== null);
  const sell = el(
    "span",
    "sell",
    {},
    "Sell for ",
    el("span", "k-cur", {}, icon("acorn"), `+${sellValue(catalogOf(run), piece)}`),
  );
  hint.replaceChildren(
    sell,
    ...(offer ? [el("span", "full" in offer ? "feed full" : "feed", { text: feedWords(offer) })] : []),
  );
}

/** What the stall says while one of a kind from the rack is carried: what melting it gives. */
export function fillMeltHint(item: RackItem): void {
  const hint = document.getElementById("sellhint");
  document.body.classList.remove("feed-hot");
  SHOP.feed = null;
  if (!hint) return;
  hint.classList.remove("two");
  hint.replaceChildren(
    el("span", "sell", {}, "Melt for ", el("span", "k-cur", {}, icon("acorn"), `+${meltValue(item)}`)),
  );
}

/** The pointer carrying a figure has moved: the feed target lights while it is over it. */
export function aimShop(e: { clientX: number; clientY: number }, shop: boolean): void {
  document.body.classList.toggle("feed-hot", shop && SHOP.feed !== null && overFeed(e.clientX, e.clientY));
}

/** What letting a figure from `from` go over the stall does: feeds Greg on the feed target, else sells it. */
export function shopCommand(from: Spot): RaidCommand {
  const feed = document.body.classList.contains("feed-hot") ? SHOP.feed : null;
  document.body.classList.remove("feed-hot");
  return feed ? { do: "feed", from, to: feed.to } : { do: "sell", from };
}

/** For a figure on the bench of a party with a Greg, its card's button that feeds him (as the feed target does); none for anyone else. */
export function feedActions(run: RunView, piece: Piece): Action[] {
  const from = spotOf(run, piece.id);
  const offer = from ? feedOffer(run, from) : null;
  if (!offer || !("to" in offer)) return [];
  return [
    {
      label: feedWords(offer),
      look: "wood sm wide",
      on: () => {
        const now = S.run ?? run;
        const at = spotOf(now, piece.id);
        const fed = at ? feedOffer(now, at) : null;
        if (at && fed && "to" in fed) doNow({ do: "feed", from: at, to: fed.to });
      },
    },
  ];
}

/** Greg ate a figure from the bench: it hops into him, he gulps and his number rises, and what it held flies to the rack. */
export function hearFed(notes: readonly RaidNote[]): void {
  for (const note of notes) {
    if (note.t !== "fed") continue;
    const greg = pawns.get(note.piece);
    const from = pawns.get(note.ate) ?? null;
    const at = from ? { x: from.x, y: from.y - 8 } : spotXY(note.from);
    gulp(note.ate, note.piece);
    later(0.3, () => {
      snd.ability({ n: -14, wave: "triangle", hiss: 260, slide: 0.55, vol: 0.12 });
      if (greg) say(greg.x, greg.y - 30, `+${note.gained}%`, LEAF, { ttl: 1 });
    });
    later(0.15, () => {
      const rack = boardSpot(document.getElementById("rack")) ?? at;
      note.items.forEach((item, i) =>
        fly(itemPic(item), at, rack, { delay: i * 0.12, dur: 0.5, arc: 20, land: () => snd.give() }),
      );
    });
  }
}
