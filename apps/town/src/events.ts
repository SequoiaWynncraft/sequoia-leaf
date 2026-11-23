/**
 * The guild's moments, staged in the town: real members home from a raid hang a lantern in the
 * tree, a war raises the banner, a level or a milestone is a line in the feed and a flourish over
 * whoever it is. Where everything is at any moment of one follows from the moment's own time by
 * Leaf's clock (the walk in `visitors.ts`, the lantern and the banner in `town.ts`), so a page
 * that comes in the middle joins it there; here is only what is heard and seen once, each at its
 * own time (`cue`): the fanfare, the cheer, the feed's line. The town's own cheer along.
 */

import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, dist } from "@sequoia-leaf/kit/util.ts";
import { BY_TREE, HOME } from "@sequoia-leaf/town/clock.ts";

import { cheerAll, hop } from "./actors.ts";
import { float, sparkle } from "./fx.ts";
import { type Actor, cue, G, hooks, stepCues, stepLater } from "./game.ts";
import { guild, type Happening, type Person } from "./guild.ts";
import { crownBanner, flown, hangs, landLantern } from "./town.ts";
import { visitorOf } from "./visitors.ts";

/** The cheers played, for `window.town`. */
export const cheered: { what: string; at: number }[] = [];

/** Somebody's figure in town, if they have one and are awake: the member's own, a visitor's, another player's. */
const inTownAs = (p: Person): Actor | null => (p.you ? G.player : visitorOf(p));

/** The town cheers one of the guild's moments, and whoever of it is in town is pleased about it: their hops timed from the cheer (`at`). */
function cheer(h: Extract<Happening, { at: number }>, at: number): void {
  cheerAll(at);
  for (const p of h.who) {
    const a = inTownAs(p);
    if (a) hop(a, 3, (G.now - at) / 1000);
  }
  cheered.push({ what: h.kind === "party" ? h.raid : h.land, at });
  if (cheered.length > 20) cheered.shift();
}

/** A real member reached a level or a milestone: a line in the feed (if it tells it), and a flourish if they are in town. */
function realNews(who: Person, h: Happening): void {
  guild.say(h, hooks.feed);
  const a = inTownAs(who);
  if (!a || a.away) return;
  sfx.levelUp();
  sparkle(a.x, a.y - 10, 20, 7);
  if (h.kind === "reached") float(a.x, a.y - 32, `Level ${h.level}!`, GOLD[2], 2.2);
  hop(a, 3);
}

/** One of the guild's moments begins, or is under way: what of it is played once is set for its time. */
function stage(h: Happening): void {
  if (G.where !== "town") return;
  switch (h.kind) {
    case "war": {
      const { at } = h;
      cue(at, () => {
        sfx.fanfare();
        guild.say(h, hooks.feed);
      });
      cue(at + 700, () => cheer(h, at + 700));
      cue(flown(at)?.full ?? at, crownBanner);
      return;
    }
    case "party": {
      const at = h.at + HOME.cheer;
      cue(at, () => {
        sfx.fanfare();
        guild.say(h, hooks.feed);
        cheer(h, at);
      });
      // The lantern goes up with a pop from whoever of them stands by the tree, and lands 0.9 seconds on.
      const hang = h.at + HOME.hang;
      cue(hang, () => {
        if (!hangs(hang)) return;
        sfx.pop();
        for (const a of h.who.flatMap((p) => inTownAs(p) ?? []))
          if (dist(a.x, a.y, BY_TREE.x, BY_TREE.y) < 2) hop(a, 2);
      });
      cue(hang + 900, () => landLantern(hang));
      return;
    }
    case "reached":
    case "milestone":
      realNews(h.who, h);
  }
}

let hearing = false;
/** The evening begins: from now on the town plays what the guild says is happening. */
export function beginEvents(): void {
  if (hearing) return;
  hearing = true;
  guild.hear(stage);
}

export function stepEvents(): void {
  stepLater();
  stepCues();
  // Whoever is in the gateway is half in the dark beyond it.
  const all = G.player ? [G.player, ...G.folk, ...G.visitors] : [...G.folk, ...G.visitors];
  for (const a of all) {
    if (a.away || (a.you && G.inDoor)) continue;
    a.alpha = a.y < 98 ? clamp((a.y - 84) / 12, 0, 1) : 1;
  }
}
