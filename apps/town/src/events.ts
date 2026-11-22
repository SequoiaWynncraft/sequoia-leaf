/**
 * The guild's moments, staged in the town: real members home from a raid hang a lantern in the
 * tree, a war raises the banner, a level or a milestone is a line in the feed and a flourish over
 * whoever it is. What happens and to whom comes from `guild.ts`, and so do the feed's lines and
 * when they are said; this is only the staging, which never waits on a line. The town's own cheer
 * along.
 */

import { GOLD } from "@sequoia-leaf/kit/palette.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp } from "@sequoia-leaf/kit/util.ts";

import { cheerAll, hop, walkTo } from "./actors.ts";
import { float, sparkle } from "./fx.ts";
import { after, G, hooks, stepLater } from "./game.ts";
import { guild, type Happening, type Person } from "./guild.ts";
import { hangLantern, raiseBanner } from "./town.ts";
import { done, figure, GATE, visitorOf } from "./visitors.ts";
import { MUSTER } from "./world.ts";

function land(name: string, h: Happening): void {
  raiseBanner(name);
  G.lands++;
  sfx.fanfare();
  guild.say(h, hooks.feed);
  after(0.7, () => {
    cheerAll();
  });
  // Whoever fought for it and is in town is pleased about it.
  if (h.kind === "war")
    for (const p of h.who) {
      const a = visitorOf(p);
      if (a) hop(a, 3);
    }
}

/**
 * Real members home from a raid together: they walk in through the gate (whoever is in town
 * already comes over), the first of them hangs a lantern in the tree, and the town cheers. Then
 * they go back to where they were, or out through the gate again if they were only passing.
 */
function partyHome(who: readonly Person[], h: Happening): void {
  G.raidsToday++;
  // Whoever is dozing in town sleeps through it.
  const party = who
    .filter((p) => !p.you)
    .flatMap((p) => figure(p) ?? [])
    .slice(0, MUSTER.length);
  let cheered = false;
  const home = (): void => {
    if (cheered) return;
    cheered = true;
    sfx.fanfare();
    guild.say(h, hooks.feed);
    cheerAll();
    for (const a of party) hop(a, 3);
    const leader = party[0];
    if (!leader) {
      hangLantern({ x: 344, y: 206 });
      return;
    }
    after(1.3, () => {
      for (const a of party.slice(1)) done(a);
      walkTo(leader, { x: 340, y: 216 }, () => {
        leader.dir = 2;
        hangLantern({ x: leader.x + 4, y: leader.y - 10 });
        hop(leader, 2);
        after(1.6, () => {
          done(leader);
        });
      });
    });
  };
  if (party.length === 0) {
    home();
    return;
  }
  party.forEach((a, i) => {
    // Somebody passing comes in out of the dark beyond the gate.
    if (a.alpha < 0.5) {
      a.x = GATE.x - 7 + (i % 2) * 13;
      a.y = GATE.y;
    }
    after(i * 0.35, () => {
      walkTo(a, MUSTER[i] ?? { x: 256, y: 116 }, i === 0 ? home : null);
    });
  });
  after(7, home);
}

/** A real member reached a level or a milestone: a line in the feed (if it tells it), and a flourish if they are in town. */
function realNews(who: Person, h: Happening): void {
  guild.say(h, hooks.feed);
  const a = who.you ? G.player : visitorOf(who);
  if (!a || a.away) return;
  sfx.levelUp();
  sparkle(a.x, a.y - 10, 20, 7);
  if (h.kind === "reached") float(a.x, a.y - 32, `Level ${h.level}!`, GOLD[2], 2.2);
  hop(a, 3);
}

/**
 * The same moments while the member is away at a camp: nothing is staged, but the town is as they
 * will expect to find it. The party is gone, or back with its lantern hung; the banner is up.
 */
function quietly(h: Happening): void {
  switch (h.kind) {
    case "party":
      G.raidsToday++;
      hangLantern({ x: 344, y: 206 });
      return;
    case "war":
      raiseBanner(h.land);
      G.lands++;
      return;
    case "reached":
    case "milestone":
  }
}

function stage(h: Happening): void {
  if (G.where !== "town") {
    quietly(h);
    return;
  }
  switch (h.kind) {
    case "war":
      land(h.land, h);
      return;
    case "party":
      partyHome(h.who, h);
      return;
    case "reached":
    case "milestone":
      realNews(h.who, h);
  }
}

let hearing = false;
/** The evening begins: from now on the town shows what the guild says is happening. */
export function beginEvents(): void {
  if (hearing) return;
  hearing = true;
  guild.hear(stage);
}

export function stepEvents(): void {
  stepLater();
  // Whoever is in the gateway is half in the dark beyond it.
  const all = G.player ? [G.player, ...G.folk, ...G.visitors] : [...G.folk, ...G.visitors];
  for (const a of all) {
    if (a.away || (a.you && G.inDoor)) continue;
    a.alpha = a.y < 98 ? clamp((a.y - 84) / 12, 0, 1) : 1;
  }
}
