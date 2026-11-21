/**
 * The guild, live: every twenty seconds or so something happens out in the game, and the town shows
 * it. A party musters at the gate and leaves; it comes back and hangs a lantern; a territory is won
 * and the banner goes up; somebody levels. All of it is made up here.
 */

import { CREAM, GOLD, SKY } from "@sequoia-leaf/kit/palette.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { clamp, dist, pick } from "@sequoia-leaf/kit/util.ts";

import { cheerAll, face, hop, inTown, lead, letGo, onScreen, say, walkTo } from "./actors.ts";
import { LANDS, RAIDS } from "./cast.ts";
import { burst, float, sparkle } from "./fx.ts";
import { type Actor, changed, G, hooks } from "./game.ts";
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

export type Moment = "level" | "raidOut" | "raidBack" | "land";
const ORDER: readonly Moment[] = ["level", "raidOut", "raidBack", "land"];
let turn = 0;
let nextAt = Infinity;
let party: Actor[] = [];
let raid = "";

const names = (who: readonly Actor[]): string => {
  const n = who.map((a) => a.who.name);
  return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1] ?? ""}`;
};

function raidOut(): void {
  if (party.length > 0) return;
  const pool = inTown().filter((a) => a.mode !== "led");
  if (pool.length < 4) return;
  party = [];
  while (party.length < 4) {
    const a = pick(pool, Math.random());
    if (!party.includes(a)) party.push(a);
  }
  raid = RAIDS[G.raidsToday % RAIDS.length] ?? "a raid";
  const out = party;
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
    if (first) say(first, pick(["ready?", "buffs up"], Math.random()), 1.5);
    after(0.8, () => {
      if (third) say(third, pick(["go go go", "no gg left behind"], Math.random()), 1.5);
    });
    after(1.7, () => {
      hooks.feed(`${names(out)} set out for ${raid}.`, "raid");
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
  hooks.feed(`A raid party is mustering at the gate for ${raid}.`, "raid");
  after(9, go);
}

function raidBack(): void {
  const back = party;
  if (back.length === 0) return;
  if (back.some((a) => !a.away)) {
    // Still on their way out: give them a moment, then try again.
    after(3, raidBack);
    return;
  }
  party = [];
  G.raidsToday++;
  let cheered = false;
  const home = (): void => {
    if (cheered) return;
    cheered = true;
    sfx.fanfare();
    hooks.feed(`Raid cleared: ${raid}. ${names(back)} are back with 12 Leaf apiece.`, "raid");
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

function land(): void {
  const name = LANDS[G.lands % LANDS.length] ?? "new ground";
  raiseBanner(name);
  G.lands++;
  sfx.fanfare();
  hooks.feed(`The guild has taken ${name}. The banner goes up.`, "land");
  after(0.7, () => {
    cheerAll(["glory to the grove!", "ours now!", "woo!", "huge", "be nice to them"]);
  });
  const q = G.quests[2];
  if (q && !q.claimed && q.have < q.need) {
    q.have = Math.min(q.need, q.have + 11);
    if (q.have === q.need)
      hooks.feed("You helped hold a territory for an hour. The board has something for you.", "leaf");
  }
  changed();
}

function levelUp(): void {
  const pool = inTown().filter((a) => a.mode !== "led");
  if (pool.length === 0) return;
  const seen = pool.filter((a) => onScreen(a.x, a.y, -10));
  const a = pick(seen.length > 0 ? seen : pool, Math.random());
  a.who.level++;
  sfx.levelUp();
  sparkle(a.x, a.y - 10, 20, 7);
  burst(a.x, a.y - 14, 14, [GOLD[1], CREAM, SKY[5]], 44);
  float(a.x, a.y - 32, `Level ${a.who.level}!`, GOLD[2], 2.2);
  hop(a, 3);
  say(a, "ding!", 2);
  let wishes = 0;
  for (const b of inTown()) {
    if (b === a || wishes >= 3 || dist(a.x, a.y, b.x, b.y) > 90) continue;
    wishes++;
    if (!b.moving && !b.seat) face(b, a.x, a.y);
    after(0.5 + wishes * 0.4, () => {
      hop(b);
      say(b, wishes % 2 ? "grats!" : "grats!!", 2);
    });
  }
  hooks.feed(`${a.who.name} reached level ${a.who.level}.`, "level");
}

export function happen(kind: Moment): void {
  if (kind === "raidOut") raidOut();
  else if (kind === "raidBack") raidBack();
  else if (kind === "land") land();
  else levelUp();
}

/** The evening begins: the first thing happens soon, so that nobody waits long to see one. */
export function beginEvents(): void {
  nextAt = G.t + 7;
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
  for (const a of all) if (!a.away) a.alpha = a.y < 98 ? clamp((a.y - 84) / 12, 0, 1) : 1;
  if (G.home && G.t >= nextAt) {
    happen(ORDER[turn % ORDER.length] ?? "level");
    turn++;
    nextAt = G.t + 18 + Math.random() * 4;
  }
}
