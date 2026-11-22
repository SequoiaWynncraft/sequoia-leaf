/**
 * The town's own part of the interface: a panel for each of its places, the arrival letter, and
 * the dock that goes to them. The purse, the feed, the panel's frame and the cards are shared with
 * the camp (`hud.ts`). What a button does still lands in the town behind it.
 */

import { type RequestKind, REQUESTS } from "@sequoia-leaf/core";
import { link } from "@sequoia-leaf/kit/card.ts";
import { asking, el, icon as glyph, pressedTwice, replay, shown } from "@sequoia-leaf/kit/dom.ts";
import { type Emote, EMOTES } from "@sequoia-leaf/kit/emotes.ts";
import { isGuest } from "@sequoia-leaf/kit/live.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { ask as askLeaf, isRecord } from "@sequoia-leaf/kit/net.ts";
import { CREAM } from "@sequoia-leaf/kit/palette.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { fromLedger } from "@sequoia-leaf/kit/purse.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { dist, makeCanvas, pick } from "@sequoia-leaf/kit/util.ts";
import { owned } from "@sequoia-leaf/town/camp.ts";
import { LOST_CRAB, STALLS, type Stock } from "@sequoia-leaf/town/catalogue.ts";
import { folk, folkNamed, KEEPER } from "@sequoia-leaf/town/folk.ts";
import { waiting } from "@sequoia-leaf/town/mail.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import { goSit, hop, inTown, release, rouse, say, sitters } from "./actors.ts";
import { noteWhen, openingTab, readNews, redrawn, TABS } from "./board.ts";
import { type CampArt, pictureOf } from "./campart.ts";
import { named, registerCards, thingRef } from "./cards.ts";
import { fling } from "./flights.ts";
import { folkArt } from "./folkart.ts";
import { puff } from "./fx.ts";
import { type Actor, after, G, hooks, type PanelId } from "./game.ts";
import { GAMES } from "./games.ts";
import { type AwayLine, guild, type Quest } from "./guild.ts";
import {
  $,
  button,
  centre,
  closePanel,
  faceOf,
  fly,
  nameOf,
  openPanel as openHudPanel,
  pic,
  purseAt,
  setDock,
  slot,
  when,
} from "./hud.ts";
import { ask, mine, refusal, town } from "./leaf.ts";
import type { Letter } from "./letter.ts";
import { NOTES } from "./notes.ts";
import { addLog, emote, EMOTE_NAMES } from "./players.ts";
import { icon, type Sprites } from "./sprites.ts";
import { nudgeCrab, rollCall } from "./town.ts";
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
    const k = n++;
    after(0.4 + k * 0.4, () => {
      hop(a);
      say(a, words[k % words.length] ?? "ooh", 2.2);
    });
  }
}

// ---------- the Treasury ----------

/** The guild's requests the Treasury sells, in the order it lists them. The backend makes them and takes the Leaf. */
const KINDS: readonly RequestKind[] = ["aspect", "tome"];
const LOST = "Could not tell whether the request went through. Check the queue in Discord before trying again.";
const UNREACHED = "The guild's requests could not be reached. Try again in a moment.";

/** A number of Leaf as the backend writes it: 3,000. */
const leafText = (n: number): string => n.toLocaleString("en-US");

/** A request's line where its button would be: why it cannot be bought, or what buying it did. */
interface Said {
  text: string;
  tone: "k-gold" | "k-coral" | "k-dim";
}

function treasury(body: HTMLElement): null {
  const keeper = folk("cinfy");
  const line = el("span", "", { text: KEEPER.hello });
  const face = slot(G.cinfy ? faceOf(G.cinfy, 3) : null, 28);
  face.classList.add("nod");
  body.append(el("div", "k-row", {}, face, el("div", "k-say left k-grow", {}, folkName(keeper.name, "k-pix"), line)));
  const reason = el("textarea", "k-field", {
    maxLength: 1000,
    rows: 2,
    placeholder: "What is the tome for?",
    "aria-label": "What is the tome for?",
  });
  /** What Leaf says each costs, while the member may buy it; what to say in place of its button otherwise. */
  const price: Partial<Record<RequestKind, number>> = {};
  const said: Partial<Record<RequestKind, Said>> = {};
  let busy = false;
  let writing = false;
  const rows = KINDS.map((kind) => {
    const side = el("div", "k-row");
    const under = el("div", "k-col");
    const art = S ? pic(kind === "tome" ? S.tome : S.aspect, 2) : glyph("star");
    const card = el(
      "div",
      "k-card",
      {},
      slot(art, 28),
      el(
        "div",
        "k-grow k-col",
        {},
        el("span", "k-pix", { text: REQUESTS[kind] }),
        el("div", "k-d", { text: "A paid request is served before the free ones." }),
        under,
      ),
      side,
    );
    body.append(card);
    return { kind, card, side, under };
  });
  const draw = (): void => {
    for (const { kind, card, side, under } of rows) {
      const cost = price[kind];
      const words = said[kind];
      const key = `request:${kind}`;
      side.replaceChildren(
        words || cost === undefined
          ? ""
          : button(
              `leaf sm${asking(key) ? " asking" : ""}`,
              asking(key) ? ["Buy?"] : [glyph("leaf"), leafText(cost)],
              (b) => {
                press(kind, b);
              },
            ),
      );
      under.replaceChildren(words ? el("div", `k-read ${words.tone}`, { text: words.text }) : "");
      if (kind === "tome" && writing && !words) card.append(reason);
      else if (kind === "tome") reason.remove();
    }
  };
  const press = (kind: RequestKind, b: HTMLButtonElement): void => {
    if (busy) return;
    if (kind === "tome" && (!writing || reason.value.trim() === "")) {
      // A tome needs what it is for: the field first, then the button buys.
      if (writing) replay(b, "shake");
      writing = true;
      draw();
      reason.focus();
      sfx.tap();
      return;
    }
    sfx.tap();
    if (pressedTwice(`request:${kind}`, draw)) void buy(kind, b);
  };
  const look = async (): Promise<void> => {
    const answer = await askLeaf("/v1/game/requests");
    for (const kind of KINDS) {
      const offer = answer.status === 200 && isRecord(answer.body) ? answer.body[kind] : null;
      const message =
        isRecord(answer.body) && typeof answer.body.message === "string" ? answer.body.message : UNREACHED;
      if (isRecord(offer) && typeof offer.price === "number") {
        price[kind] = offer.price;
        if (typeof offer.why_not === "string") said[kind] ??= { text: offer.why_not, tone: "k-dim" };
      } else said[kind] ??= { text: message, tone: "k-dim" };
    }
    draw();
  };
  const buy = async (kind: RequestKind, b: HTMLButtonElement): Promise<void> => {
    busy = true;
    const answer = await waitingLook(
      b,
      askLeaf("/v1/game/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: kind, ...(kind === "tome" ? { reason: reason.value.trim() } : {}) }),
      }),
    );
    busy = false;
    const made = answer.status === 200 && isRecord(answer.body) ? answer.body : null;
    if (
      made &&
      typeof made.position === "number" &&
      typeof made.leaf_paid === "number" &&
      typeof made.leaf === "number"
    ) {
      fromLedger(made.leaf);
      said[kind] = {
        text: `Added your ${kind} request to the queue at position #${made.position}. ${leafText(made.leaf_paid)} Leaf paid; you have ${leafText(made.leaf)} left.`,
        tone: "k-gold",
      };
      sfx.buy();
      fly("leaf", purseAt("leaf"), centre(b), 5);
      line.textContent = KEEPER.filed[0];
      replay(face, "k-bump");
      if (G.cinfy) {
        hop(G.cinfy, 2);
        say(G.cinfy, KEEPER.filed[1], 2.4);
      }
      // What the rest costs against the Leaf left.
      void look();
    } else {
      // Refused, nothing was taken, and the backend says why; anything else may have gone through.
      const message = isRecord(answer.body) ? answer.body.message : null;
      const refused = answer.status >= 400 && answer.status < 500 && typeof message === "string";
      said[kind] = { text: refused ? message : LOST, tone: "k-coral" };
      sfx.no();
      replay(b, "shake");
    }
    draw();
  };
  if (isGuest()) body.append(el("div", "k-d", { text: "For guild members with 7 days in the guild." }));
  else void look();
  return null;
}

// ---------- the quest board ----------

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
      el("div", "k-bar leaf", {}, fill),
      el("div", "k-row", {}, count, side),
      first.ends === null ? null : el("div", "k-dim", { text: `Ends at ${clock(first.ends)}` }),
    );
    body.append(note);
    const now = (): Quest => guild.quests().find((q) => q.id === first.id) ?? first;
    return when(
      () => String(now().have),
      () => {
        const q = now();
        // A quest pays by itself the moment it is finished.
        const paid = q.have >= q.need;
        fill.style.setProperty("--v", `${Math.min(100, (q.have / q.need) * 100)}%`);
        count.textContent = `${q.have} / ${q.need} ${q.unit}`;
        note.classList.toggle("done", paid);
        const prize = el("span", "k-chip", {}, el("span", "k-cur leaf", {}, glyph("leaf"), q.reward));
        if (paid) side.replaceChildren(prize, el("span", "k-chip lit", {}, glyph("check"), "Paid"));
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
        el("div", "k-label", { text: noteWhen(n.at) }),
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
 * A row for one camp thing and the button that buys it (`buy`). Nothing sells out: the row says how
 * many the member has.
 */
function shopRow(body: HTMLElement, s: Stock, buy: HTMLElement): () => void {
  const thing = thingOf(s.thing);
  if (!thing || !ART) return () => undefined;
  const art = ART;
  const have = el("div", "k-dim");
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
    () => String(owned(mine(), thing.id)),
    () => {
      const n = owned(mine(), thing.id);
      have.textContent = n > 0 ? `You have ${n === 1 ? "one" : n}.` : "";
      have.classList.toggle("k-gold", n > 0);
    },
  );
}

// ---------- the market ----------

/** Where each stall stands in town, for parcels to leave from. */
const STALL_AT = [60, 108, 156] as const;

/**
 * A stall's button for a thing, which asks Leaf to sell it: Leaf takes the price, and the parcel
 * leaves for the camp from the stall. Refused, nothing is paid, and the feed says why.
 */
function stallButton(stall: string, s: Stock, sold: () => { x: number; y: number }): HTMLElement {
  const thing = thingOf(s.thing);
  const b = button("sm", [glyph("coin"), String(s.price)], (me) => {
    void (async () => {
      const did = await ask({ do: "buy", stall, thing: s.thing }, me);
      if (!did) return;
      if ("refused" in did) {
        sfx.no();
        replay(me, "shake");
        hooks.feed(refusal(did.refused), "coral");
        return;
      }
      sfx.buy();
      fly("coin", purseAt("coins"), centre(me), Math.min(7, 2 + Math.floor(s.price / 40)));
      const from = sold();
      // It leaves for the camp at once: a parcel, up the path and out through the gate.
      if (S) fling(S.crate.c, from, { x: 256, y: 92 }, 0.9, 30, () => puff(256, 90, 4, CREAM));
      if (G.player) hop(G.player);
      if (thing) hooks.feed(`${thing.name}: on its way to your camp.`, "gold");
    })();
  });
  tip(b, `${s.price} Coins`, "It will be waiting at your camp.");
  return b;
}

function market(body: HTMLElement): () => void {
  const stalls = STALLS;
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
      shopRow(
        list,
        s,
        stallButton(stall.id, s, () => {
          if (keeper && !keeper.away) {
            rouse(keeper, 10);
            hop(keeper, 2);
            say(keeper, pick(stall.words, Math.random()), 2.6);
          }
          sfx.pluck(2 + i * 2);
          return { x: STALL_AT[i] ?? 108, y: 232 };
        }),
      ),
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

/** What the townsfolk by the fire say back to an emote. Other players see the emote itself, through the room. */
const REPLIES: Readonly<Record<Emote, readonly string[]>> = {
  wave: ["o/", "hi hi", "\\o"],
  cheer: ["woo!", "yeah!", "glory to the grove!"],
  laugh: ["ha!", "pfff", "erm. ha."],
  heart: ["\u2665", "aww", "\u2665 \u2665"],
};

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
        addLog();
        if (G.player) nearby(G.player, ["toasty", "ooh"], 90);
      }),
    ),
    el("div", "k-label", { text: "Say it" }),
    el(
      "div",
      "k-wrap",
      {},
      ...EMOTES.map((kind) =>
        button("wood sm", [glyph(kind), EMOTE_NAMES[kind]], () => {
          emote(kind);
          if (G.player) nearby(G.player, REPLIES[kind], 84);
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
          : [el("span", "k-dim", { text: "Nobody yet." })]),
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
  const said = el("div", "k-dim", { text: "Tap a crab to check on it." });
  const tally = el("div", "k-dim");
  const grid = el("div", "crabs");
  for (let n = 1; n <= 9; n++) {
    const lost = n === LOST_CRAB;
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
      said.textContent = `Eight answer. No. ${LOST_CRAB} does not.`;
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
    () => String(town().sightings),
    () => {
      const seen = town().sightings;
      const times = seen === 1 ? "once" : `${seen} times`;
      tally.textContent =
        seen === 0 ? `Nobody has spotted No. ${LOST_CRAB} yet.` : `You have spotted No. ${LOST_CRAB} ${times}.`;
    },
  );
}

// ---------- your camp, and you ----------

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six"] as const;
const many = (n: number, one: string, more: string): string => `${COUNT[n] ?? n} ${n === 1 ? one : more}`;

/** What is waiting at the camp, in a line, for the card at the gate. */
export function campWaiting(): string {
  const camp = mine();
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
        el("div", "k-dim", { text: `${me.rank} of the guild` }),
        el("div", "k-bar", {}, xp),
        el("div", "k-dim", { text: `Level ${me.level}` }),
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
                tip(chip, r, `${me.xp.toLocaleString("en")} of ${me.next.toLocaleString("en")} XP to the next level.`);
              return chip;
            }),
          ),
        ]),
    ...(me.week.length === 0
      ? []
      : [
          el(
            "div",
            "k-card",
            {},
            el("div", "k-grow", {}, "This week", el("div", "k-dim", { text: me.week.join(", ") })),
          ),
        ]),
    el(
      "div",
      "k-card",
      {},
      el("div", "k-grow", {}, "Your things", el("div", "k-d", { text: "What you have won is in your cabin." })),
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

/** The letter that meets the member at the gate. What the guild's ledger has already paid is only shown. */
export function showArrival(letter: Letter, done: () => void): void {
  const root = $("arrival");
  const paper = el(
    "div",
    "k-paper k-rise letter",
    { role: "dialog", "aria-label": letter.title },
    el("h1", "k-title big", { text: letter.title }),
    el("div", "k-dim", { text: letter.sub }),
  );
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
        l.got ? el("b", "", { text: `+${l.got}` }) : null,
      ),
    );
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
    root.classList.add("gone");
    setTimeout(() => {
      root.remove();
    }, 400);
    sfx.open();
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
  registerCards(art);
  townDock();
}
