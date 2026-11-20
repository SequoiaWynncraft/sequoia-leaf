/**
 * The Great Sequoia, the guild's tree: three weekly goals the whole guild works toward, Leaf you
 * pour to water it (each gift hangs your lantern in its branches), and its rings, the guild's own
 * history. No leaderboard: the cozy space stays cozy.
 */

import { LANTERN_HANGERS } from "../../game/friends.ts";
import { GREAT_WATER_PRICE } from "../../game/rules.ts";
import type { GroveState } from "../../game/state.ts";
import { glyph, icon } from "./icons.ts";
import type { MenuView } from "./menus.ts";
import { head } from "./portraits.ts";
import { bar, button, money, subhead } from "./widgets.ts";

const GUILD_RINGS = [
  {
    title: "The Swamp years",
    story: "Deep inside: the floodplain the guild held for two years, kept as a misty memorial.",
  },
  {
    title: "Season 32",
    story: "The gilded ring. The guild finished the season on top, and the whole forest knows it.",
  },
];

export function great(s: GroveState, ring: number): MenuView {
  const poured = 18750 + s.poured;
  const goals: [string, number, number, string][] = [
    ["Water the roots", poured, 25000, "#58c47a"],
    ["Guild raids", 36, 50, "#78a8e2"],
    ["Cones by the fire", 84, 100, "#e4ac55"],
  ];
  const lanterns = s.poured > 0 ? [...LANTERN_HANGERS, "You"] : LANTERN_HANGERS;
  const r = GUILD_RINGS[ring];
  return {
    category: "Guild forest",
    title: "The Great Sequoia",
    accent: "#f2c044",
    body: `
      <div class="cols great">
        <section>
          ${subhead("This week's goals", "Resets Monday")}
          ${goals.map(([n, v, max, c]) => `<div class="goal"><div><span>${n}</span><small>${money(v)} / ${money(max)}</small></div>${bar(v, max, c, 10, n)}</div>`).join("")}
          <div class="buttons">${button("pour", `Water it · ${GREAT_WATER_PRICE} ${glyph("leaf")}`, "green", s.leaf < GREAT_WATER_PRICE)}</div>
          <p class="note">${money(s.poured)} Leaf poured by you this week. Each gift hangs your lantern in its branches.</p>
        </section>
        <section>
          ${subhead("Lanterns hung this week", String(lanterns.length + 32))}
          <div class="lanterns">${lanterns.map((n) => `<span class="lantern" title="${n}">${head(n === "You" ? "you" : n, 2)}<small>${n}</small></span>`).join("")}</div>
          ${subhead("The guild's rings")}
          <div class="season-picks">${GUILD_RINGS.map((g, i) => button(`guildring-${i}`, g.title, i === ring ? "gold" : "")).join("")}</div>
          ${r ? `<div class="tooltip" style="--rank:#fdd36f"><p class="lore">${r.story}</p></div>` : ""}
        </section>
      </div>
      <p class="fine">${icon("forest", 1)} Every member's tree stands round it in the forest. There is no ranking here.</p>`,
  };
}
