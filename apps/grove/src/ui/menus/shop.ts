/**
 * Cinfy's Treasury: the guild bank, run by Cinfy the nervous hamster treasurer, who writes in
 * Sequoia Inc.'s corporate voice. Today's four trades, then the catalogue as inventory slots, and
 * the picked item's tooltip with its price band named beside its colour.
 */

import { CATALOGUE, dailyTrades, type Item, type Tab, TABS } from "../../game/rules.ts";
import type { GroveState } from "../../game/state.ts";
import { glyph, icon } from "./icons.ts";
import type { MenuView } from "./menus.ts";
import { portrait } from "./portraits.ts";
import { button, esc, money, subhead } from "./widgets.ts";

/** Prices sit in three bands, named and coloured as item tiers are in Wynncraft. */
export function band(price: number): { name: string; colour: string } {
  if (price >= 10000) return { name: "Prestige", colour: "#fdd36f" };
  if (price >= 2000) return { name: "Special", colour: "#a2dcec" };
  return { name: "Everyday", colour: "#c9bba4" };
}

const GREETINGS = [
  "Treasury@seqwawa regrets to inform you that the vault is open.",
  "Please do not borrow from the vault. Again.",
  "All trades are final. Mostly. Please don't ask.",
];

export function shop(s: GroveState, tab: Tab, picked: string, day: number): MenuView {
  const trades = dailyTrades(day);
  return {
    category: "Sequoia Inc. · Guild bank",
    title: "Cinfy's Treasury",
    accent: "#f2c044",
    body: `
      <div class="vendor">
        <div class="vendor-face">${portrait("cinfy", 1)}</div>
        <div>
          <small>Treasurer</small>
          <strong>Cinfy</strong>
          <p class="lore">"${GREETINGS[day % GREETINGS.length] ?? ""}"</p>
        </div>
      </div>
      <div class="cols shop">
        <section>
          ${subhead("Today's four trades", "Same for everyone")}
          <div class="trades">${trades.map((item) => trade(s, item, picked)).join("")}</div>
        </section>
        <section>
          ${subhead("Catalogue")}
          <div class="tabs" role="tablist">${TABS.map((t) => `<button class="tab${t.id === tab ? " on" : ""}" role="tab" aria-selected="${t.id === tab}" data-act="tab-${t.id}">${t.name}</button>`).join("")}</div>
          <div class="inventory items">${CATALOGUE.filter((i) => i.tab === tab)
            .map(
              (i) =>
                `<button class="slot item${i.id === picked ? " picked" : ""}${s.owned.includes(i.id) ? " owned" : ""}" data-item="${i.id}" aria-label="${esc(i.name)}, ${money(i.price)} Leaf">${icon(i.icon)}</button>`,
            )
            .join("")}</div>
          <div id="item-tip">${itemTip(s, picked)}</div>
        </section>
      </div>
      <p class="fine">Leaf has no cash value. Leaf cannot be exchanged for LE, tomes, aspects or anything else outside the Grove. Treasury@seqwawa thanks you for your understanding.</p>`,
  };
}

function trade(s: GroveState, item: Item, picked: string): string {
  const owned = s.owned.includes(item.id);
  return `<button class="trade${item.id === picked ? " picked" : ""}${owned ? " owned" : ""}" data-item="${item.id}">${icon(item.icon)}<span style="color:${band(item.price).colour}">${esc(item.name)}</span><b>${owned ? "Owned" : `${money(item.price)} ${glyph("leaf")}`}</b></button>`;
}

/** The picked item's tooltip: its name in its band's colour, the band's name, Cinfy's line and the trade. */
export function itemTip(s: GroveState, id: string): string {
  const item = CATALOGUE.find((i) => i.id === id) ?? CATALOGUE[0];
  if (!item) return "";
  const b = band(item.price);
  const owned = s.owned.includes(item.id);
  const short = !owned && s.leaf < item.price;
  return `<div class="tooltip" style="--rank:${b.colour}">
    <h3 style="color:${b.colour}">${esc(item.name)}</h3>
    <p class="kind"><span class="rank" style="--rank:${b.colour}"><i class="gem" aria-hidden="true"></i>${b.name}</span> · ${TABS.find((t) => t.id === item.tab)?.name ?? ""}</p>
    <p class="lore">"${esc(item.blurb)}"</p>
    <div class="trade-row"><span class="leaf-amount">${money(item.price)}${glyph("leaf")}</span>${owned ? `<span class="note">In your glade</span>` : button("buy", short ? "Short of Leaf" : "Trade", "green", short)}</div>
  </div>`;
}
