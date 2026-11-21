/**
 * What sits over the town, built from the kit: the purse, the dock, the guild feed, a card for
 * whoever was tapped, the arrival letter, and a panel for each place. What a button does still
 * lands in the town behind it.
 */

import { add, el, icon as glyph, type IconName, replay, shown } from "@sequoia-leaf/kit/dom.ts";
import { CREAM, GOLD, GREEN, WATER } from "@sequoia-leaf/kit/palette.ts";
import { balance, type Currency, earn, grant, spend } from "@sequoia-leaf/kit/purse.ts";
import { isMuted, setMuted, sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip, tipOff } from "@sequoia-leaf/kit/tip.ts";
import { dist, makeCanvas, must, pick, type Pt } from "@sequoia-leaf/kit/util.ts";

import { callToFire, goSit, hop, inTown, release, say, sitters } from "./actors.ts";
import { DOING, KEEPER } from "./cast.ts";
import { show } from "./draw.ts";
import { after } from "./events.ts";
import { bit, float, flutter, puff, sparkle } from "./fx.ts";
import { type Actor, changed, G, hooks, type PanelId, watch } from "./game.ts";
import { GAMES, isGame } from "./games.ts";
import { type AwayLine, guild, type Listing, type Quest, type Tone, type Ware } from "./guild.ts";
import type { Letter } from "./letter.ts";
import { icon, type Sprites } from "./sprites.ts";
import { flare, nudgeCrab, ringBell, rollCall } from "./town.ts";
import { place, type PlaceId, PLACES } from "./world.ts";

type Kid = Node | string | null;

const $ = (id: string): HTMLElement => must(document.getElementById(id), id);

/** A copy of a small picture, shown `scale` interface units to each of its pixels. */
function pic(src: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return shown(c, scale);
}

/** A hollow `size` units square, holding one thing. */
function slot(inside: Node | null, size = 20): HTMLElement {
  const s = el("div", "k-slot");
  s.style.width = `calc(var(--u) * ${size})`;
  s.style.height = s.style.width;
  s.style.flex = "none";
  add(s, inside);
  return s;
}

function button(cls: string, kids: readonly Kid[], on: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", `k-btn ${cls}`, { type: "button" }, ...kids);
  b.addEventListener("click", () => {
    on(b);
  });
  return b;
}

/** Redraws a part of a panel only when what it shows has changed. */
function when(key: () => string, draw: () => void): () => void {
  let last: string | null = null;
  return () => {
    const k = key();
    if (k === last) return;
    last = k;
    draw();
  };
}

const centre = (node: Element): Pt => {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

let S: Sprites | null = null;

// ---------- the purse ----------

interface Counter {
  num: HTMLElement;
  art: HTMLElement;
  shown: number;
}
const counters: Partial<Record<Currency, Counter>> = {};
let tickAt = 0;

function counter(kind: Currency, title: string, about: string): Counter {
  const art = glyph(kind === "leaf" ? "leaf" : "coin");
  const num = el("span", "", { text: balance()[kind] });
  const box = el("span", kind === "leaf" ? "k-cur leaf" : "k-cur", { tabindex: 0 }, art, num);
  $("purse").append(box);
  tip(box, title, about);
  return { num, art, shown: balance()[kind] };
}

function purseAt(kind: Currency): Pt {
  const c = counters[kind];
  return c ? centre(c.art) : { x: 30, y: 30 };
}

function bump(kind: Currency): void {
  const c = counters[kind];
  if (c) replay(c.art, "k-bump");
}

function roll(kind: Currency, dt: number): void {
  const c = counters[kind];
  if (!c) return;
  const real = balance()[kind];
  if (c.shown === real) return;
  const d = real - c.shown;
  c.shown += Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.ceil(Math.abs(d) * dt * 5)));
  c.num.textContent = String(c.shown);
  const now = performance.now();
  if (d > 0 && now > tickAt) {
    tickAt = now + 70;
    if (kind === "leaf") sfx.leaf(c.shown);
    else sfx.coin(c.shown);
  }
}

/** Little pictures that fly from one spot on the page to another: Leaf leaving the purse, Coins arriving. */
function fly(what: IconName, from: Pt, to: Pt, count: number, each: ((i: number) => void) | null = null): void {
  for (let i = 0; i < count; i++) {
    const c = glyph(what);
    c.classList.add("fly");
    document.body.append(c);
    const half = c.getBoundingClientRect().width / 2;
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 90;
    const midY = Math.min(from.y, to.y) - 24 - Math.random() * 46;
    const tr = (x: number, y: number, s: number): string => `translate(${x - half}px, ${y - half}px) scale(${s})`;
    const anim = c.animate(
      [
        { transform: tr(from.x, from.y, 0.5), opacity: 0 },
        { transform: tr(from.x, from.y, 1.1), opacity: 1, offset: 0.12 },
        { transform: tr(midX, midY, 1.3), opacity: 1, offset: 0.55 },
        { transform: tr(to.x, to.y, 0.7), opacity: 1 },
      ],
      { duration: 640, delay: i * 75, easing: "ease-in-out", fill: "both" },
    );
    anim.addEventListener("finish", () => {
      c.remove();
      each?.(i);
    });
  }
}

/** Takes the price in Leaf if the purse holds it, with Leaf flying from the purse to the button. */
function payLeaf(b: HTMLElement, price: number, why: string): boolean {
  if (!spend("leaf", price, why)) {
    sfx.no();
    replay(b, "shake");
    return false;
  }
  sfx.buy();
  fly("leaf", purseAt("leaf"), centre(b), Math.min(7, 2 + Math.floor(price / 10)));
  return true;
}

// ---------- the guild feed ----------

const waiting: (readonly [string, Tone])[] = [];
let quiet = false;

function feed(text: string, tone: Tone = "gold"): void {
  if (quiet) {
    waiting.push([text, tone]);
    while (waiting.length > 3) waiting.shift();
    return;
  }
  const f = $("feed");
  const row = el("div", tone === "gold" ? "k-toast" : `k-toast ${tone}`, { text });
  f.append(row);
  while (f.children.length > 3) f.firstElementChild?.remove();
  setTimeout(() => {
    row.classList.add("gone");
  }, 11000);
  setTimeout(() => {
    row.remove();
  }, 12000);
}

/**
 * While the member is inside a game the interface is put away and news is held back; on the way
 * out it comes back, and what was held is said.
 */
export function hush(on: boolean): void {
  quiet = on;
  document.body.classList.toggle("inside", on);
  if (on) {
    tipOff();
    return;
  }
  for (const [text, tone] of waiting.splice(0)) feed(text, tone);
}

// ---------- what buying things does in the town ----------

function nearby(p: Actor, words: readonly string[], reach = 70): void {
  let n = 0;
  for (const a of inTown()) {
    if (n >= 2 || dist(a.x, a.y, p.x, p.y) > reach) continue;
    const mine = n++;
    after(0.4 + mine * 0.4, () => {
      hop(a);
      say(a, words[mine % words.length] ?? "ooh", 2.2);
    });
  }
}

function cocoa(): void {
  const at = sitters("fire");
  puff(256, 200, 8, CREAM, 16);
  hooks.feed("You stood the fire a round of cocoa.", "leaf");
  const thanks = ["cheers!", "cocoa!!", "thank you!", "you're the best", "\u2665"];
  at.forEach((a, i) => {
    a.mug = 40;
    hop(a, 2);
    if (!a.you)
      after(0.3 + i * 0.3, () => {
        say(a, thanks[i % thanks.length] ?? "cheers!", 2.4);
      });
  });
  // Nobody there to drink it: the word gets round.
  let sent = at.filter((a) => !a.you).length;
  for (const a of inTown()) {
    if (sent >= 3) break;
    if (!callToFire(a)) continue;
    a.mug = 60;
    say(a, sent === 0 ? "cocoa?!" : "coming!!", 2.2);
    hop(a);
    sent++;
  }
}

/** What each thing does the moment it is the member's; anything the town has no flourish for just sparkles. */
const GOT: Readonly<Record<string, (p: Actor) => void>> = {
  crown: (p) => {
    sparkle(p.x, p.y - 20, 18, 6);
    hop(p, 2);
    nearby(p, ["ooh, fancy", "nice hat"]);
  },
  jar: (p) => {
    for (let i = 0; i < 12; i++) {
      const k = 0.5 + Math.random() * 0.5;
      bit({
        x: 104,
        y: 104,
        vx: (p.x - 104) / k + (Math.random() - 0.5) * 36,
        vy: (p.y - 12 - 104) / k + (Math.random() - 0.5) * 36,
        ttl: k,
        col: GOLD[2],
        glow: true,
        flutter: 1,
      });
    }
    hop(p);
    nearby(p, ["pretty!", "ooh"]);
  },
  cocoa,
  bread: (p) => {
    nearby(p, ["that smells amazing", "save me a bit"], 90);
  },
  run: () => {
    hooks.feed("You're down for the Hollow Vault tonight.", "coral");
  },
  plate: (p) => {
    sparkle(p.x, p.y - 26, 14, 9);
  },
  water: (p) => {
    sfx.plop();
    float(p.x, p.y - 30, "...oOo...", WATER[3], 2.4);
  },
};

function got(thing: Ware | Listing): void {
  if (thing.worn) G.wearing.add(thing.id);
  const p = G.player;
  if (!p) return;
  const fn = GOT[thing.id];
  if (fn) fn(p);
  else sparkle(p.x, p.y - 20, 10, 6);
}

// ---------- the Treasury ----------

function wareArt(id: string): HTMLCanvasElement | null {
  if (!S) return null;
  if (id === "crown") return pic(S.crown, 2);
  if (id === "jar") return pic(S.jar, 2);
  if (id === "cocoa") return pic(S.mug, 3);
  return null;
}

function treasury(body: HTMLElement): () => void {
  const keeper = guild.keeper();
  const line = el("span", "", { text: KEEPER.hello });
  const face = slot(G.cinfy ? pic(G.cinfy.body.face, 3) : null, 28);
  face.classList.add("nod");
  body.append(
    el("div", "k-row", {}, face, el("div", "k-say left k-grow", {}, el("b", "", { text: keeper.name }), line)),
  );
  const speak = (long: string, short: string): void => {
    line.textContent = long;
    replay(face, "hop");
    if (G.cinfy) {
      say(G.cinfy, short, 2.4);
      hop(G.cinfy);
    }
  };
  const parts = guild.wares().map((w) => {
    const side = el("span");
    const row = el(
      "div",
      "k-card",
      {},
      slot(wareArt(w.id) ?? glyph("star")),
      el("div", "k-grow", {}, w.name, el("div", "k-d", { text: w.about })),
      side,
    );
    body.append(row);
    return when(
      () => String(w.once && G.owned.has(w.id)),
      () => {
        if (w.once && G.owned.has(w.id)) {
          side.replaceChildren(el("span", "k-chip", { text: "Yours" }));
          return;
        }
        const buy = button("leaf sm", [glyph("leaf"), String(w.price)], (b) => {
          if (!payLeaf(b, w.price, w.name)) {
            speak(KEEPER.short[0], KEEPER.short[1]);
            return;
          }
          if (w.once) G.owned.add(w.id);
          ringBell();
          got(w);
          speak(w.thanks[0], w.thanks[1]);
          changed();
        });
        tip(buy, `${w.price} Leaf`, w.once ? "Yours to keep." : "As often as you like.");
        side.replaceChildren(buy);
      },
    );
  });
  return () => {
    for (const f of parts) f();
  };
}

// ---------- the quest board ----------

const paysWhat = (q: Quest): string => (q.pays === "leaf" ? "Leaf" : "Coins");

function claim(q: Quest, b: HTMLElement): void {
  G.claimed.add(q.id);
  const why = `the quest board: ${q.title}`;
  if (q.pays === "leaf") grant(q.reward, why);
  else earn(q.reward, why);
  fly(q.pays === "leaf" ? "leaf" : "coin", centre(b), purseAt(q.pays), 7, () => {
    bump(q.pays);
  });
  sfx.cheer();
  // The note comes off the board in a flurry.
  flutter(198, 140, 12, [CREAM, GOLD[1], GREEN[4]], 14, 30);
  sparkle(198, 138, 10, 10);
  if (G.player) hop(G.player, 2);
  hooks.feed(`You claimed ${q.reward} ${paysWhat(q)} from the board.`, q.pays === "leaf" ? "leaf" : "gold");
  changed();
}

function quests(body: HTMLElement): () => void {
  const parts = guild.quests().map((first) => {
    const fill = el("i");
    const count = el("span", "k-dim k-grow");
    const side = el("span", "k-row");
    const note = el(
      "div",
      "k-paper quest",
      {},
      el("div", "", { text: first.title }),
      el("div", first.pays === "leaf" ? "k-bar leaf" : "k-bar", {}, fill),
      el("div", "k-row", {}, count, side),
    );
    body.append(note);
    const now = (): Quest => guild.quests().find((q) => q.id === first.id) ?? first;
    return when(
      () => `${now().have}/${G.claimed.has(first.id)}`,
      () => {
        const q = now();
        const done = G.claimed.has(q.id);
        const ready = q.have >= q.need;
        fill.style.setProperty("--v", `${Math.min(100, (q.have / q.need) * 100)}%`);
        count.textContent = `${q.have} / ${q.need} ${q.unit}`;
        note.classList.toggle("done", done);
        const prize = el(
          "span",
          "k-chip",
          {},
          el(
            "span",
            q.pays === "leaf" ? "k-cur leaf" : "k-cur",
            {},
            glyph(q.pays === "leaf" ? "leaf" : "coin"),
            q.reward,
          ),
        );
        if (done) side.replaceChildren(el("span", "k-chip lit", {}, glyph("check"), "Claimed"));
        else if (ready)
          side.replaceChildren(
            prize,
            button("sm", ["Claim"], (b) => {
              claim(q, b);
            }),
          );
        else side.replaceChildren(prize);
      },
    );
  });
  return () => {
    for (const f of parts) f();
  };
}

// ---------- the market ----------

function market(body: HTMLElement): () => void {
  const parts = guild.stalls().map((it) => {
    const seller = G.mates.find((a) => a.who.name === it.by);
    const side = el("span");
    const row = el(
      "div",
      "k-card",
      { tabindex: 0 },
      slot(seller ? pic(seller.body.face, 2) : glyph("heart")),
      el("div", "k-grow", {}, it.what, el("div", "k-d", { text: it.by })),
      side,
    );
    tip(row, it.what, `${it.about} From ${it.by}.`);
    body.append(row);
    return when(
      () => String(G.owned.has(it.id)),
      () => {
        if (G.owned.has(it.id)) {
          side.replaceChildren(el("span", "k-chip", { text: "Yours" }));
          return;
        }
        side.replaceChildren(
          button("leaf sm", [glyph("leaf"), String(it.price)], (b) => {
            if (!payLeaf(b, it.price, `${it.what}, from ${it.by}`)) return;
            G.owned.add(it.id);
            if (seller && !seller.away) {
              hop(seller, 2);
              say(seller, it.word, 2.6);
            }
            if (G.player) hop(G.player);
            got(it);
            changed();
          }),
        );
      },
    );
  });
  return () => {
    for (const f of parts) f();
  };
}

// ---------- the doors into the games ----------

/** A game's card: what it is, what is waiting there, and the way in. */
function doorCard(id: "works" | "table"): (body: HTMLElement) => null {
  return (body) => {
    const game = GAMES[id];
    const go = button("wide", [game.go], () => {
      hooks.goIn(id);
    });
    body.append(
      el("div", "k-row", {}, slot(shown(icon(id), 2), 34), el("div", "k-grow", { text: game.about })),
      el(
        "div",
        "k-paper",
        {},
        el("div", "k-label", { text: "Waiting for you" }),
        el("div", "", { text: game.waiting() }),
      ),
      go,
    );
    return null;
  };
}

// ---------- the campfire ----------

const EMOTES: readonly (readonly [string, string, readonly string[]])[] = [
  ["Wave", "o/", ["o/", "hi hi", "\\o"]],
  ["Cheer", "woo!", ["woo!", "yeah!", "glory to the grove!"]],
  ["Laugh", "ha ha!", ["ha!", "pfff", "erm. ha."]],
  ["Heart", "\u2665", ["\u2665", "aww", "\u2665 \u2665"]],
  ["Yawn", "*yawn*", ["zzz", "same", "go to bed"]],
];

function emote(word: string, replies: readonly string[], note: number): void {
  const p = G.player;
  if (!p) return;
  say(p, word, 1.8);
  hop(p);
  sfx.pluck(3 + note);
  let n = 0;
  for (const a of inTown()) {
    if (n >= 3 || dist(a.x, a.y, p.x, p.y) > 84) continue;
    const mine = n++;
    after(0.5 + mine * 0.35, () => {
      hop(a);
      say(a, replies[mine % replies.length] ?? "!", 2);
    });
  }
}

function fireside(body: HTMLElement): () => void {
  const list = el("div", "k-wrap");
  const seat = el("span");
  body.append(
    el("div", "k-label", { text: "By the fire" }),
    list,
    el(
      "div",
      "k-wrap",
      {},
      seat,
      button("wood", ["Add a log"], () => {
        flare();
        if (G.player) nearby(G.player, ["toasty", "ooh"], 90);
      }),
    ),
    el("div", "k-label", { text: "Say it" }),
    el(
      "div",
      "k-wrap",
      {},
      ...EMOTES.map(([name, word, replies], i) =>
        button("wood sm", [name], () => {
          emote(word, replies, i);
        }),
      ),
    ),
  );
  return when(
    () =>
      `${sitters("fire")
        .map((a) => a.who.name)
        .join()}|${G.player?.seat ? "s" : G.player?.goal ? "g" : "n"}`,
    () => {
      const at = sitters("fire");
      list.replaceChildren(
        ...(at.length > 0
          ? at.map((a) => el("span", a.you ? "k-chip lit" : "k-chip", {}, pic(a.body.face, 1), a.who.name))
          : [el("span", "k-d", { text: "Nobody yet. It's all yours." })]),
      );
      const p = G.player;
      seat.replaceChildren(
        p?.seat
          ? button("wood", ["Stand up"], () => {
              release(p);
              sfx.tap();
            })
          : button("", [p?.goal ? "On your way" : "Sit down"], (b) => {
              if (!goSit(null)) {
                sfx.no();
                replay(b, "shake");
              }
            }),
      );
    },
  );
}

// ---------- the crab pond ----------

const CRAB_NOTES = [
  "asleep",
  "being loud",
  "wearing a leaf",
  "suspiciously still",
  "counting you back",
  "walking sideways",
  "damp",
  "smug",
  "busy",
];

function pond(body: HTMLElement): () => void {
  const tiles: HTMLElement[] = [];
  const said = el("div", "k-d", { text: "Tap a crab to check on it." });
  const tally = el("div", "k-d");
  const grid = el("div", "crabs");
  for (let n = 1; n <= 9; n++) {
    const lost = n === G.lostCrab;
    const note = lost ? "unaccounted for" : (CRAB_NOTES[n - 1] ?? "busy");
    const art = S?.crab[0] && !lost ? pic(S.crab[0].c, 2) : el("span", "k-coral gap", { text: "?" });
    const tile = el("button", lost ? "k-card done" : "k-card", { type: "button" }, art, `No. ${n}`);
    tile.addEventListener("click", () => {
      nudgeCrab(n);
      said.textContent = `No. ${n} is ${note}.`;
      replay(tile, "k-bump");
    });
    tip(tile, `Crab No. ${n}`, lost ? "Never at roll call. Seen about town." : `Present. ${note}.`);
    tiles.push(tile);
    grid.append(tile);
  }
  body.append(
    button("", ["Call the roll"], () => {
      rollCall();
      said.textContent = `Eight answer. No. ${G.lostCrab} does not.`;
      tiles.forEach((tile, i) => {
        setTimeout(() => {
          tile.classList.add("lit");
          setTimeout(() => {
            tile.classList.remove("lit");
          }, 420);
        }, i * 380);
      });
    }),
    grid,
    said,
    tally,
  );
  return when(
    () => String(G.sightings),
    () => {
      const times = G.sightings === 1 ? "once" : `${G.sightings} times`;
      tally.textContent =
        G.sightings === 0
          ? `Nobody has spotted No. ${G.lostCrab} yet.`
          : `You have spotted No. ${G.lostCrab} ${times}.`;
    },
  );
}

// ---------- your camp, and you ----------

function camp(body: HTMLElement): null {
  body.append(
    el(
      "div",
      "k-row",
      {},
      slot(shown(icon("camp"), 2), 34),
      el("div", "k-grow", { text: "The path to your own camp." }),
    ),
    el("div", "k-d", { text: "Not built yet. The rope is still across the path, and Mossback left a mushroom by it." }),
    button("wood", ["Wave down the path"], () => {
      const p = G.player;
      if (!p) return;
      say(p, "o/", 1.6);
      hop(p);
      sfx.pluck(5);
      after(1.1, () => {
        float(256, 70, "something small waves back", CREAM, 2.6);
        sfx.pluck(9);
      });
    }),
  );
  return null;
}

/** Everything that can be worn or carried, by what the town calls it. */
function things(): Map<string, Ware | Listing> {
  const all = new Map<string, Ware | Listing>();
  for (const t of [...guild.wares(), ...guild.stalls()]) all.set(t.id, t);
  return all;
}
const nameOf = (t: Ware | Listing): string => ("name" in t ? t.name : t.what);

function profile(body: HTMLElement): () => void {
  const me = guild.me();
  const p = G.player;
  const portrait = makeCanvas(12, 24);
  const frame = p?.body.frames[0]?.[0];
  if (frame) portrait.g.drawImage(frame, 0, 0);
  if (G.wearing.has("crown") && S) portrait.g.drawImage(S.crown, 2, 0);
  const xp = el("i");
  xp.style.setProperty("--v", `${Math.min(100, (me.xp / me.next) * 100)}%`);
  const worn = el("div", "k-col");
  body.append(
    el(
      "div",
      "k-row",
      {},
      slot(shown(portrait.c, 2), 52),
      el(
        "div",
        "k-grow k-col",
        {},
        el("div", "k-title big", { text: me.name }),
        el("div", "k-d", { text: `${me.rank} of the guild` }),
        el("div", "k-bar", {}, xp),
        el("div", "k-d", { text: `Level ${me.level}` }),
      ),
    ),
    el(
      "div",
      "k-wrap",
      {},
      ...me.ranks.map((r) => {
        const chip = el("span", r === me.rank ? "k-chip lit" : "k-chip", { text: r, tabindex: 0 });
        if (r === me.rank)
          tip(chip, r, `${me.xp.toLocaleString("en")} of ${me.next.toLocaleString("en")} to the next level.`);
        return chip;
      }),
    ),
    el("div", "k-card", {}, el("div", "k-grow", {}, "This week", el("div", "k-d", { text: me.week.join(", ") }))),
    el("div", "k-label", { text: "Yours" }),
    worn,
  );
  return when(
    () => `${[...G.owned].join()}|${[...G.wearing].join()}`,
    () => {
      const all = things();
      const mine = [...G.owned].flatMap((id) => {
        const t = all.get(id);
        return t ? [t] : [];
      });
      if (mine.length === 0) {
        worn.replaceChildren(el("div", "k-d", { text: "Nothing yet. Cinfy can fix that." }));
        return;
      }
      worn.replaceChildren(
        ...mine.map((t) => {
          const on = G.wearing.has(t.id);
          const side = t.worn
            ? button(on ? "sm" : "wood sm", [on ? "On" : "Off"], () => {
                if (on) G.wearing.delete(t.id);
                else G.wearing.add(t.id);
                sfx.tap();
                if (G.player) hop(G.player);
                changed();
              })
            : el("span", "k-chip", { text: "Kept" });
          if (t.worn) tip(side, nameOf(t), on ? "Showing. Tap to put it away." : "Put away. Tap to show it.");
          return el("div", "k-card", {}, el("div", "k-grow", { text: nameOf(t) }), side);
        }),
      );
    },
  );
}

// ---------- panels ----------

const BUILD: Record<PanelId, (body: HTMLElement) => (() => void) | null> = {
  treasury,
  quests,
  market,
  works: doorCard("works"),
  table: doorCard("table"),
  fire: fireside,
  pond,
  camp,
  profile,
};

let refresh: (() => void) | null = null;
const dockButtons = new Map<PlaceId, HTMLElement>();

function markDock(): void {
  for (const [id, b] of dockButtons) {
    const lit = G.panel === id || (G.panel === null && G.near === id);
    b.classList.toggle("lit", lit);
    if (lit) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
  document.body.classList.toggle("panel-open", G.panel !== null);
}

export function openPanel(id: PanelId): void {
  if (G.panel === id) return;
  closeCard();
  tipOff();
  G.panel = id;
  const p = $("panel");
  p.hidden = true;
  p.replaceChildren();
  const x = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closePanel },
    glyph("close"),
  );
  const face = G.player?.body.face;
  const art = id === "profile" ? (face ? pic(face, 2) : null) : shown(icon(id), 1);
  const title = id === "profile" ? "You" : place(id).name;
  p.append(el("header", "k-head", {}, art, el("h2", "k-title", { text: title }), x));
  const body = el("div", "k-body k-scroll");
  p.append(body);
  refresh = BUILD[id](body);
  refresh?.();
  p.hidden = false;
  replay(p, "slide");
  sfx.open();
  markDock();
  if (isGame(id)) body.querySelector<HTMLElement>(".k-btn.wide")?.focus({ preventScroll: true });
}

export function closePanel(): void {
  if (!G.panel) return;
  G.panel = null;
  $("panel").hidden = true;
  $("panel").replaceChildren();
  refresh = null;
  tipOff();
  sfx.close();
  markDock();
}

/** The part of the page a panel is covering, so the camera can keep the member clear of it. */
export function panelBox(): DOMRect | null {
  return G.panel ? $("panel").getBoundingClientRect() : null;
}

// ---------- a guild-mate's card ----------

let cardUntil = 0;
let doingEl: HTMLElement | null = null;

function keep(): void {
  cardUntil = performance.now() + 7000;
}

export function closeCard(): void {
  show.card = null;
  $("card").hidden = true;
}

export function showCard(a: Actor): void {
  const c = $("card");
  c.hidden = true;
  c.replaceChildren();
  const x = el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: closeCard },
    glyph("close"),
  );
  doingEl = el("div", "k-d");
  const shop = a === G.cinfy;
  c.append(
    el(
      "div",
      "k-row top",
      {},
      slot(pic(a.body.face, 3), 28),
      el(
        "div",
        "k-grow",
        {},
        el("div", "k-title", { text: a.who.name }),
        el("div", "k-d", { text: shop ? a.who.rank : `${a.who.rank}, level ${a.who.level}` }),
      ),
      x,
    ),
    doingEl,
    el(
      "div",
      "k-row",
      {},
      button("sm", ["Wave"], () => {
        keep();
        const p = G.player;
        if (p) {
          say(p, "o/", 1.4);
          hop(p);
        }
        after(0.45, () => {
          hop(a, 2);
          say(a, pick(["o/", "hi hi!", "heya!", "\\o/"], Math.random()), 2);
        });
      }),
      shop
        ? button("wood sm", ["Treasury"], () => {
            hooks.visit("treasury", true);
          })
        : button("wood sm", ["Cheer"], () => {
            keep();
            sfx.cheer();
            if (G.player) hop(G.player, 2);
            after(0.3, () => {
              hop(a, 3);
              say(a, pick(["woo!", "glory to the grove!", "no gg left behind!"], Math.random()), 2);
            });
          }),
    ),
  );
  show.card = a;
  keep();
  c.hidden = false;
  replay(c, "k-rise");
}

// ---------- arrival ----------

let arrived: (() => void) | null = null;

function lineArt(l: AwayLine): Node {
  if (l.art === "leaf" || l.art === "coin") return glyph(l.art);
  if (l.art === "banner") return glyph("star");
  if (l.art === "crab" && S?.crab[0]) return pic(S.crab[0].c, 1);
  const faces = (l.who ?? []).flatMap((name) => {
    const a = G.mates.find((m) => m.who.name === name);
    return a ? [pic(a.body.face, 1)] : [];
  });
  return faces.length > 0 ? el("span", "k-row faces", {}, ...faces) : glyph("heart");
}

/** The letter that meets the member at the gate. Putting it away pays what it says into the purse. */
export function showArrival(letter: Letter, done: () => void): void {
  const root = $("arrival");
  const paper = el(
    "div",
    "k-paper k-rise letter",
    { role: "dialog", "aria-label": letter.title },
    el("h1", "k-title big", { text: letter.title }),
    el("div", "k-dim", { text: letter.sub }),
  );
  const paying: { art: Node; pay: NonNullable<AwayLine["pay"]> }[] = [];
  const rows: HTMLElement[] = [];
  for (const l of letter.lines) {
    const art = lineArt(l);
    const row = el(
      "div",
      "line",
      {},
      el("hr"),
      el(
        "div",
        "k-row",
        {},
        art,
        el("span", "k-grow", { text: l.text }),
        l.pay ? el("b", "", { text: `+${l.pay.amount}` }) : null,
      ),
    );
    if (l.pay) paying.push({ art, pay: l.pay });
    rows.push(row);
    paper.append(row);
  }
  // The lines arrive one at a time.
  rows.forEach((row, i) => {
    setTimeout(
      () => {
        row.classList.add("in");
        if (!arrived) return;
        sfx.paper();
      },
      420 + i * 300,
    );
  });
  const go = el("button", "k-btn wide", { type: "button", text: "Into town" });
  paper.append(el("hr"), go);
  root.append(paper);
  root.hidden = false;
  arrived = (): void => {
    arrived = null;
    for (const row of rows) row.classList.add("in");
    const from = paying.map((x) => (x.art instanceof Element ? centre(x.art) : centre(paper)));
    root.classList.add("gone");
    setTimeout(() => {
      root.remove();
    }, 400);
    sfx.open();
    paying.forEach(({ pay }, i) => {
      const at = from[i] ?? centre(paper);
      if (pay.kind === "leaf") grant(pay.amount, "the guild, while you were away");
      else earn(pay.amount, "the Works, while you were away");
      fly(pay.kind === "leaf" ? "leaf" : "coin", at, purseAt(pay.kind), 7, () => {
        bump(pay.kind);
      });
    });
    done();
  };
  root.addEventListener("click", () => {
    arrived?.();
  });
}

export function dismissArrival(): boolean {
  if (!arrived) return false;
  arrived();
  return true;
}

// ---------- setting up, and each moment ----------

let faceButton: HTMLElement | null = null;

/** The member's face on the profile button, redrawn once their own skin has loaded. */
export function refreshFace(): void {
  const f = G.player?.body.face;
  if (faceButton && f) faceButton.replaceChildren(pic(f, 1.5));
}

export function initUI(sprites: Sprites): void {
  S = sprites;
  counters.leaf = counter("leaf", "Leaf", "Earned with the guild, out in the world.");
  counters.coins = counter("coins", "Coins", "Made in town: the Works, the games.");

  const corner = $("corner");
  faceButton = el("button", "k-btn wood icon", { type: "button", "aria-label": "You" });
  faceButton.addEventListener("click", () => {
    if (G.panel === "profile") closePanel();
    else openPanel("profile");
  });
  tip(faceButton, "You", "Your rank, and what you are wearing.");
  const mute = el("button", "k-btn wood icon", { type: "button", "aria-label": "Sound" });
  const drawMute = (): void => {
    mute.replaceChildren(glyph(isMuted() ? "mute" : "sound"));
  };
  mute.addEventListener("click", () => {
    setMuted(!isMuted());
    drawMute();
    sfx.tap();
  });
  tip(mute, "Sound", () => (isMuted() ? "Off. Tap to turn it on." : "On. Tap to turn it off."));
  drawMute();
  corner.append(faceButton, mute);
  refreshFace();

  const dock = $("dock");
  for (const pl of PLACES) {
    const b = el("button", "k-slot", { type: "button", "aria-label": pl.name }, shown(icon(pl.id), 1));
    b.addEventListener("click", () => {
      if (G.panel === pl.id) closePanel();
      else hooks.visit(pl.id, true);
    });
    tip(b, pl.name, pl.about);
    dockButtons.set(pl.id, b);
    dock.append(b);
  }

  hooks.feed = feed;
  watch(() => {
    refresh?.();
  });
}

let slow = 0;
let litFor: string | null = null;

export function tickUI(dt: number): void {
  roll("leaf", dt);
  roll("coins", dt);
  const lit = `${G.panel}/${G.near}`;
  if (lit !== litFor) {
    litFor = lit;
    markDock();
  }
  slow -= dt;
  if (slow > 0) return;
  slow = 0.3;
  refresh?.();
  const of = show.card;
  if (of && doingEl) {
    doingEl.textContent = of === G.cinfy ? KEEPER.doing : DOING[of.doing];
    if (performance.now() > cardUntil || of.away) closeCard();
  }
}
