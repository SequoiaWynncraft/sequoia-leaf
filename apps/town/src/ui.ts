/**
 * The town's own part of the interface: a panel for each of its places, the arrival letter, and
 * the dock that goes to them. The purse, the feed, the panel's frame and the cards are shared with
 * the camp (`hud.ts`). What a button does still lands in the town behind it.
 */

import { link } from "@sequoia-leaf/kit/card.ts";
import { dialog } from "@sequoia-leaf/kit/dialog.ts";
import { amount, asking, asksAgain, el, icon as glyph, replay, shown } from "@sequoia-leaf/kit/dom.ts";
import { type Emote, EMOTES } from "@sequoia-leaf/kit/emotes.ts";
import { folkName } from "@sequoia-leaf/kit/mark.ts";
import { outside } from "@sequoia-leaf/kit/net.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import { fly } from "@sequoia-leaf/kit/pursebar.ts";
import { whole } from "@sequoia-leaf/kit/say.ts";
import { type Scope, scope } from "@sequoia-leaf/kit/scope.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";
import { tip } from "@sequoia-leaf/kit/tip.ts";
import { dist, makeCanvas, pick } from "@sequoia-leaf/kit/util.ts";
import { owned } from "@sequoia-leaf/town/camp.ts";
import { LOST_CRAB, STALLS, type Stock } from "@sequoia-leaf/town/catalogue.ts";
import { folkNamed } from "@sequoia-leaf/town/folk.ts";
import { waiting } from "@sequoia-leaf/town/mail.ts";
import { place, PLACES } from "@sequoia-leaf/town/map/map.ts";
import { thingOf } from "@sequoia-leaf/town/things.ts";

import { goSit, hop, inTown, rouse, say, sitters, stop } from "./actors.ts";
import { kindLine, noteWhen, openingTab, type QuestBoard, questBoard, redrawn, rerollSpend, TABS } from "./board.ts";
import { type CampArt, pictureOf } from "./campart.ts";
import { named, registerCards, thingRef } from "./cards.ts";
import { folkArt } from "./folkart.ts";
import { type Actor, after, G, hooks, type PanelId } from "./game.ts";
import { GAMES } from "./games.ts";
import { type AwayLine, guild, type Quest } from "./guild.ts";
import {
  $,
  button,
  centre,
  closePanel,
  dockAt,
  faceOf,
  levelBar,
  nameOf,
  openPanel as openHudPanel,
  type PanelSpec,
  pic,
  purseAt,
  setDock,
  sheet,
  slot,
  when,
} from "./hud.ts";
import { ask, mine, refusal, town } from "./leaf.ts";
import type { Letter } from "./letter.ts";
import { NOTES, type Part } from "./notes.ts";
import { emote, EMOTE_NAMES } from "./players.ts";
import { icon, type Sprites } from "./sprites.ts";
import { tallyPanel } from "./tallyui.ts";
import { LOG, thingName, touchThing } from "./town.ts";
import { usesKey } from "./townkeys.ts";
import { treasury } from "./treasury.ts";

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

// ---------- the quest board ----------

/** The quest board's quests: drawn whole again whenever they are no longer the ones it shows. */
function quests(body: HTMLElement, on: QuestBoard): () => void {
  const note = guild.boardNote();
  if (note !== null) {
    // Somebody quests are not for: one note says why, and nothing on the board moves.
    body.replaceChildren(el("div", "k-paper quest", {}, el("div", "k-read", { text: note })));
    return () => undefined;
  }
  return redrawn(
    () => guild.quests().map((q) => q.id),
    () => notes(body, on),
  );
}

/**
 * A note for each quest on the board, in place of whatever was there; gives back how to bring them
 * up to date. A quest says what it asks and what it pays, shows a bar for each way to finish it,
 * and at its foot when it ends and, when it can be rerolled, the reroll.
 */
function notes(body: HTMLElement, on: QuestBoard): () => void {
  body.replaceChildren();
  const parts = guild.quests().map((first) => {
    const pay = el("span");
    const ways = el("div", "ways");
    const kind = el("span", "k-grow k-dim");
    const side = el("span", "k-row");
    const said = el("div", "k-read k-coral", { hidden: true });
    let bars: { fill: HTMLElement; count: HTMLElement }[] = [];
    const note = el(
      "div",
      "k-paper quest",
      {},
      el("div", "k-row head", {}, el("div", "k-grow", { text: first.title }), pay),
      ways,
      el("div", "k-row foot", {}, kind, side),
      said,
    );
    body.append(note);
    const now = (): Quest => guild.quests().find((q) => q.id === first.id) ?? first;
    /** What a paid reroll of it spends, at its price now. */
    const spend = () => rerollSpend(first.id, now().reroll ?? 0);
    const press = async (b: HTMLButtonElement): Promise<void> => {
      const cost = now().reroll;
      if (cost === null) return;
      said.hidden = true;
      sfx.tap();
      // A free reroll goes at once; one that costs Leaf is asked once more.
      if (!on.reroll(now(), update)) return;
      const did = await waitingLook(b, guild.reroll(first.id, cost));
      if (!did) return;
      if ("said" in did) {
        said.textContent = did.said;
        said.hidden = false;
        sfx.no();
        replay(b, "shake");
        return;
      }
      sfx.paper();
      if (did.spent > 0) {
        sfx.buy();
        fly("leaf", purseAt("leaf"), centre(b), 5);
      }
    };
    const update = when(
      () => JSON.stringify([now().goals, now().reward, now().reroll, asking(spend())]),
      () => {
        const q = now();
        // A quest pays by itself the moment it is finished.
        const paid = q.goals.some((g) => g.have >= g.need);
        pay.replaceChildren(amount("leaf", whole(q.reward)));
        kind.textContent = paid ? "" : kindLine(q, outside.now());
        if (bars.length !== q.goals.length) {
          // Each way to finish it, its bar and its count; "or" between them.
          bars = q.goals.map(() => ({ fill: el("i"), count: el("span", "k-dim") }));
          ways.replaceChildren(
            ...bars.flatMap((b, i) => [
              ...(i > 0 ? [el("span", "k-label", { text: "or" })] : []),
              el("div", "k-col k-grow", {}, el("div", "k-bar leaf", {}, b.fill), b.count),
            ]),
          );
        }
        q.goals.forEach((g, i) => {
          const bar = bars[i];
          if (!bar) return;
          bar.fill.style.setProperty("--v", `${Math.min(100, (g.have / g.need) * 100)}%`);
          bar.count.textContent = `${g.have} / ${g.need} ${g.unit}`;
        });
        note.classList.toggle("done", paid);
        const cost = q.reroll;
        side.replaceChildren(
          paid
            ? el("span", "k-chip lit", {}, glyph("check"), "Paid")
            : cost === null
              ? ""
              : button(
                  `sm ${cost > 0 ? "leaf" : "wood"}${asking(spend()) ? " asking" : ""}`,
                  cost > 0 ? [asksAgain(spend(), ["Reroll", glyph("leaf"), whole(cost)], "Reroll?")] : ["Reroll"],
                  (b) => void press(b),
                ),
        );
      },
    );
    return update;
  });
  return () => {
    for (const f of parts) f();
  };
}

/**
 * What has changed in the game: the ten newest notes, each its lines. A note with full notes has
 * Read more under them, which opens its parts in the same paper.
 */
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
        ...(n.more ? fullNotes(n.more) : []),
      ),
    ),
  );
}

/** A note's full notes, shut, and the button that opens and shuts them. */
function fullNotes(parts: readonly Part[]): HTMLElement[] {
  const full = el(
    "div",
    "more",
    { hidden: true },
    ...parts.flatMap((p) => [
      el("div", "k-label", { text: p.head }),
      el("ul", "points", {}, ...p.points.map((text) => el("li", "k-read", { text }))),
    ]),
  );
  const toggle = button("sm blue", ["Read more"], (b) => {
    full.hidden = !full.hidden;
    b.textContent = full.hidden ? "Read more" : "Less";
    b.setAttribute("aria-expanded", String(!full.hidden));
    sfx.paper();
  });
  toggle.setAttribute("aria-expanded", "false");
  return [full, toggle];
}

/** The quest board: its quests on one tab, and on the other what has changed in the game. */
function board(body: HTMLElement, life: Scope): () => void {
  const list = el("div", "k-col");
  const on = questBoard(life);
  let update: (() => void) | null = null;
  const { row, show } = tabs(TABS, (i) => {
    on.show(TABS[i] ?? "Quests");
    // News is drawn once; the quests are brought up to date for as long as they are on show.
    update = TABS[i] === "News" ? null : quests(list, on);
    if (update) update();
    else newsTab(list);
  });
  body.append(row, list);
  show(TABS.indexOf(openingTab()));
  return () => {
    update?.();
  };
}

// ---------- tabs ----------

/** Tabs along the top of a panel, one lit at a time: tapping one, or `show`, lights it and opens what it is for. */
function tabs(labels: readonly string[], open: (i: number) => void): { row: HTMLElement; show: (i: number) => void } {
  const row = el("div", "k-tabs", { role: "tablist" });
  const show = (i: number): void => {
    [...row.children].forEach((tab, k) => {
      tab.setAttribute("aria-selected", k === i ? "true" : "false");
    });
    open(i);
  };
  labels.forEach((label, i) => {
    const tab = button("sm", [label], () => {
      sfx.tap();
      show(i);
    });
    tab.setAttribute("role", "tab");
    row.append(tab);
  });
  return { row, show };
}

// ---------- camp things, wherever they are sold ----------

/**
 * A row for one camp thing and the button that buys it (`buy`): its picture, its name, how many the
 * member has (nothing sells out) and its price. What it is like is on its card, from its picture or name.
 */
function shopRow(body: HTMLElement, s: Stock, buy: HTMLElement): () => void {
  const thing = thingOf(s.thing);
  if (!thing || !ART) return () => undefined;
  const art = ART;
  const have = el("div", "k-dim");
  const picture = thingSlot(art, thing.id);
  link(picture, thingRef(thing.id));
  const row = el(
    "div",
    "k-card ware",
    {},
    picture,
    el("div", "k-grow", {}, named(thing.name, thingRef(thing.id)), have),
    buy,
  );
  body.append(row);
  return when(
    () => String(owned(mine(), thing.id)),
    () => {
      const n = owned(mine(), thing.id);
      have.textContent = n > 0 ? `You have ${n}` : "";
      have.classList.toggle("k-gold", n > 0);
    },
  );
}

// ---------- the market ----------

/**
 * A stall's button for a thing, which asks Leaf to sell it: Leaf takes the price, and the thing
 * goes to the camp's button in the dock: it is in the camp's Storage. Refused, nothing is paid, and
 * the feed says why.
 */
function stallButton(stall: string, s: Stock, sold: () => void): HTMLElement {
  const sprite = ART ? pictureOf(ART, s.thing, 0, 0) : null;
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
      sold();
      if (sprite) fly(() => pic(sprite.c, 2), centre(me), dockAt("camp"), 1);
      if (G.player) hop(G.player);
    })();
  });
  tip(b, `${s.price} Coins`, "It goes into Storage at your camp.");
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
        }),
      ),
    );
    for (const f of rows) f();
  };
  // Each tab is its stall's first word; the keeper's bubble under them says the whole name.
  const { row, show } = tabs(
    stalls.map((stall) => stall.name.split(/[ ,]/)[0] ?? stall.name),
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
      hooks.go({ to: "game", game: id });
    });
    go.dataset.first = "";
    body.append(
      el("div", "k-row", {}, slot(shown(icon(id), 2), 34), el("div", "k-grow k-read", { text: game.about })),
      el("div", "k-paper", {}, el("div", "k-read", { text: game.waiting(town().doors) })),
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
        touchThing(LOG);
        if (G.player) nearby(G.player, ["toasty", "ooh"], 90);
      }),
    ),
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
              stop(p);
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
      if (lost) sfx.cricket();
      else touchThing(thingName("crab", n));
      said.textContent = `No. ${n} is ${note}.`;
      replay(tile, "k-bump");
    });
    tip(tile, `Crab No. ${n}`, lost ? "Never at roll call. Seen about town." : `Present. ${note}.`);
    tiles.push(tile);
    grid.append(tile);
  }
  body.append(
    button("", ["Call the roll"], () => {
      touchThing(thingName("roll"));
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

const many = (n: number, one: string, more: string): string => `${n} ${n === 1 ? one : more}`;

/** What is waiting at the camp, in a line, for the card at the gate. */
export function campWaiting(): string {
  const camp = mine();
  const letters = waiting(camp.letters);
  const fresh = camp.fresh.length;
  const parts: string[] = [];
  if (letters > 0) parts.push(`${many(letters, "letter", "letters")} in the mailbox.`);
  if (fresh > 0) parts.push(`${many(fresh, "new thing", "new things")} in Storage.`);
  if (!camp.first) parts.push("Somebody small has been waiting for you.");
  return parts.length > 0 ? parts.join(" ") : "The fire is lit. Nothing needs doing.";
}

function campCard(body: HTMLElement): () => void {
  const news = el("div", "k-read");
  const go = button("wide", ["Go home"], () => {
    hooks.go({ to: "camp" });
  });
  go.dataset.first = "";
  body.append(
    el(
      "div",
      "k-row",
      {},
      slot(shown(icon("camp"), 2), 34),
      el("div", "k-grow k-read", { text: "Your own clearing, a little way into the trees." }),
    ),
    el("div", "k-paper", {}, news),
    go,
  );
  return when(campWaiting, () => {
    news.textContent = campWaiting();
  });
}

function groveCard(body: HTMLElement): () => void {
  const open = el("div", "k-paper k-read", { hidden: true });
  const go = button("wide", ["Go in"], () => {
    hooks.go({ to: "grove" });
  });
  go.dataset.first = "";
  body.append(
    el(
      "div",
      "k-row",
      {},
      slot(shown(icon("grove"), 2), 34),
      el("div", "k-grow k-read", { text: place("grove").about }),
    ),
    open,
    go,
  );
  return when(
    () => hooks.groveBanner() ?? "",
    () => {
      const line = hooks.groveBanner();
      open.textContent = line ?? "";
      open.hidden = line === null;
    },
  );
}

function profile(body: HTMLElement): null {
  const me = guild.me();
  const p = G.player;
  const portrait = makeCanvas(12, 24);
  const frame = p?.body?.frames[0]?.[0];
  if (frame) portrait.g.drawImage(frame, 0, 0);
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
        ...levelBar(me),
      ),
    ),
    // A guest has no week with the guild to tell.
    ...(me.week.length === 0 ? [] : [sheet("This week", me.week)]),
    el(
      "div",
      "k-card",
      {},
      el(
        "div",
        "k-grow",
        {},
        "Your things",
        el("div", "k-d", { text: "Everything you win or buy goes to Storage at your camp." }),
      ),
      button("wood sm", ["Go home"], () => {
        hooks.go({ to: "camp" });
      }),
    ),
  );
  return null;
}

// ---------- panels ----------

const BUILD: Record<PanelId, PanelSpec["build"]> = {
  treasury,
  grove: groveCard,
  quests: board,
  tally: tallyPanel,
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
 * The letter that meets the member at the gate. What the guild's ledger has already paid is only
 * shown. It is a layer over the page as the others are (`dialog.ts`): the keyboard is on its button,
 * and Escape puts it away, as does a press anywhere on it or the use key. Each of those is the
 * letter's only while it is the newest layer: with a notice over it, a key is the notice's.
 */
export function showArrival(letter: Letter, done: () => void): void {
  /** What the letter holds while it is up: its lines' timers, its layer and its press. */
  const life = scope();
  const root = $("arrival");
  const title = el("h1", "k-title big", { text: letter.title });
  const paper = el("div", "k-paper k-rise letter", {}, title, el("div", "k-dim", { text: letter.sub }));
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
    life.after(420 + i * 300, () => {
      row.classList.add("in");
      sfx.paper();
    });
  });
  const go = el("button", "k-btn wide", { type: "button", text: "Into town" });
  paper.append(el("hr"), go);
  root.append(paper);
  root.hidden = false;
  const putAway = (): void => {
    arrived = null;
    life.close();
    for (const row of rows) row.classList.add("in");
    root.classList.add("gone");
    scope().after(400, () => {
      root.remove();
    });
    sfx.open();
    done();
  };
  life.hold(dialog(paper, title, putAway, usesKey(putAway)));
  go.focus({ preventScroll: true });
  life.on(root, "click", putAway);
  arrived = putAway;
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
