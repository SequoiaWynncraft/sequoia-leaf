/** Small pieces every menu uses, in the mod's language. They return HTML strings. */

import { type RankName, RANKS } from "../../engine/palette.ts";
import { BOND_MAX } from "../../game/rules.ts";
import { glyph } from "./icons.ts";

export const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const money = (n: number): string => Math.round(n).toLocaleString("en-US");

export const rankColour = (rank: RankName): string => RANKS.find((r) => r.name === rank)?.colour ?? "#ffffff";

/** A rank, always as its insignia in its colour and its name beside it, so colour is never the only cue. */
export const rank = (r: RankName): string =>
  `<span class="rank" style="--rank:${rankColour(r)}"><i class="gem" aria-hidden="true"></i>${r}</span>`;

/** Minecraft's experience bar: a segmented meter. */
export function bar(value: number, max: number, colour: string, segments = 10, label = "Progress"): string {
  const pct = Math.max(0, Math.min(100, (value * 100) / Math.max(1, max)));
  return `<div class="bar" role="meter" aria-label="${esc(label)}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${max}" style="--fill:${colour};--segments:${segments}"><i style="width:${pct}%"></i></div>`;
}

/** A button in the mod's style. `tone` picks its accent: gold for the main action, green for Leaf. */
export const button = (act: string, label: string, tone = "", disabled = false): string =>
  `<button class="btn ${tone}" data-act="${act}"${disabled ? " disabled" : ""}>${label}</button>`;

/** Bond hearts, filled to `n` of five. */
export function hearts(n: number): string {
  const full = Math.max(0, Math.min(BOND_MAX, n));
  return `<span class="hearts" role="img" aria-label="Bond ${full} of ${BOND_MAX}">${Array.from(
    { length: BOND_MAX },
    (_, i) => `<i class="${i < full ? "on" : "off"}">${glyph("heart")}</i>`,
  ).join("")}</span>`;
}

/** The Leaf balance chip. */
export const leaf = (n: number): string => `<span class="leaf-amount">${money(n)}${glyph("leaf")}</span>`;

/** A section heading inside a panel, with a small note at its right. */
export const subhead = (title: string, note = ""): string =>
  `<div class="subhead"><h2>${title}</h2>${note ? `<small>${note}</small>` : ""}</div>`;
