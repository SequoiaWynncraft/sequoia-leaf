/**
 * The guild, live: when the guild says something has happened out in the game, the town shows it.
 * A party musters at the gate and leaves; it comes back and hangs a lantern; a territory is won and
 * the banner goes up; somebody levels. What happens and to whom comes from `guild.ts`; this is
 * only the staging.
 */

import { CREAM, GOLD, SKY } from "@sequoia-leaf/kit/palette.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, dist } from "@sequoia-leaf/kit/util.ts";

import { cheerAll, face, hop, inTown, lead, letGo, say, walkTo } from "./actors.ts";
import { burst, float, sparkle } from "./fx.ts";
import { type Actor, changed, G, hooks } from "./game.ts";
import { guild, type Happening } from "./guild.ts";
import { hangLantern, raiseBanner } from "./town.ts";
import { MUSTER } from "./world.ts";

interface Later {
  at: number;
  fn: () => void;
}
const later: Later[] = [];

/** Something to happen a little later, by the town's own clock. */
export function after(secs: number, fn: () => void): void {
  later.push({ at: G.t + secs, fn });
}

const named = (who: readonly string[]): Actor[] =>
  who.flatMap((name) => {
    const a = G.mates.find((m) => m.who.name === name);
    return a ? [a] : [];
  });

function raidOut(who: readonly string[], raid: string): void {
  const out = named(who);
  if (out.length === 0) return;
  let here = 0;
  let gone = false;
  const go = (): void => {
    if (gone) return;
    gone = true;
    sfx.horn();
    // Two of them say it; all four are thinking it.
    out.forEach((a, i) => {
      a.dir = 3;
      hop(a, i % 2 ? 1 : 2);
    });
    const [first, , third] = out;
    if (first) say(first, Math.random() < 0.5 ? "ready?" : "buffs up", 1.5);
    after(0.8, () => {
      if (third) say(third, Math.random() < 0.5 ? "go go go" : "no gg left behind", 1.5);
    });
    after(1.7, () => {
      hooks.feed(`${first?.who.name ?? "A"}'s party set out for ${raid}.`, "coral");
      out.forEach((a, i) => {
        walkTo(a, { x: 249 + (i % 2) * 13, y: 85 }, () => {
          a.away = true;
          a.alpha = 0;
          a.doing = "raid";
        });
      });
    });
  };
  out.forEach((a, i) => {
    lead(a);
    a.doing = "gate";
    walkTo(a, MUSTER[i] ?? { x: 256, y: 116 }, () => {
      a.dir = 3;
      here++;
      if (here === out.length) go();
    });
  });
  hooks.feed("A raid party musters at the gate.", "coral");
  after(9, go);
}

function raidBack(who: readonly string[], raid: string, leaf: number): void {
  const back = named(who);
  if (back.length === 0) return;
  if (back.some((a) => !a.away)) {
    // Still on their way out: give them a moment, then try again.
    after(3, () => {
      raidBack(who, raid, leaf);
    });
    return;
  }
  G.raidsToday++;
  let cheered = false;
  const home = (): void => {
    if (cheered) return;
    cheered = true;
    sfx.fanfare();
    hooks.feed(`Raid cleared: ${raid}. ${leaf} Leaf each.`, "coral");
    cheerAll();
    back.forEach((a, i) => {
      hop(a, 3);
      if (i === 2) say(a, "no gg left behind!", 2.2);
    });
    const leader = back[0];
    after(1.3, () => {
      for (const a of back.slice(1)) letGo(a);
      if (!leader) return;
      walkTo(leader, { x: 340, y: 216 }, () => {
        leader.dir = 2;
        hangLantern({ x: leader.x + 4, y: leader.y - 10 });
        say(leader, "one more for the tree", 2.4);
        after(1.6, () => {
          letGo(leader);
        });
      });
    });
  };
  back.forEach((a, i) => {
    a.away = false;
    a.x = 249 + (i % 2) * 13;
    a.y = 85;
    a.alpha = 0;
    a.doing = "walk";
    after(i * 0.35, () => {
      walkTo(a, MUSTER[i] ?? { x: 256, y: 116 }, i === 0 ? home : null);
    });
  });
  after(6, home);
}

function land(name: string): void {
  raiseBanner(name);
  G.lands++;
  sfx.fanfare();
  hooks.feed(`The guild has taken ${name}.`, "rose");
  after(0.7, () => {
    cheerAll(["glory to the grove!", "ours now!", "woo!", "huge", "be nice to them"]);
  });
}

function levelUp(who: string, level: number): void {
  const a = G.mates.find((m) => m.who.name === who);
  if (!a) return;
  a.who = { ...a.who, level };
  hooks.feed(`${who} reached level ${level}.`, "leaf");
  if (a.away) return;
  sfx.levelUp();
  sparkle(a.x, a.y - 10, 20, 7);
  burst(a.x, a.y - 14, 14, [GOLD[1], CREAM, SKY[5]], 44);
  float(a.x, a.y - 32, `Level ${level}!`, GOLD[2], 2.2);
  hop(a, 3);
  say(a, "ding!", 2);
  let wishes = 0;
  for (const b of inTown()) {
    if (b === a || wishes >= 3 || dist(a.x, a.y, b.x, b.y) > 90) continue;
    wishes++;
    const mine = wishes;
    if (!b.moving && !b.seat) face(b, a.x, a.y);
    after(0.5 + mine * 0.4, () => {
      hop(b);
      say(b, mine % 2 ? "grats!" : "grats!!", 2);
    });
  }
}

function stage(h: Happening): void {
  switch (h.kind) {
    case "raidOut":
      raidOut(h.who, h.raid);
      return;
    case "raidBack":
      raidBack(h.who, h.raid, h.leaf);
      return;
    case "land":
      land(h.name);
      return;
    case "level":
      levelUp(h.who, h.level);
      return;
    case "quest":
      hooks.feed(h.text, h.tone);
      changed();
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
  for (let i = later.length - 1; i >= 0; i--) {
    const l = later[i];
    if (!l || G.t < l.at) continue;
    later.splice(i, 1);
    l.fn();
  }
  // Whoever is in the gateway is half in the dark beyond it.
  const all = G.player ? [G.player, ...G.mates] : G.mates;
  for (const a of all) {
    if (a.away || (a.you && G.inDoor)) continue;
    a.alpha = a.y < 98 ? clamp((a.y - 84) / 12, 0, 1) : 1;
  }
}
