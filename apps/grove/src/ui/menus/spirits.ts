/**
 * The spirit book: an inventory grid of every spirit with its real portrait, silhouettes for the
 * ones you have not found, and the Minecraft tooltip for the one you pick: its name in its rank's
 * colour, its rank, number, glade job, book line and bond.
 */

import { spirit, SPIRITS } from "../../game/spirits.ts";
import { found, type GroveState } from "../../game/state.ts";
import { glyph } from "./icons.ts";
import type { MenuView } from "./menus.ts";
import { portrait } from "./portraits.ts";
import { button, esc, hearts, rank, rankColour, subhead } from "./widgets.ts";

export function spirits(s: GroveState, picked: string): MenuView {
  const ids = SPIRITS.map((sp) => sp.id);
  return {
    category: "Spirit book",
    title: "Your spirits",
    accent: "#a082dc",
    body: `
      <div class="book">
        <section>
          ${subhead("Collection", `${found(s, ids)} / ${ids.length} found`)}
          <div class="inventory" role="listbox" aria-label="Spirits">${SPIRITS.map((sp) => {
            const bond = s.spirits[sp.id];
            const have = (bond?.count ?? 0) > 0;
            return `<button class="slot spirit${sp.id === picked ? " picked" : ""}${have ? "" : " unknown"}${bond?.verdant ? " verdant" : ""}" data-spirit="${sp.id}" role="option" aria-selected="${sp.id === picked}" aria-label="${have ? esc(sp.name) : "Unfound spirit"}, ${sp.rank}" style="--rank:${rankColour(sp.rank)}">${portrait(sp.id, 1, !have)}${bond && bond.count > 1 ? `<sub>${bond.count}</sub>` : ""}${sp.id === s.companion ? `<sup>${glyph("heart")}</sup>` : ""}</button>`;
          }).join("")}</div>
        </section>
        <section class="inspect" id="inspect">${tooltip(s, picked)}</section>
      </div>`,
  };
}

/** The picked spirit's Minecraft tooltip. */
export function tooltip(s: GroveState, id: string): string {
  const sp = spirit(id);
  const bond = s.spirits[sp.id];
  const have = (bond?.count ?? 0) > 0;
  const colour = rankColour(sp.rank);
  return `
    <div class="display${have ? "" : " unknown"}" style="--rank:${colour}">${portrait(sp.id, 2, !have)}</div>
    <div class="tooltip" style="--rank:${colour}">
      <h3 style="color:${have ? colour : "#8f8aa0"}">${have ? esc(sp.name) : "???"}${bond?.verdant ? ` ${glyph("goldleaf")}` : ""}</h3>
      <p class="kind">${rank(sp.rank)} spirit · No. ${String(sp.number).padStart(2, "0")}</p>
      ${
        have
          ? `<p class="job">${glyph("glade")} ${esc(sp.job)}</p><p class="lore">"${esc(sp.note)}"</p>
             <p class="bond">Bond ${hearts(bond?.count ?? 0)}${bond?.verdant ? ` <span class="gold">Verdant</span>` : ""}</p>
             ${
               s.companion === sp.id
                 ? `<p class="note gold">${glyph("heart")} Your companion: by your nametag, at the Campfire.</p>`
                 : button(`companion-${sp.id}`, "Make companion", "green")
             }`
          : `<p class="lore">Whereabouts unknown. Found in ${rank(sp.rank)} cones.</p>`
      }
    </div>`;
}
