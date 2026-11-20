/**
 * The cone banner and its published rate card. A cone costs 400 Leaf with no bulk discount, the
 * odds are on the card, and a Treant or better comes within 40 cones, the count carrying over
 * between banners. "Warm 1" and "Warm 10" play the real reveal by the glade's fire.
 */

import { RANKS } from "../../engine/palette.ts";
import { BANNER, CONE_PRICE, ODDS, PITY, PITY_RANK, POOLS, VERDANT_AT, VERDANT_CHANCE } from "../../game/rules.ts";
import { spirit } from "../../game/spirits.ts";
import type { GroveState } from "../../game/state.ts";
import { glyph, icon } from "./icons.ts";
import type { MenuView } from "./menus.ts";
import { figure, portrait } from "./portraits.ts";
import { bar, button, money, rank, rankColour, subhead } from "./widgets.ts";

const pct = (p: number): string => `${(p * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export function cones(s: GroveState): MenuView {
  const featured = spirit(BANNER.featured);
  const free = s.freeCones;
  const one = free > 0 || s.leaf >= CONE_PRICE;
  const tenCost = Math.max(0, 10 - free) * CONE_PRICE;
  const ten = s.leaf >= tenCost;
  return {
    category: `Raid banner · ${BANNER.raid}`,
    title: BANNER.title,
    accent: rankColour(featured.rank),
    body: `
      <div class="banner-art">
        <canvas data-art="banner" data-h="56" aria-hidden="true"></canvas>
        <div class="banner-caption">
          <small>Featured spirit</small>
          <strong style="color:${rankColour(featured.rank)}">${featured.name}</strong>
          ${rank(featured.rank)}
        </div>
        <div class="banner-spirit">${portrait(featured.id, 2)}</div>
      </div>
      <div class="cols">
        <section>
          ${subhead("What a cone holds", `<a class="link" href="#rates">Rate card ›</a>`)}
          <ul class="odds">${RANKS.map((r) => `<li>${rank(r.name)}<b>${pct(ODDS[r.name])}</b></li>`).join("")}</ul>
        </section>
        <section>
          ${subhead("Pity", `${s.pity} / ${PITY}`)}
          ${bar(s.pity, PITY, "#e4ac55", PITY / 4, "Cones since your last Treant or better")}
          <p class="note">A ${rank(PITY_RANK)} or better within ${PITY} cones. The count carries over between banners.</p>
          <p class="price">${glyph("leaf")} ${money(CONE_PRICE)} Leaf a cone · no bulk discount</p>
          ${free > 0 ? `<p class="note gold">${free} free cone${free === 1 ? "" : "s"} banked from Bloom</p>` : ""}
          <div class="buttons">
            ${button("warm-1", free > 0 ? "Warm 1 · free" : "Warm 1", "gold", !one)}
            ${button("warm-10", `Warm 10 · ${money(tenCost)}`, "", !ten)}
          </div>
        </section>
      </div>`,
  };
}

export function rates(): MenuView {
  return {
    category: "Published rate card",
    title: "What's in a cone",
    accent: "#f2c044",
    body: `
      <table class="rate-card">
        <thead><tr><th>Rank</th><th>Chance</th><th>Spirits</th><th>Each</th></tr></thead>
        <tbody>${RANKS.map((r) => {
          const pool = POOLS[r.name];
          const each = ODDS[r.name] / pool.length;
          return `<tr><td>${rank(r.name)}</td><td>${pct(ODDS[r.name])}</td><td class="pool">${pool
            .map((id) => `<span title="${spirit(id).name}">${figure(id)}</span>`)
            .join("")}</td><td>${pct(each)}</td></tr>`;
        }).join("")}</tbody>
      </table>
      <ul class="rules">
        <li>${icon("cone")}<span>One cone is ${money(CONE_PRICE)} Leaf. Ten are ${money(CONE_PRICE * 10)}: no bulk discount.</span></li>
        <li>${icon("star")}<span>A ${rank(PITY_RANK)} or better within ${PITY} cones. Your count carries over to the next banner.</span></li>
        <li>${icon("goldleaf")}<span>Any cone can hold a Verdant coat (${pct(VERDANT_CHANCE)}); your ${ordinal(VERDANT_AT)} copy of a spirit always turns Verdant.</span></li>
        <li>${icon("heart")}<span>Duplicates deepen your bond: hearts, then Verdant, then the nametag, then the role icon.</span></li>
        <li>${icon("flag")}<span>On this banner, a Treant is ${spirit(BANNER.featured).name} half the time. ${BANNER.ends}.</span></li>
      </ul>
      <div class="buttons"><a class="btn" href="#cones">Back to the banner</a></div>`,
  };
}

const ordinal = (n: number): string => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
