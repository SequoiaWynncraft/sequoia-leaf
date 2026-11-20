/**
 * Your tree's rings: a cross-section with one ring per Wynncraft season you have played, marks for
 * your moments, and the season the guild won gilded. Tap a ring to read its season.
 */

import { LEVEL_MAX } from "../../game/rules.ts";
import { glyph } from "./icons.ts";
import type { MenuView } from "./menus.ts";
import { button } from "./widgets.ts";

export const SEASONS: readonly { n: number; title: string; story: string; mark: string }[] = [
  {
    n: 28,
    title: "Swamp roots",
    story: "Your first season, in the Swamp. A Training Twig made room for you by the roots.",
    mark: "glade",
  },
  {
    n: 29,
    title: "First guild raid",
    story: "Your first groot: four of you, The Canyon Colossus, and a lantern in the Great Sequoia.",
    mark: "star",
  },
  {
    n: 30,
    title: "First war win",
    story: "A gold pennant rose on the ridge after your first territory win.",
    mark: "flag",
  },
  {
    n: 31,
    title: "Level 8",
    story: "Your tree grew into a mature sequoia: cinnamon bark, clouded crown.",
    mark: "glade",
  },
  {
    n: 32,
    title: "Season 32 victory",
    story: "The guild finished the season on top. Everyone who played that season has this ring gilded.",
    mark: "star",
  },
];

/** Your moments, marked on their rings: the season, the mark, and where it sits on the wood (%). */
const MARKS: readonly [number, string, number, number][] = [
  [1, "star", 33, 46],
  [2, "flag", 62, 36],
  [3, "glade", 76, 62],
];

export function rings(level: number, picked: number): MenuView {
  const s = SEASONS[picked] ?? SEASONS[SEASONS.length - 1];
  return {
    category: `Your sequoia · Level ${Math.min(level, LEVEL_MAX)} of ${LEVEL_MAX}`,
    title: "Tree rings",
    accent: "#d6a474",
    body: `
      <div class="cols rings">
        <section class="wood">
          <div class="ring-box">
            <canvas data-art="rings" data-w="100" data-h="74" data-scale="2" data-fit data-pick="${picked}" aria-label="Your tree's cross-section, one ring per season"></canvas>
            ${MARKS.map(([i, g, x, y]) => `<button class="mark${i === picked ? " on" : ""}" data-act="season-${i}" aria-label="Season ${SEASONS[i]?.n ?? ""}: ${SEASONS[i]?.title ?? ""}" style="left:${x}%;top:${y}%">${glyph(g)}</button>`).join("")}
          </div>
          <div class="ring-key"><span>${glyph("star")} First raid</span><span>${glyph("flag")} War win</span><span>${glyph("glade")} Level up</span></div>
        </section>
        <section>
          <div class="tooltip" style="--rank:${s?.n === 32 ? "#fdd36f" : "#d6a474"}">
            <small>Season ${s?.n ?? ""}</small>
            <h3 style="color:${s?.n === 32 ? "#fdd36f" : "#f2e6d4"}">${glyph(s?.mark ?? "star")} ${s?.title ?? ""}</h3>
            <p class="lore">${s?.story ?? ""}</p>
          </div>
          <div class="season-picks">${SEASONS.map((x, i) => button(`season-${i}`, String(x.n), i === picked ? "gold" : "")).join("")}</div>
          <p class="note">One ring per season you played. Every ring is drawn from your own ledger.</p>
        </section>
      </div>`,
  };
}
