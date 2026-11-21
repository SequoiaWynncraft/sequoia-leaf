/**
 * What sits over the town: the purse, the dock, the guild feed, a card for whoever was tapped, the
 * arrival card, and a panel for each place. Everything in the panels is stand-in content; what a
 * button does still lands in the town behind it.
 */

import { CREAM, GOLD, GREEN, WATER } from "@sequoia-leaf/kit/palette.ts";
import { bitmap } from "@sequoia-leaf/kit/pix.ts";
import { isMuted, setMuted, sfx } from "@sequoia-leaf/kit/sound.ts";
import { dist, makeCanvas, must, pick, type Pt } from "@sequoia-leaf/kit/util.ts";

import { callToFire, goSit, hop, inTown, release, say, sitters } from "./actors.ts";
import { DOING, RANKS } from "./cast.ts";
import { after } from "./events.ts";
import { bit, float, flutter, puff, sparkle } from "./fx.ts";
import { type Actor, changed, G, hooks, type PanelId, type Quest, watch } from "./game.ts";
import { icon, type IconName, type Sprites } from "./sprites.ts";
import { belt, flare, ringBell, rollCall } from "./town.ts";
import { place, type PlaceId } from "./world.ts";

type Kid = Node | string | null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

const $ = (id: string): HTMLElement => must(document.getElementById(id), id);

/** A small picture, shown large with hard edges. */
function pic(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  c.className = "px";
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  return c;
}

function button(label: readonly Kid[] | string, cls: string, on: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", `btn ${cls}`, ...(typeof label === "string" ? [label] : label));
  b.type = "button";
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

const centre = (r: DOMRect): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function shake(b: HTMLElement): void {
  b.classList.remove("shake");
  requestAnimationFrame(() => {
    b.classList.add("shake");
  });
}

let S: Sprites | null = null;

// ---------- the purse ----------

interface Counter {
  box: HTMLElement;
  num: HTMLElement;
  art: HTMLCanvasElement;
  shown: number;
}
let leaf: Counter | null = null;
let coins: Counter | null = null;
let tickAt = 0;

function counter(id: string, name: string, art: IconName, value: number): Counter {
  const num = el("b", "", String(value));
  const a = pic(icon(art), 2);
  const box = el("span", "cur", a, el("span", "", num, el("small", "", name)));
  box.id = id;
  $("purse").append(box);
  return { box, num, art: a, shown: value };
}

function purseAt(which: "leaf" | "coins"): Pt {
  const c = which === "leaf" ? leaf : coins;
  return c ? centre(c.art.getBoundingClientRect()) : { x: 30, y: 30 };
}

function bump(which: "leaf" | "coins"): void {
  const c = which === "leaf" ? leaf : coins;
  if (!c) return;
  c.box.classList.remove("bump");
  requestAnimationFrame(() => {
    c.box.classList.add("bump");
  });
}

function roll(c: Counter, real: number, dt: number, sound: (i: number) => void): void {
  if (c.shown === real) return;
  const d = real - c.shown;
  c.shown += Math.sign(d) * Math.min(Math.abs(d), Math.max(1, Math.ceil(Math.abs(d) * dt * 5)));
  c.num.textContent = String(c.shown);
  const now = performance.now();
  if (d > 0 && now > tickAt) {
    tickAt = now + 70;
    sound(c.shown);
  }
}

/** Little pictures that fly from one spot on the page to another: Leaf leaving the purse, Coins arriving. */
function fly(art: HTMLCanvasElement, from: Pt, to: Pt, count: number, each: ((i: number) => void) | null = null): void {
  for (let i = 0; i < count; i++) {
    const c = pic(art, 2);
    c.classList.add("fly");
    document.body.append(c);
    const half = art.width;
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

// ---------- the guild feed ----------

function feed(text: string, tone = "leaf"): void {
  const f = $("feed");
  const row = el("div", tone, text);
  f.append(row);
  while (f.children.length > 3) f.firstElementChild?.remove();
  setTimeout(() => {
    row.remove();
  }, 13000);
}

// ---------- the Treasury ----------

interface Ware {
  id: string;
  name: string;
  about: string;
  price: number;
  once: boolean;
  art: () => HTMLCanvasElement;
  scale: number;
  got: () => void;
  thanks: readonly [string, string];
}

const JAR = bitmap(["..nnnn..", ".wwwwww.", "w......w", "w..y...w", "w.....yw", "w.y....w", "w...y..w", ".wwwwww."], {
  n: "#8a4a30",
  w: "#93cfd0",
  y: "#ffd98a",
});

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
  const thanks = ["cheers!", "cocoa!!", "thank you!", "you're the best", "♥"];
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

const WARES: readonly Ware[] = [
  {
    id: "crown",
    name: "Leaf crown",
    about: "A wreath of gold leaves. You wear it out of the shop.",
    price: 60,
    once: true,
    art: () => must(S).crown,
    scale: 3,
    got: () => {
      const p = G.player;
      if (!p) return;
      p.crown = true;
      sparkle(p.x, p.y - 20, 18, 6);
      hop(p, 2);
      nearby(p, ["ooh, fancy", "nice hat"]);
    },
    thanks: ["It suits you. Everything suits you; that's the trick of gold.", "it suits you"],
  },
  {
    id: "jar",
    name: "Jar of fireflies",
    about: "They follow whoever opens the lid. That will be you.",
    price: 35,
    once: true,
    art: () => JAR,
    scale: 3,
    got: () => {
      const p = G.player;
      if (!p) return;
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
    thanks: ["Don't shake it. They hold grudges.", "don't shake it"],
  },
  {
    id: "cocoa",
    name: "Cocoa for the fire",
    about: "A round for everyone sitting there. As often as you like.",
    price: 12,
    once: false,
    art: () => must(S).mug,
    scale: 5,
    got: cocoa,
    thanks: ["Sent over. They'll say thank you. They had better.", "cocoa's up!"],
  },
];

function treasury(body: HTMLElement): () => void {
  const line = el("span", "", "Welcome back. Mind the gold, it's load-bearing.");
  const keeper = el(
    "div",
    "keeper",
    G.cinfy ? pic(G.cinfy.body.face, 6) : null,
    el("div", "says", el("b", "", "Cinfy"), line),
  );
  body.append(keeper);
  const speak = (long: string, short: string): void => {
    line.textContent = long;
    keeper.classList.remove("hop");
    requestAnimationFrame(() => {
      keeper.classList.add("hop");
    });
    if (G.cinfy) {
      say(G.cinfy, short, 2.4);
      hop(G.cinfy);
    }
  };
  const parts = WARES.map((w) => {
    const slot = el("span");
    body.append(
      el("div", "row", pic(w.art(), w.scale), el("div", "grow", el("div", "", w.name), el("div", "d", w.about)), slot),
    );
    return when(
      () => String(w.once && G.owned.has(w.id)),
      () => {
        if (w.once && G.owned.has(w.id)) {
          slot.replaceChildren(el("span", "stamp", "Yours"));
          return;
        }
        slot.replaceChildren(
          button([pic(icon("leaf"), 1), String(w.price)], "", (b) => {
            if (G.leaf < w.price) {
              sfx.no();
              shake(b);
              speak("Come back with more Leaf. I'll be here. I'm always here.", "more Leaf, please");
              return;
            }
            G.leaf -= w.price;
            if (w.once) G.owned.add(w.id);
            sfx.buy();
            ringBell();
            fly(
              icon("leaf"),
              purseAt("leaf"),
              centre(b.getBoundingClientRect()),
              Math.min(7, 2 + Math.floor(w.price / 12)),
            );
            w.got();
            speak(w.thanks[0], w.thanks[1]);
            changed();
          }),
        );
      },
    );
  });
  body.append(el("div", "note", "Leaf comes from raids and wars with the guild. Coins come from your Works."));
  return () => {
    for (const f of parts) f();
  };
}

// ---------- the quest board ----------

function claim(q: Quest, b: HTMLElement): void {
  q.claimed = true;
  const what = q.pays === "leaf" ? "leaf" : "coin";
  if (q.pays === "leaf") G.leaf += q.reward;
  else G.coins += q.reward;
  fly(icon(what), centre(b.getBoundingClientRect()), purseAt(q.pays), 7, () => {
    bump(q.pays);
  });
  sfx.cheer();
  // The note comes off the board in a flurry.
  flutter(198, 140, 12, [CREAM, GOLD[1], GREEN[4]], 14, 30);
  sparkle(198, 138, 10, 10);
  if (G.player) hop(G.player, 2);
  hooks.feed(`You claimed ${q.reward} ${q.pays === "leaf" ? "Leaf" : "Coins"} from the quest board.`, what);
  changed();
}

function quests(body: HTMLElement): () => void {
  body.append(el("div", "note", "Pinned up by the guild. Take what you have earned."));
  const parts = G.quests.map((q) => {
    const fill = el("i");
    const count = el("div", "d");
    const slot = el("span");
    const row = el("div", "row", el("div", "grow", el("div", "", q.title), el("div", "bar", fill), count), slot);
    body.append(row);
    return when(
      () => `${q.have}/${q.claimed}`,
      () => {
        const ready = q.have >= q.need;
        fill.style.width = `${Math.min(100, (q.have / q.need) * 100)}%`;
        count.textContent = `${q.have} / ${q.need} ${q.unit}`;
        row.classList.toggle("lit", ready && !q.claimed);
        row.classList.toggle("done", q.claimed);
        const what = q.pays === "leaf" ? "leaf" : "coin";
        if (q.claimed) slot.replaceChildren(el("span", "stamp", "Claimed"));
        else if (ready)
          slot.replaceChildren(
            button(["Claim", pic(icon(what), 1), `+${q.reward}`], "", (b) => {
              claim(q, b);
            }),
          );
        else slot.replaceChildren(el("span", `price ${what}`, pic(icon(what), 1), `+${q.reward}`));
      },
    );
  });
  return () => {
    for (const f of parts) f();
  };
}

// ---------- the market ----------

interface Listing {
  id: string;
  by: string;
  what: string;
  price: number;
  word: string;
  got: (p: Actor) => void;
}

const STOCK: readonly Listing[] = [
  {
    id: "bread",
    by: "Bramblewick",
    what: "A loaf of raid bread, still warm",
    price: 8,
    word: "baked this morning!",
    got: (p) => {
      nearby(p, ["that smells amazing", "save me a bit"], 90);
    },
  },
  {
    id: "run",
    by: "Quillfeather",
    what: "A guided run through the Hollow Vault, tonight",
    price: 15,
    word: "bring snacks",
    got: () => {
      hooks.feed("Quillfeather has you down for the Hollow Vault tonight.", "raid");
    },
  },
  {
    id: "plate",
    by: "Tindra",
    what: "A hand-painted name plate, gold corners",
    price: 30,
    word: "I did the corners twice",
    got: (p) => {
      sparkle(p.x, p.y - 26, 14, 9);
    },
  },
  {
    id: "water",
    by: "Sootpaw",
    what: "A jar of pond water (probably haunted)",
    price: 3,
    word: "no refunds. meow.",
    got: (p) => {
      sfx.plop();
      float(p.x, p.y - 30, "...oOo...", WATER[3], 2.4);
    },
  },
];

function market(body: HTMLElement): () => void {
  body.append(el("div", "note", "Guild-mates selling to guild-mates. Prices in Leaf."));
  const parts = STOCK.map((it) => {
    const seller = G.mates.find((a) => a.who.name === it.by);
    const slot = el("span");
    body.append(
      el(
        "div",
        "row",
        seller ? pic(seller.body.face, 4) : null,
        el("div", "grow", el("div", "", it.what), el("div", "d", `from ${it.by}`)),
        slot,
      ),
    );
    return when(
      () => String(G.owned.has(it.id)),
      () => {
        if (G.owned.has(it.id)) {
          slot.replaceChildren(el("span", "stamp", "Yours"));
          return;
        }
        slot.replaceChildren(
          button([pic(icon("leaf"), 1), String(it.price)], "", (b) => {
            if (G.leaf < it.price) {
              sfx.no();
              shake(b);
              return;
            }
            G.leaf -= it.price;
            G.owned.add(it.id);
            sfx.buy();
            fly(
              icon("leaf"),
              purseAt("leaf"),
              centre(b.getBoundingClientRect()),
              Math.min(6, 2 + Math.floor(it.price / 8)),
            );
            if (seller && !seller.away) {
              hop(seller, 2);
              say(seller, it.word, 2.6);
            }
            if (G.player) {
              hop(G.player);
              it.got(G.player);
            }
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

// ---------- the Works ----------

/** The member's factory, served beside the town. The file is named so that a plain file server finds it too. */
const WORKS_URL = "../works/index.html";

function works(body: HTMLElement): () => void {
  const ready = el("div", "big");
  const planks = el("div", "d");
  const slot = el("span");
  body.append(el("div", "row", S ? pic(S.crate.c, 2) : null, el("div", "grow", ready, planks), slot));
  const frame = el("div", "frame");
  body.append(frame);
  const standIn = (): void => {
    frame.replaceChildren(
      el(
        "div",
        "note",
        "Your factory opens here when the Works is served beside the town. Until then the belt outside keeps running: tap it to hurry it along, and sell what it stacks up.",
      ),
    );
    frame.style.padding = "10px";
  };
  const embed = async (): Promise<void> => {
    try {
      const res = await fetch(WORKS_URL);
      const text = res.ok ? await res.text() : "";
      if (!text.includes("The Works")) {
        standIn();
        return;
      }
      const f = el("iframe");
      f.src = WORKS_URL;
      f.title = "The Works";
      frame.replaceChildren(f);
    } catch {
      standIn();
    }
  };
  void embed();
  const link = el("a", "btn plain", "Open the Works in its own tab");
  link.href = WORKS_URL;
  link.target = "_blank";
  link.rel = "noopener";
  body.append(link);
  return when(
    () => `${G.crates}/${G.planks}`,
    () => {
      ready.textContent = `${G.crates} crate${G.crates === 1 ? "" : "s"} ready`;
      planks.textContent = `${G.planks} planks down the belt today`;
      if (G.crates === 0) {
        slot.replaceChildren(el("span", "d", "Belt's running"));
        return;
      }
      slot.replaceChildren(
        button(["Sell", pic(icon("coin"), 1), `+${G.crates * 12}`], "", (b) => {
          const n = G.crates;
          G.coins += n * 12;
          G.crates = 0;
          belt.fresh = 0;
          puff(468, 118, 8, CREAM);
          fly(icon("coin"), centre(b.getBoundingClientRect()), purseAt("coins"), Math.min(8, n + 2), () => {
            bump("coins");
          });
          hooks.feed(`You sold ${n} crate${n === 1 ? "" : "s"} from the Works for ${n * 12} Coins.`, "coin");
          changed();
        }),
      );
    },
  );
}

// ---------- the campfire ----------

const EMOTES: readonly (readonly [string, string, readonly string[]])[] = [
  ["Wave", "o/", ["o/", "hi hi", "\\o"]],
  ["Cheer", "woo!", ["woo!", "yeah!", "glory to the grove!"]],
  ["Laugh", "ha ha!", ["ha!", "pfff", "erm. ha."]],
  ["Heart", "♥", ["♥", "aww", "♥ ♥"]],
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
  const list = el("div", "wrap");
  const seat = el("span");
  body.append(
    el("div", "note", "By the fire just now"),
    list,
    el(
      "div",
      "wrap",
      seat,
      button("Throw on a log", "plain", () => {
        flare();
        if (G.player) nearby(G.player, ["toasty", "ooh"], 90);
      }),
    ),
    el("div", "note", "Say it with your whole body"),
    el(
      "div",
      "wrap",
      ...EMOTES.map(([name, word, replies], i) =>
        button(name, "plain", () => {
          emote(word, replies, i);
        }),
      ),
    ),
  );
  return when(
    () =>
      `${sitters("fire")
        .map((a) => a.who.name + String(a.you))
        .join()}|${G.player?.seat ? "s" : G.player?.goal ? "g" : "n"}`,
    () => {
      const at = sitters("fire");
      list.replaceChildren(
        ...(at.length > 0
          ? at.map((a) => el("span", "who", pic(a.body.face, 3), a.you ? "You" : a.who.name))
          : [el("span", "d", "Nobody yet. The fire is all yours.")]),
      );
      const p = G.player;
      seat.replaceChildren(
        p?.seat
          ? button("Stand up", "plain", () => {
              release(p);
              sfx.tap();
            })
          : button(p?.goal ? "On your way..." : "Sit down", "", (b) => {
              if (!goSit(null)) {
                sfx.no();
                shake(b);
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
  "walking sideways, obviously",
  "damp",
  "smug",
  "busy",
];

function pond(body: HTMLElement): () => void {
  const rows: HTMLElement[] = [];
  const tally = el("div", "note");
  body.append(
    el(
      "div",
      "wrap",
      button("Call the roll", "", () => {
        rollCall();
        let slotAt = 0;
        rows.forEach((row) => {
          setTimeout(() => {
            row.classList.add("lit");
            setTimeout(() => {
              row.classList.remove("lit");
            }, 420);
          }, slotAt * 380);
          slotAt++;
        });
      }),
    ),
    tally,
  );
  for (let n = 1; n <= 9; n++) {
    const lost = n === G.lostCrab;
    const row = el(
      "div",
      `row${lost ? " missing" : ""}`,
      S?.crab[0] ? pic(S.crab[0].c, 2) : null,
      el(
        "div",
        "grow",
        el("div", "", `Crab No. ${n}`),
        el(
          "div",
          "d",
          lost
            ? "Unaccounted for."
            : `Present. ${(CRAB_NOTES[n - 1] ?? "busy").replace(/^./, (c) => c.toUpperCase())}.`,
        ),
      ),
    );
    if (lost) row.style.opacity = "0.9";
    rows.push(row);
    body.append(row);
  }
  return when(
    () => String(G.sightings),
    () => {
      tally.textContent = `Nine crabs live here. Eight are ever at roll call. No. ${G.lostCrab} has been seen about town ${
        G.sightings === 0
          ? "by nobody yet tonight"
          : G.sightings === 1
            ? "once tonight"
            : `${G.sightings} times tonight`
      }.`;
    },
  );
}

// ---------- your camp, and you ----------

function camp(body: HTMLElement): null {
  const art = pic(icon("camp"), 6);
  art.style.alignSelf = "center";
  body.append(
    art,
    el("div", "", "The path to your own camp."),
    el(
      "div",
      "note",
      "Through the gate and down the hill is the corner of the grove that is yours: a tent, your Works, whatever you have earned. It is not built yet. The rope is still across the path, and Mossback has left a mushroom by it.",
    ),
    button("Wave down the path", "plain", () => {
      const p = G.player;
      if (!p) return;
      say(p, "o/", 1.6);
      hop(p);
      sfx.pluck(5);
      after(1.1, () => {
        float(256, 70, "...something small waves back.", CREAM, 2.6);
        sfx.pluck(9);
      });
    }),
  );
  return null;
}

function profile(body: HTMLElement): () => void {
  const p = G.player;
  const frame = p?.body.frames[0]?.[0];
  const portrait = makeCanvas(12, 24);
  if (frame) portrait.g.drawImage(frame, 0, 0);
  if (p?.crown && S) portrait.g.drawImage(S.crown, 2, 0);
  const rank = 2;
  const xp = el("i");
  xp.style.width = "62%";
  const have = el("div", "d");
  const wearing = el("div", "d");
  body.append(
    el(
      "div",
      "row",
      pic(portrait.c, 5),
      el(
        "div",
        "grow",
        el("div", "big", "You"),
        el("div", "d", `${RANKS[rank] ?? ""} of the guild`),
        el("div", "bar", xp),
        el("div", "d", `Level ${G.level} · 6,240 / 10,000`),
      ),
    ),
    el("div", "track", ...RANKS.map((r, i) => el("span", i === rank ? "at" : i < rank ? "past" : "", r))),
    el("div", "row", el("div", "grow", have)),
    el(
      "div",
      "row",
      el("div", "grow", el("div", "", "This week"), el("div", "d", "7 raids · 2 wars · 3 lanterns hung")),
    ),
    el("div", "row", el("div", "grow", el("div", "", "Wearing and carrying"), wearing)),
  );
  return when(
    () => `${G.leaf}/${G.coins}/${G.owned.size}/${G.sightings}`,
    () => {
      have.textContent = `${G.leaf} Leaf · ${G.coins} Coins · crab sightings: ${G.sightings}`;
      const names: Record<string, string> = {
        crown: "Leaf crown",
        jar: "Jar of fireflies",
        plate: "Painted name plate",
        water: "Pond water (haunted?)",
        bread: "Raid bread",
        run: "A place on tonight's run",
      };
      const list = [...G.owned].map((id) => names[id] ?? id);
      wearing.textContent = list.length > 0 ? list.join(" · ") : "Nothing yet. Cinfy can fix that.";
    },
  );
}

// ---------- panels ----------

const BUILD: Record<PanelId, (body: HTMLElement) => (() => void) | null> = {
  treasury,
  quests,
  market,
  works,
  fire: fireside,
  pond,
  camp,
  profile,
};

const DOCK: readonly (readonly [PlaceId, string])[] = [
  ["treasury", "Treasury"],
  ["quests", "Quests"],
  ["market", "Market"],
  ["works", "Works"],
  ["fire", "Fire"],
  ["pond", "Pond"],
  ["camp", "Camp"],
];

let refresh: (() => void) | null = null;
const dockButtons = new Map<PlaceId, HTMLElement>();

function markDock(): void {
  for (const [id, b] of dockButtons) b.classList.toggle("on", G.panel === id);
  document.body.classList.toggle("panel-open", G.panel !== null);
}

export function openPanel(id: PanelId): void {
  if (G.panel === id) return;
  closeCard();
  G.panel = id;
  const p = $("panel");
  p.hidden = true;
  p.replaceChildren();
  const x = el("button", "x", "✕");
  x.type = "button";
  x.addEventListener("click", closePanel);
  const face = G.player?.body.face;
  const art = id === "profile" ? (face ? pic(face, 3) : null) : pic(icon(id), 2);
  p.append(el("header", "", art, el("h2", "", id === "profile" ? "You" : place(id).name), x));
  const body = el("div", "body");
  p.append(body);
  refresh = BUILD[id](body);
  refresh?.();
  p.hidden = false;
  sfx.open();
  markDock();
}

export function closePanel(): void {
  if (!G.panel) return;
  G.panel = null;
  $("panel").hidden = true;
  $("panel").replaceChildren();
  refresh = null;
  sfx.close();
  markDock();
}

/** The part of the page a panel is covering, so the camera can keep the player clear of it. */
export function panelBox(): DOMRect | null {
  return G.panel ? $("panel").getBoundingClientRect() : null;
}

// ---------- a guild-mate's card ----------

let cardOf: Actor | null = null;
let cardUntil = 0;
let doingEl: HTMLElement | null = null;

function keep(): void {
  cardUntil = performance.now() + 7000;
}

export function closeCard(): void {
  cardOf = null;
  $("card").hidden = true;
}

export function showCard(a: Actor): void {
  const c = $("card");
  c.hidden = true;
  c.replaceChildren();
  const x = el("button", "x", "✕");
  x.type = "button";
  x.addEventListener("click", closeCard);
  doingEl = el("div", "d");
  const shop = a === G.cinfy;
  c.append(
    el(
      "div",
      "top",
      pic(a.body.face, 5),
      el(
        "div",
        "",
        el("div", "big", a.who.name),
        el("div", "d", shop ? a.who.rank : `${a.who.rank} · Level ${a.who.level}`),
      ),
      x,
    ),
    doingEl,
    el(
      "div",
      "wrap",
      button("Wave", "", () => {
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
        ? button("Open the Treasury", "plain", () => {
            hooks.visit("treasury", true);
          })
        : button("Cheer", "plain", () => {
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
  doingEl.style.marginBottom = "8px";
  cardOf = a;
  keep();
  c.hidden = false;
}

// ---------- arrival ----------

let arrived: (() => void) | null = null;

/** The card that meets the member at the gate: what happened while they were away. */
export function showArrival(done: () => void): void {
  const root = $("arrival");
  const visitors = G.mates.filter((a) => a.who.name === "Mossback" || a.who.name === "Tindra");
  const faces = el("span", "wrap", ...visitors.map((a) => pic(a.body.face, 2)));
  faces.style.gap = "2px";
  faces.style.flexWrap = "nowrap";
  const leafArt = pic(icon("leaf"), 2);
  const coinArt = pic(icon("coin"), 2);
  const lines: readonly (readonly [string, Node, readonly Kid[]])[] = [
    ["leaf", leafArt, [el("b", "", "+46 Leaf"), " from three raids with the guild"]],
    ["", coinArt, [el("b", "", "+212 Coins"), " for 86 planks off your Works"]],
    ["", faces, ["Mossback and Tindra stopped by your camp. Tindra left a mushroom."]],
    ["", S?.crab[0] ? pic(S.crab[0].c, 2) : el("span"), [`Crab No. ${G.lostCrab} is still unaccounted for.`]],
  ];
  const sheet = el("div", "sheet plum", el("h1", "", "Welcome home."), el("p", "", "While you were away"));
  lines.forEach(([cls, art, words], i) => {
    const row = el("div", `line ${cls}`, art, el("span", "", ...words));
    row.style.animationDelay = `${0.3 + i * 0.22}s`;
    sheet.append(row);
  });
  const go = button("Come on in", "", () => undefined);
  sheet.append(go);
  root.append(sheet);
  arrived = (): void => {
    arrived = null;
    root.classList.add("gone");
    setTimeout(() => {
      root.remove();
    }, 400);
    const from = [centre(leafArt.getBoundingClientRect()), centre(coinArt.getBoundingClientRect())] as const;
    G.leaf += 46;
    G.coins += 212;
    G.home = true;
    sfx.open();
    fly(icon("leaf"), from[0], purseAt("leaf"), 7, () => {
      bump("leaf");
    });
    fly(icon("coin"), from[1], purseAt("coins"), 7, () => {
      bump("coins");
    });
    changed();
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

let face: HTMLElement | null = null;

/** The player's face on the profile button, redrawn once their own skin has loaded. */
export function refreshFace(): void {
  const f = G.player?.body.face;
  if (face && f) face.replaceChildren(pic(f, 3));
}

export function initUI(sprites: Sprites): void {
  S = sprites;
  leaf = counter("leaf", "Leaf", "leaf", G.leaf);
  coins = counter("coins", "Coins", "coin", G.coins);

  const corner = $("corner");
  face = el("button", "plum");
  face.title = "You";
  face.addEventListener("click", () => {
    if (G.panel === "profile") closePanel();
    else openPanel("profile");
  });
  const mute = el("button", "plum");
  mute.title = "Sound";
  const drawMute = (): void => {
    mute.replaceChildren(pic(icon(isMuted() ? "mute" : "sound"), 2));
  };
  mute.addEventListener("click", () => {
    setMuted(!isMuted());
    drawMute();
    sfx.tap();
  });
  drawMute();
  corner.append(face, mute);
  refreshFace();

  const dock = $("dock");
  for (const [id, name] of DOCK) {
    const b = el("button", "", pic(icon(id), 2), el("small", "", name));
    b.type = "button";
    b.title = place(id).name;
    b.addEventListener("click", () => {
      if (G.panel === id) closePanel();
      else hooks.visit(id, true);
    });
    dockButtons.set(id, b);
    dock.append(b);
  }

  hooks.feed = feed;
  watch(() => {
    refresh?.();
  });
}

let slow = 0;

export function tickUI(dt: number): void {
  if (leaf)
    roll(leaf, G.leaf, dt, (i) => {
      sfx.leaf(i);
    });
  if (coins)
    roll(coins, G.coins, dt, (i) => {
      sfx.coin(i);
    });
  slow -= dt;
  if (slow > 0) return;
  slow = 0.3;
  refresh?.();
  if (cardOf && doingEl) {
    doingEl.textContent = cardOf === G.cinfy ? "Minding the gold. It is load-bearing." : DOING[cardOf.doing];
    if (performance.now() > cardUntil || cardOf.away) closeCard();
  }
}
