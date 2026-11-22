/**
 * The town's own part of the interface: a panel for each of its places, the arrival letter, and
 * the dock that goes to them. The purse, the feed, the panel's frame and the cards are shared with
 * the camp (`hud.ts`). What a button does still lands in the town behind it.
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { el, icon as glyph, replay, shown } from "@sequoia-leaf/kit/dom.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { CREAM, GOLD, GREEN, WATER } from "@sequoia-leaf/kit/palette.ts";
import { earnMadeUp, grant } from "@sequoia-leaf/kit/purse.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { dist, makeCanvas, pick } from "@sequoia-leaf/kit/util.ts";
import type { Stock, Ware } from "@sequoia-leaf/town/catalogue.ts";
import { folk, folkNamed, KEEPER } from "@sequoia-leaf/town/folk.ts";
import { waiting } from "@sequoia-leaf/town/mail.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import { callToFire, goSit, hop, inTown, release, rouse, say, sitters } from "./actors.ts";
import { openingTab, readNews, redrawn, shortDay, TABS } from "./board.ts";
import { owned } from "./camp.ts";
import { type CampArt, pictureOf } from "./campart.ts";
import { named, registerCards, thingRef, wareRef } from "./cards.ts";
import { fling } from "./flights.ts";
import { folkArt } from "./folkart.ts";
import { bit, float, flutter, puff, sparkle } from "./fx.ts";
import { type Actor, after, changed, G, hooks, type PanelId } from "./game.ts";
import { GAMES } from "./games.ts";
import { type AwayLine, guild, type Quest } from "./guild.ts";
import {
  $,
  bump,
  button,
  centre,
  closePanel,
  faceOf,
  fly,
  nameOf,
  openPanel as openHudPanel,
  pay,
  pic,
  purseAt,
  setDock,
  slot,
  when,
} from "./hud.ts";
import type { Letter } from "./letter.ts";
import { NOTES } from "./notes.ts";
import { buyForCamp, camp } from "./record.ts";
import { icon, type Sprites } from "./sprites.ts";
import { flare, nudgeCrab, ringBell, rollCall } from "./town.ts";
import { place, PLACES } from "./world.ts";

let S: Sprites | null = null;
let ART: CampArt | null = null;

/**
 * A camp thing's picture in a hollow, as large as will fit: small things twice their size, most
 * things as they are, and the few very large ones at half.
 */
export function thingSlot(art: CampArt, id: string, box = 38): HTMLElement {
  const sprite = pictureOf(art, id, 0, 0);
  if (!sprite) return slot(glyph("star"), box);
  const { width, height } = sprite.c;
  const fits = (k: number): boolean => width * k <= box - 2 && height * k <= box + 8;
  const scale = fits(3) ? 3 : fits(2) ? 2 : fits(1) ? 1 : 0.5;
  const s = slot(pic(sprite.c, scale), box);
  s.style.height = `calc(var(--u) * ${Math.max(box, Math.ceil(height * scale) + 4)})`;
  s.style.overflow = "hidden";
  return s;
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
  // Nobody asleep is woken for it.
  const at = sitters("fire").filter((a) => a.dozing === null);
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
  plate: (p) => {
    sparkle(p.x, p.y - 26, 14, 9);
  },
  water: (p) => {
    sfx.plop();
    float(p.x, p.y - 30, "...oOo...", WATER[3], 2.4);
  },
};

function got(thing: Ware): void {
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
  const keeper = folk("cinfy");
  const line = el("span", "", { text: KEEPER.hello });
  const face = slot(G.cinfy ? faceOf(G.cinfy, 3) : null, 28);
  face.classList.add("nod");
  body.append(el("div", "k-row", {}, face, el("div", "k-say left k-grow", {}, folkName(keeper.name, "k-pix"), line)));
  const speak = (long: string, short: string): void => {
    line.textContent = long;
    replay(face, "hop");
    if (G.cinfy) {
      say(G.cinfy, short, 2.4);
      hop(G.cinfy);
    }
  };
  body.append(el("div", "k-label", { text: "To wear" }));
  const parts = guild.wares().map((w) => {
    const side = el("span");
    const art = slot(wareArt(w.id) ?? glyph("star"));
    link(art, wareRef(w.id));
    const row = el(
      "div",
      "k-card",
      {},
      art,
      el("div", "k-grow", {}, named(w.name, wareRef(w.id)), el("div", "k-d", { text: w.about })),
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
          if (!pay(b, w.price, "leaf")) {
            speak(KEEPER.short[0], KEEPER.short[1]);
            return;
          }
          if (w.once) G.owned.add(w.id);
          ringBell();
          got(w);
          speak(w.thanks[0], w.thanks[1]);
          changed();
        });
        if (!closeLeaf(buy, `${w.price} Leaf`))
          tip(buy, `${w.price} Leaf`, w.once ? undefined : "As often as you like.");
        side.replaceChildren(buy);
      },
    );
  });
  // The fine pieces: things for a camp that are sold for Leaf, and are as cosmetic as the rest.
  body.append(el("div", "k-label", { text: "For your camp" }));
  for (const piece of guild.pieces())
    parts.push(
      shopRow(body, piece, "leaf", () => {
        ringBell();
        speak("Wrapped, and on its way to your camp.", "it's on its way");
        return { x: 104, y: 104 };
      }),
    );
  return () => {
    for (const f of parts) f();
  };
}

// ---------- the quest board ----------

const paysWhat = (q: Quest): string => (q.pays === "leaf" ? "Leaf" : "Coins");

function claim(q: Quest, b: HTMLElement): void {
  G.claimed.add(q.id);
  if (q.pays === "leaf") grant(q.reward, `the quest board: ${q.title}`);
  // Only the made-up guild has quests that pay Coins; the guild's own pay Leaf, and pay themselves.
  else earnMadeUp(q.reward, "the quest board");
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

const two = (n: number): string => String(n).padStart(2, "0");
/** When something ends, as the member's own clock says it. */
const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** The quest board's quests: drawn whole again whenever they are no longer the ones it shows. */
function quests(body: HTMLElement): () => void {
  const note = guild.boardNote();
  if (note !== null) {
    // Somebody quests are not for: one note says why, and nothing on the board moves.
    body.replaceChildren(el("div", "k-paper quest", {}, el("div", "", { text: note })));
    return () => undefined;
  }
  return redrawn(
    () => guild.quests().map((q) => q.id),
    () => notes(body),
  );
}

/** A note for each quest on the board, in place of whatever was there; gives back how to bring them up to date. */
function notes(body: HTMLElement): () => void {
  body.replaceChildren();
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
      first.ends === null ? null : el("div", "k-dim", { text: `Ends at ${clock(first.ends)}` }),
    );
    body.append(note);
    const now = (): Quest => guild.quests().find((q) => q.id === first.id) ?? first;
    return when(
      () => `${now().have}/${G.claimed.has(first.id)}`,
      () => {
        const q = now();
        const ready = q.have >= q.need;
        // A quest that pays by itself is done the moment it is finished.
        const paid = !q.claim && ready;
        const done = G.claimed.has(q.id) || paid;
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
        if (paid) side.replaceChildren(prize, el("span", "k-chip lit", {}, glyph("check"), "Paid"));
        else if (done) side.replaceChildren(el("span", "k-chip lit", {}, glyph("check"), "Claimed"));
        else if (ready && q.claim)
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

/** What has changed in the game: the ten newest notes. */
function newsTab(list: HTMLElement): void {
  list.replaceChildren(
    ...NOTES.slice(0, 10).map((n) =>
      el(
        "div",
        "k-paper quest",
        {},
        el("div", "k-read k-dim", { text: shortDay(n.day) }),
        el("div", "k-title", { text: n.title }),
        ...n.lines.map((text) => el("div", "k-read", { text })),
      ),
    ),
  );
}

/** The quest board: its quests on one tab, and on the other what has changed in the game. */
function board(body: HTMLElement): () => void {
  const list = el("div", "k-col");
  let update: (() => void) | null = null;
  const { row, show } = tabs(
    TABS.map((label) => ({ label })),
    (i) => {
      if (TABS[i] === "News") {
        readNews();
        update = null;
        newsTab(list);
      } else {
        update = quests(list);
        update();
      }
    },
  );
  body.append(row, list);
  show(TABS.indexOf(openingTab()));
  return () => {
    update?.();
  };
}

// ---------- tabs ----------

/** Tabs along the top of a panel, one lit at a time: tapping one, or `show`, lights it and opens what it is for. */
function tabs(
  each: readonly { label: string; tip?: readonly [string, string] }[],
  open: (i: number) => void,
): { row: HTMLElement; show: (i: number) => void } {
  const row = el("div", "k-tabs", { role: "tablist" });
  const show = (i: number): void => {
    [...row.children].forEach((tab, k) => {
      tab.setAttribute("aria-selected", k === i ? "true" : "false");
    });
    open(i);
  };
  each.forEach(({ label, tip: about }, i) => {
    const tab = button("sm", [label], () => {
      sfx.tap();
      show(i);
    });
    tab.setAttribute("role", "tab");
    if (about) tip(tab, ...about);
    row.append(tab);
  });
  return { row, show };
}

// ---------- camp things, wherever they are sold ----------

/**
 * A row selling one camp thing, for Coins at a stall or Leaf at the Treasury. Nothing sells out:
 * the row says how many the member has. `sold` is what the place does about it, and gives the spot
 * in town the parcel leaves from.
 */
function shopRow(
  body: HTMLElement,
  s: Stock,
  kind: "coins" | "leaf",
  sold: () => { x: number; y: number },
): () => void {
  const thing = thingOf(s.thing);
  if (!thing || !ART) return () => undefined;
  const art = ART;
  const have = el("div", "k-d");
  const buy = button(
    kind === "leaf" ? "leaf sm" : "sm",
    [glyph(kind === "leaf" ? "leaf" : "coin"), String(s.price)],
    (b) => {
      const sent = buyForCamp(thing.id, () => pay(b, s.price, kind === "leaf" ? "leaf" : "camp_thing"));
      if (sent === "full" || sent === "plenty") {
        // Nothing is charged: as many parcels are waiting by the trail as may, or the member has
        // as many of this thing as may be had.
        sfx.no();
        replay(b, "shake");
        hooks.feed(
          sent === "full"
            ? "Too many parcels are waiting by the trail. Unpack some first."
            : "You have plenty of those.",
          "coral",
        );
        return;
      }
      if (sent !== "sent") return;
      const from = sold();
      // It leaves for the camp at once: a parcel, up the path and out through the gate.
      if (S) fling(S.crate.c, from, { x: 256, y: 92 }, 0.9, 30, () => puff(256, 90, 4, CREAM));
      if (G.player) hop(G.player);
      hooks.feed(`${thing.name}: on its way to your camp.`, kind === "leaf" ? "leaf" : "gold");
    },
  );
  if (kind !== "leaf" || !closeLeaf(buy, `${s.price} Leaf`))
    tip(buy, `${s.price} ${kind === "leaf" ? "Leaf" : "Coins"}`, "It will be waiting at your camp.");
  // The picture and the name explain the thing (its card); the button buys it.
  const picture = thingSlot(art, thing.id);
  link(picture, thingRef(thing.id));
  const row = el(
    "div",
    "k-card",
    {},
    picture,
    el("div", "k-grow", {}, named(thing.name, thingRef(thing.id)), el("div", "k-d", { text: thing.about }), have),
    buy,
  );
  body.append(row);
  return when(
    () => String(owned(camp, thing.id)),
    () => {
      const n = owned(camp, thing.id);
      have.textContent = n > 0 ? `You have ${n === 1 ? "one" : n}.` : "";
      have.classList.toggle("k-gold", n > 0);
    },
  );
}

// ---------- the market ----------

/** Where each stall stands in town, for parcels to leave from. */
const STALL_AT = [60, 108, 156] as const;

function market(body: HTMLElement): () => void {
  const stalls = guild.stalls();
  const list = el("div", "k-col");
  const line = el("span");
  const face = slot(null, 28);
  let rows: (() => void)[] = [];
  const pickStall = (i: number): void => {
    const stall = stalls[i];
    if (!stall) return;
    G.stall = i;
    const keeper = G.folk.find((a) => a.who.name === stall.by);
    const keeperFace = keeper ? faceOf(keeper, 3) : null;
    face.replaceChildren(...(keeperFace ? [keeperFace] : []));
    line.replaceChildren(folkName(stall.by, "k-pix"), el("span", "", { text: stall.name }));
    list.replaceChildren();
    if (keeper) rouse(keeper, 12);
    rows = stall.stock.map((s) =>
      shopRow(list, s, "coins", () => {
        if (keeper && !keeper.away) {
          rouse(keeper, 10);
          hop(keeper, 2);
          say(keeper, pick(stall.words, Math.random()), 2.6);
        }
        sfx.pluck(2 + i * 2);
        return { x: STALL_AT[i] ?? 108, y: 232 };
      }),
    );
    for (const f of rows) f();
  };
  const { row, show } = tabs(
    stalls.map((stall) => ({
      label: stall.name.split(/[ ,]/)[0] ?? stall.name,
      tip: [stall.name, `Kept by ${stall.by}.`],
    })),
    pickStall,
  );
  body.append(row, el("div", "k-row", {}, face, el("div", "k-say left k-grow", {}, line)), list);
  show(G.stall);
  return () => {
    for (const f of rows) f();
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
    go.dataset.first = "";
    body.append(
      el("div", "k-row", {}, slot(shown(icon(id), 2), 34), el("div", "k-grow", { text: game.about })),
      el("div", "k-paper", {}, el("div", "", { text: game.waiting() })),
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
          ? at.map((a) =>
              el(
                "span",
                a.you ? "k-chip lit" : a.dozing !== null ? "k-chip k-dim" : "k-chip",
                {},
                faceOf(a, 1),
                nameOf(a),
                a.dozing !== null ? el("span", "k-dim", { text: "zz" }) : null,
              ),
            )
          : [el("span", "k-d", { text: "Nobody yet." })]),
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

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six"] as const;
const many = (n: number, one: string, more: string): string => `${COUNT[n] ?? n} ${n === 1 ? one : more}`;

/** What is waiting at the camp, in a line, for the card at the gate. */
export function campWaiting(): string {
  const letters = waiting(camp.letters);
  const parcels = camp.parcels.length;
  const parts: string[] = [];
  if (letters > 0) parts.push(`${many(letters, "letter", "letters")} in the mailbox.`);
  if (parcels > 0) parts.push(`${many(parcels, "parcel", "parcels")} by the trail.`);
  if (!camp.first) parts.push("Somebody small has been waiting for you.");
  return parts.length > 0 ? parts.join(" ") : "The fire is lit. Nothing needs doing.";
}

function campCard(body: HTMLElement): () => void {
  const news = el("div");
  const go = button("wide", ["Go home"], () => {
    hooks.toCamp();
  });
  go.dataset.first = "";
  body.append(
    el(
      "div",
      "k-row",
      {},
      slot(shown(icon("camp"), 2), 34),
      el("div", "k-grow", { text: "Your own clearing, a little way into the trees." }),
    ),
    el("div", "k-paper", {}, news),
    go,
  );
  return when(campWaiting, () => {
    news.textContent = campWaiting();
  });
}

function profile(body: HTMLElement): null {
  const me = guild.me();
  const p = G.player;
  const portrait = makeCanvas(12, 24);
  const frame = p?.body?.frames[0]?.[0];
  if (frame) portrait.g.drawImage(frame, 0, 0);
  if (G.wearing.has("crown") && S) portrait.g.drawImage(S.crown, 2, 0);
  const xp = el("i");
  xp.style.setProperty("--v", `${Math.min(100, (me.xp / me.next) * 100)}%`);
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
    // A guest has no place among the guild's ranks, and no week with it to tell.
    ...(me.ranks.length === 0
      ? []
      : [
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
        ]),
    ...(me.week.length === 0
      ? []
      : [
          el("div", "k-card", {}, el("div", "k-grow", {}, "This week", el("div", "k-d", { text: me.week.join(", ") }))),
        ]),
    el(
      "div",
      "k-card",
      {},
      el(
        "div",
        "k-grow",
        {},
        "Your things",
        el("div", "k-d", { text: "What you wear and what you have won are in your cabin." }),
      ),
      button("wood sm", ["Go home"], () => {
        hooks.toCamp();
      }),
    ),
  );
  return null;
}

// ---------- panels ----------

const BUILD: Record<PanelId, (body: HTMLElement) => (() => void) | null> = {
  treasury,
  quests: board,
  market,
  works: doorCard("works"),
  table: doorCard("table"),
  fire: fireside,
  pond,
  camp: campCard,
  profile,
};

/** Opens one of the town's panels. */
export function openPanel(id: PanelId): void {
  const face = G.player?.body?.face;
  openHudPanel({
    id,
    title: id === "profile" ? "You" : place(id).name,
    art: id === "profile" ? (face ? pic(face, 2) : null) : shown(icon(id), 1),
    build: BUILD[id],
  });
}

// ---------- arrival ----------

let arrived: (() => void) | null = null;

function lineArt(l: AwayLine): Node {
  if (l.art === "leaf" || l.art === "coin") return glyph(l.art);
  if (l.art === "banner") return glyph("star");
  if (l.art === "crab" && S?.crab[0]) return pic(S.crab[0].c, 1);
  // The town's own the line is about, as their own small pictures.
  const faces = (l.who ?? []).flatMap((name) => {
    const t = folkNamed(name);
    return t ? [pic(folkArt(t).face, 1)] : [];
  });
  return faces.length > 0 ? el("span", "k-row faces", {}, ...faces) : glyph("heart");
}

/**
 * The letter that meets the member at the gate. Putting it away pays what it says into the purse;
 * what the guild's ledger has already paid is only shown.
 */
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
        l.pay ? el("b", "", { text: `+${l.pay.amount}` }) : l.got ? el("b", "", { text: `+${l.got}` }) : null,
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
    paying.forEach(({ pay: owed }, i) => {
      const at = from[i] ?? centre(paper);
      if (owed.kind === "leaf") grant(owed.amount, "the guild, while you were away");
      // Only the made-up guild's letter pays Coins; the guild's own shows what Leaf has paid.
      else earnMadeUp(owed.amount, "while away");
      fly(owed.kind === "leaf" ? "leaf" : "coin", at, purseAt(owed.kind), 7, () => {
        bump(owed.kind);
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

// ---------- setting up ----------

/** The town's buttons along the bottom: every place, one touch away. */
export function townDock(): void {
  setDock(
    PLACES.map((pl) => ({
      id: pl.id,
      name: pl.name,
      about: pl.about,
      art: icon(pl.id),
      press: (): void => {
        if (G.panel === pl.id) closePanel();
        else hooks.visit(pl.id);
      },
    })),
  );
}

export function initUI(sprites: Sprites, art: CampArt): void {
  S = sprites;
  ART = art;
  registerCards(sprites, art);
  townDock();
}
