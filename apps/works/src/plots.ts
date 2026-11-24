/**
 * What a player does to the yard that stands no piece: buying a plot, with the undergrowth coming
 * down before their eyes, and taking a project or the commission in hand.
 */
import type { Act, Goal, Plot } from "@sequoia-leaf/factory";
import { GOLD, GREEN } from "@sequoia-leaf/kit/palette.ts";

import { TILE } from "./art/belts.ts";
import { float, flutter } from "./fx.ts";
import { layout } from "./layout.ts";
import { yardSfx } from "./sound.ts";
import { S } from "./state.ts";
import { toolHooks } from "./tools.ts";
import { doNow } from "./yard.ts";

/** Does a command, and gives back the rules' reason it was not done, or null. */
function does(act: Act): string | null {
  const did = doNow(act);
  return "refused" in did ? did.why : null;
}

/** Buys a plot: the undergrowth comes down from its signpost outwards, before the member's eyes. */
export function buyLand(id: Plot): boolean {
  const w = S.world;
  const plot = w.land.plots.find((p) => p.plot === id);
  const sign = layout(w).signs.find((s) => s.plot.plot === id);
  const no = plot ? does({ do: "buyPlot", plot: id }) : "There is no such plot";
  if (!plot || no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return false;
  }
  const from = sign ?? { x: (plot.x + plot.w / 2) * TILE, y: (plot.y + plot.h / 2) * TILE };
  S.clearing.set(id, { at: S.t, x: from.x, y: from.y });
  yardSfx.clear();
  float(from.x, from.y - 20, plot.name, GOLD[2], 2.4);
  return true;
}

/** Each frame: leaves fly where the undergrowth is coming down, and a cleared plot is done with. */
export function stepClearing(): void {
  const w = S.world;
  for (const [id, c] of S.clearing) {
    const plot = w.land.plots.find((p) => p.plot === id);
    const r = (S.t - c.at) * 260;
    if (!plot || r > 420) {
      S.clearing.delete(id);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (x < plot.x * TILE || y < plot.y * TILE || x > (plot.x + plot.w) * TILE || y > (plot.y + plot.h) * TILE)
        continue;
      flutter(x, y, 2, [GREEN[2], GREEN[3], GREEN[1]], 6, 26);
    }
  }
}

/** Takes a project, or the commission, in hand: what reaches the depot goes to it first. Says why not, or nothing. */
export function takeInHand(g: Goal): string | null {
  const no = does({ do: "take", node: g });
  if (no !== null) {
    yardSfx.no();
    toolHooks.said(`${no}.`);
    return no;
  }
  yardSfx.plan();
  toolHooks.changed();
  return null;
}
