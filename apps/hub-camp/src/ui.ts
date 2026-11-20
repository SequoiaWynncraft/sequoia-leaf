/**
 * Everything that is read rather than watched: the purse, the faces of guild-mates along the top,
 * the panels that open when the member reaches a thing, the speech bubbles and the feed. The scene
 * hands this file the facts and takes its orders back through `Camp`.
 */
import { type DecoKind, DECOS, MARKET, MATES, NAMES, QUESTS, RANKS, SHOP, TREASURY_LINES } from "./content.ts";
import type { Cv, Spr } from "./gfx.ts";
import { sfx } from "./sfx.ts";
import { COIN, ICON, LEAF } from "./sprites.ts";
import { save } from "./state.ts";

export type PanelId = "mail" | "quests" | "treasury" | "market" | "works" | "fire" | "crabs" | "profile" | "cabin" | "visit";

export interface Letter {
  icon: "leaf" | "coin" | "visit" | "gift" | "note";
  title: string;
  detail: string;
  leaf?: number;
  coins?: number;
  deco?: DecoKind;
  faces?: string[];
}

/** What the interface asks of the scene, and tells it to do. */
export interface Camp {
  face(id: string, scale?: number): Cv;
  body(): Cv;
  deco(kind: DecoKind): Cv;
  shopArt(id: string): Cv;
  letters(): Letter[];
  firstMail(): boolean;
  collect(): void;
  progress(id: string): number;
  claim(id: string): void;
  buy(id: string): boolean;
  offer(n: number): void;
  sitters(): { id: string; name: string }[];
  seated(): boolean;
  sit(): void;
  stand(): void;
  emote(kind: string): void;
  addLog(): void;
  roll(): { n: number; here: boolean }[];
  rollCall(): void;
  hideout(): string;
  here(id: string): boolean;
  visiting(): string | null;
  visit(id: string): void;
  goHome(): void;
  wave(id: string): void;
  decorate(on: boolean): void;
  trayAdd(kind: DecoKind): void;
  tidyUp(): void;
  banner(): string | null;
  toggleRose(): void;
  worksMade(): number;
  closed(): void;
}

let camp: Camp;
const $ = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

type Kid = Node | string | null | false | undefined;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}
function btn(cls: string, kids: Kid[], act: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = h("button", `b ${cls}`, ...kids);
  b.addEventListener("click", () => act(b));
  return b;
}
/** A sprite as a crisp picture at a whole-number size. */
export function pic(s: Spr | Cv, scale = 2): HTMLCanvasElement {
  const src = "c" in s ? s.c : s;
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  c.className = "px";
  c.style.width = `${src.width * scale}px`;
  c.style.height = `${src.height * scale}px`;
  return c;
}
const leafAmt = (n: number | string): HTMLElement => h("span", "amt", pic(LEAF, 1), String(n));
const coinAmt = (n: number | string): HTMLElement => h("span", "amt", pic(COIN, 1), String(n));

// ---------- the top of the screen ----------

let shownLeaf = 0;
let shownCoins = 0;
export function setPurse(leaf: number, coins: number): void {
  if (leaf !== shownLeaf) {
    $("leaf").textContent = String(Math.round(leaf));
    pulse("leafBox");
  }
  if (coins !== shownCoins) {
    $("coins").textContent = String(Math.round(coins));
    pulse("coinBox");
  }
  shownLeaf = leaf;
  shownCoins = coins;
}
function pulse(id: string): void {
  const el = $(id);
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}
/** Where a currency sits on screen, in CSS pixels: loot flies there. */
export function purseSpot(which: "leaf" | "coins"): [number, number] {
  const r = $(which === "leaf" ? "leafBox" : "coinBox").getBoundingClientRect();
  return [r.left + 9, r.top + r.height / 2];
}

const mateButtons = new Map<string, HTMLButtonElement>();
export function setMates(): void {
  for (const m of MATES) {
    const b = mateButtons.get(m.id);
    if (!b) continue;
    const here = camp.here(m.id);
    b.classList.toggle("here", here);
    b.classList.toggle("away", !here);
  }
}

let muteBtn: HTMLButtonElement;
let decorBtn: HTMLButtonElement;
export function setMuteIcon(muted: boolean): void {
  muteBtn.replaceChildren(pic(muted ? ICON.mute : ICON.sound, 2));
}
export function setDecorIcon(on: boolean): void {
  decorBtn.classList.toggle("on", on);
}

export interface Buttons {
  mute(): void;
  labels(): void;
  decorate(): void;
  mate(id: string, at: HTMLElement): void;
}

export function initUI(c: Camp, b: Buttons): void {
  camp = c;
  $("leafBox").prepend(pic(LEAF, 2));
  $("coinBox").prepend(pic(COIN, 2));
  const mates = $("mates");
  for (const m of MATES) {
    const mb = h("button", "mate away", camp.face(m.id, 2));
    mb.title = m.name;
    mb.addEventListener("click", () => b.mate(m.id, mb));
    mateButtons.set(m.id, mb);
    mates.append(mb);
  }
  const btns = $("btns");
  const q = btn("ib", ["?"], () => b.labels());
  q.title = "What is what";
  decorBtn = btn("ib", [pic(ICON.hammer, 2)], () => b.decorate());
  decorBtn.title = "Decorate";
  muteBtn = btn("ib", [], () => b.mute());
  muteBtn.title = "Sound";
  btns.append(q, decorBtn, muteBtn);
  setMuteIcon(save.muted);
  $("pclose").addEventListener("click", () => closePanel());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      hideCard();
    }
  });
}

// ---------- words in the scene ----------

export interface Said {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
}
const bubbles = new Map<string, { el: HTMLElement; text: string }>();
/** Shows exactly these bubbles, at these CSS positions. Called every frame; cheap when little changes. */
export function syncBubbles(list: readonly Said[]): void {
  const host = $("bubbles");
  for (const [id, b] of bubbles) {
    if (list.some((s) => s.id === id && s.text === b.text)) continue;
    b.el.remove();
    bubbles.delete(id);
  }
  const W = window.innerWidth;
  for (const s of list) {
    let b = bubbles.get(s.id);
    if (!b) {
      const el = h("div", "bubble", s.name ? h("b", "", s.name) : null, s.text);
      host.append(el);
      b = { el, text: s.text };
      bubbles.set(s.id, b);
    }
    const half = b.el.offsetWidth / 2 + 4;
    b.el.style.left = `${Math.round(Math.max(half, Math.min(W - half, s.x)))}px`;
    b.el.style.top = `${Math.round(Math.max(b.el.offsetHeight + 4, s.y))}px`;
  }
}

export interface Tag {
  id: string;
  text: string;
  x: number;
  y: number;
}
const tags = new Map<string, HTMLElement>();
export function syncTags(list: readonly Tag[]): void {
  const host = $("tags");
  for (const [id, el] of tags) {
    if (list.some((t) => t.id === id)) continue;
    el.remove();
    tags.delete(id);
  }
  for (const t of list) {
    let el = tags.get(t.id);
    if (!el) {
      el = h("div", "tag", t.text);
      host.append(el);
      tags.set(t.id, el);
    }
    if (el.textContent !== t.text) el.textContent = t.text;
    el.style.left = `${Math.round(t.x)}px`;
    el.style.top = `${Math.round(t.y)}px`;
  }
}

export function feed(text: string, soft = false): void {
  const host = $("feed");
  if (host.lastElementChild?.textContent === text) return;
  const el = h("div", soft ? "news soft" : "news", text);
  host.append(el);
  while (host.children.length > 3) host.firstElementChild?.remove();
  el.addEventListener("animationend", () => el.remove());
}

export function setWhere(name: string | null, home: boolean): void {
  const el = $("where");
  if (!name) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.replaceChildren(h("span", "", h("b", "", name)));
  if (!home) el.append(btn("", [pic(ICON.home, 2), "Home"], () => camp.goHome()));
}

// ---------- small cards that float by what was touched ----------

let cardEl: HTMLElement | null = null;
export function hideCard(): void {
  cardEl?.remove();
  cardEl = null;
}
export function showCard(x: number, y: number, ...kids: Kid[]): void {
  hideCard();
  const el = h("div", "panel card", ...kids);
  document.body.append(el);
  const w = el.offsetWidth;
  const hh = el.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  let top = y - hh - 10;
  if (top < 56) top = Math.min(window.innerHeight - hh - 8, y + 16);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  cardEl = el;
}
export const cardOpen = (): boolean => cardEl !== null;

export function mateCard(id: string, x: number, y: number): void {
  const m = MATES.find((mm) => mm.id === id);
  if (!m) return;
  const here = camp.here(id);
  const home = camp.visiting() === id;
  showCard(
    x,
    y,
    h("div", "talk", camp.face(id, 4), h("div", "", h("h3", "", m.name), h("span", "note", `${m.rank}, level ${m.level}`))),
    h("span", "note", home ? "At home, and glad you came." : here ? "Here, by your fire." : `At their camp, ${m.doing}.`),
    h(
      "div",
      "two",
      here || home
        ? btn("", ["Wave"], () => {
            hideCard();
            camp.wave(id);
          })
        : null,
      home
        ? btn("gold", ["Go home"], () => {
            hideCard();
            camp.goHome();
          })
        : btn("gold", ["Visit"], () => {
            hideCard();
            closePanel();
            camp.visit(id);
          }),
    ),
  );
}

/** The signpost's three arms. */
export function signCard(x: number, y: number, pickTreasury: () => void, pickMarket: () => void): void {
  showCard(
    x,
    y,
    btn("arrow left", [pic(LEAF, 1), "The Treasury"], () => {
      hideCard();
      pickTreasury();
    }),
    btn("arrow", [pic(COIN, 1), "The Market"], () => {
      hideCard();
      pickMarket();
    }),
    btn("arrow left", [pic(ICON.tent, 1), "Visit a camp"], () => {
      hideCard();
      openPanel("visit", x > window.innerWidth * 0.56);
    }),
  );
  [...(cardEl?.children ?? [])].forEach((el, n) => ((el as HTMLElement).style.animationDelay = `${n * 60}ms`));
}

// ---------- panels ----------

let open: PanelId | null = null;
let cinfySays = TREASURY_LINES.hello;
export const panelOpen = (): PanelId | null => open;
export const panelTop = (): number => $("panel").getBoundingClientRect().top;

const TITLES: Record<PanelId, [string, Spr]> = {
  mail: ["Mailbox", ICON.mail],
  quests: ["Quest board", ICON.quest],
  treasury: ["The Treasury", LEAF],
  market: ["The Market", ICON.scale],
  works: ["The Works", ICON.gear],
  fire: ["By the fire", ICON.fire],
  crabs: ["Crab pond", ICON.crab],
  profile: ["Trophy shelf", ICON.cup],
  cabin: ["Your cabin", ICON.home],
  visit: ["Visit a camp", ICON.tent],
};

export function openPanel(id: PanelId, left = false): void {
  hideCard();
  if (open !== id) sfx.open();
  if (id === "treasury" && open !== "treasury") cinfySays = TREASURY_LINES.hello;
  open = id;
  const p = $("panel");
  p.hidden = false;
  if (p.dataset.id !== id) {
    // replay the way it arrives
    p.style.animation = "none";
    void p.offsetWidth;
    p.style.animation = "";
  }
  p.dataset.id = id;
  p.classList.toggle("lefty", left);
  render(true);
}
export function closePanel(): void {
  if (!open) return;
  open = null;
  $("panel").hidden = true;
  sfx.close();
  camp.closed();
}
/** Redraws the open panel from the facts as they now are. */
export function refresh(): void {
  if (open) render(false);
}

function render(fresh: boolean): void {
  if (!open) return;
  const [title, icon] = TITLES[open];
  $("ptitle").textContent = open === "mail" && camp.firstMail() ? "While you were away" : title;
  $("picon").replaceChildren(pic(icon, 2));
  const body = $("pbody");
  // rows only make their entrance when the panel opens, not each time a number changes
  body.classList.toggle("still", !fresh);
  const scroll = body.scrollTop;
  body.replaceChildren(...BUILD[open]().filter((kid): kid is Node | string => !!kid));
  body.scrollTop = scroll;
}

function staggered(rows: HTMLElement[]): HTMLElement[] {
  rows.forEach((r, n) => (r.style.animationDelay = `${n * 90}ms`));
  return rows;
}

const LETTER_ICON: Record<Letter["icon"], Spr> = { leaf: LEAF, coin: COIN, visit: ICON.fire, gift: ICON.tent, note: ICON.mail };

const BUILD: Record<PanelId, () => Kid[]> = {
  mail: () => {
    const letters = camp.letters();
    if (!letters.length) return [h("p", "note", "Nothing new. The crabs behaved. Mostly.")];
    const rows = letters.map((l) =>
      h(
        "div",
        "row",
        l.faces?.length ? h("span", "who", ...l.faces.map((f) => camp.face(f, 2))) : pic(LETTER_ICON[l.icon], 2),
        h("div", "", l.title, h("small", "", l.detail)),
        l.leaf ? leafAmt(`+${l.leaf}`) : l.coins ? coinAmt(`+${l.coins}`) : l.deco ? pic(camp.deco(l.deco), 2) : null,
      ),
    );
    return [
      ...staggered(rows),
      btn("gold", ["Take it all"], () => {
        camp.collect();
      }),
    ];
  },

  quests: () =>
    staggered(
      QUESTS.map((q) => {
        const got = Math.min(q.need, camp.progress(q.id));
        const done = got >= q.need;
        const claimed = save.claimed.includes(q.id);
        const bar = h("div", "bar", h("i"));
        (bar.firstElementChild as HTMLElement).style.width = `${(got / q.need) * 100}%`;
        return h(
          "div",
          "row",
          leafAmt(q.leaf),
          h("div", "", q.name, h("small", "", `${q.what}: ${got} of ${q.need}`), bar, q.note ? h("small", "", q.note) : null),
          claimed
            ? h("span", "note", "Claimed")
            : btn(done ? "gold" : "", [done ? "Claim" : "..."], (b) => {
                if (!done) {
                  shake(b);
                  sfx.deny();
                  return;
                }
                camp.claim(q.id);
              }),
        );
      }),
    ),

  treasury: () => {
    const all = SHOP.every((s) => save.owned.includes(s.id));
    return [
      h("div", "talk", camp.face("cinfy", 5), h("p", "", h("b", "", "Cinfy"), all && cinfySays === TREASURY_LINES.hello ? TREASURY_LINES.all : cinfySays)),
      ...staggered(
        SHOP.map((s) => {
          const owned = save.owned.includes(s.id);
          return h(
            "div",
            "row",
            pic(camp.shopArt(s.id), 2),
            h("div", "", s.name, h("small", "", s.blurb)),
            owned
              ? s.id === "rose"
                ? btn("", [save.roseOn ? "Burning" : "Put on"], () => {
                    camp.toggleRose();
                    refresh();
                  })
                : h("span", "note", "Yours")
              : btn("gold", [pic(LEAF, 1), String(s.price)], (b) => {
                  if (save.leaf < s.price) {
                    cinfySays = TREASURY_LINES.short(s.price - save.leaf);
                    sfx.deny();
                    refresh();
                    shake(b);
                    return;
                  }
                  cinfySays = TREASURY_LINES.bought;
                  camp.buy(s.id);
                  refresh();
                }),
          );
        }),
      ),
      h("span", "note", "Leaf comes from raiding and holding land together. It buys what is nice to have, never what wins."),
    ];
  },

  market: () => [
    h("span", "note", "Things and favours, from members to members."),
    ...staggered(
      MARKET.map((l, n) => {
        const m = MATES.find((mm) => mm.id === l.by)!;
        const sent = save.offered.includes(n);
        return h(
          "div",
          "row",
          camp.face(l.by, 3),
          h("div", "", l.what, h("small", "", `${m.name}: "${l.note}"`)),
          h(
            "div",
            "",
            leafAmt(l.price),
            sent
              ? h("small", "", "Offer sent")
              : btn("", ["Offer"], () => {
                  camp.offer(n);
                  refresh();
                }),
          ),
        );
      }),
    ),
  ],

  works: () => [
    h("p", "note", "Your small factory. It runs while you are out, and what it makes is paid in Coins."),
    h("div", "row", pic(ICON.gear, 2), h("div", "", "Made since you last looked", h("small", "", "The tray on the bench fills as it runs.")), coinAmt(camp.worksMade())),
    btn("gold", [pic(ICON.gear, 1), "Step into the Works"], () => openWorks()),
    Object.assign(h("a", "note", "Or open it in its own tab"), { href: "../works/", target: "_blank", rel: "noopener" }),
  ],

  fire: () => {
    const sitters = camp.sitters();
    const seated = camp.seated();
    const emote = (label: string, kind: string): HTMLButtonElement => btn("", [label], () => camp.emote(kind));
    return [
      sitters.length
        ? h("div", "who", ...sitters.map((s) => h("span", "", camp.face(s.id, 2), s.id === "me" ? "You" : s.name)))
        : h("span", "note", "Nobody yet. The fire is patient."),
      h(
        "div",
        "two",
        seated ? btn("", ["Stand up"], () => camp.stand()) : btn("gold", ["Sit down"], () => camp.sit()),
        btn("", ["Add a log"], () => camp.addLog()),
      ),
      h("div", "grid", emote("Wave", "wave"), emote("Cheer", "cheer"), emote("Laugh", "laugh"), emote("Heart", "heart"), emote("Toast", "toast"), emote("erm", "erm")),
    ];
  },

  crabs: () => {
    const roll = camp.roll();
    const cells = roll.map((c, n) => {
      const el = h("div", c.here ? "" : "gone", `crab${c.n}`, h("small", "", c.here ? "here" : "unaccounted for"));
      el.style.animationDelay = `${n * 70}ms`;
      return el;
    });
    const gone = roll.find((c) => !c.here);
    return [
      h("div", "roll", ...cells),
      h("span", "note", gone ? `crab${gone.n} was last seen ${camp.hideout()}. Unconfirmed.` : "All nine. Suspicious."),
      h("div", "stat", h("span", "", "Crabs you have found"), h("span", "", String(save.crabsFound))),
      btn("gold", ["Call the roll"], () => {
        camp.rollCall();
        refresh();
      }),
    ];
  },

  profile: () => {
    const rank = RANKS[2];
    const bar = h("div", "bar", h("i"));
    (bar.firstElementChild as HTMLElement).style.width = "71%";
    const stat = (k: string, v: Kid): HTMLElement => h("div", "stat", h("span", "", k), h("span", "", v));
    const name = h("h3", "", save.handle);
    name.style.cssText = "margin:0;color:var(--gold);font-size:16px";
    return [
      h("div", "talk", pic(camp.body(), 3), h("div", "", name, h("span", "note", `${rank} of the guild`), h("span", "note", "Level 23"), bar, h("small", "note", "640 of 900 to level 24"))),
      stat("Leaf", leafAmt(save.leaf)),
      stat("Coins", coinAmt(save.coins)),
      stat("Raids this week", "7"),
      stat("Territory held", camp.banner() ?? "none tonight"),
      stat("Crabs found", String(save.crabsFound)),
      h("span", "note", "On the shelf: a cup for your first groot, a medal from Cinder Ridge, a crab somebody carved."),
    ];
  },

  cabin: () => [
    h("span", "note", "It is small and it is yours. Move anything in the camp, and set out what you have been given."),
    btn("gold", [pic(ICON.hammer, 1), "Decorate the camp"], () => {
      closePanel();
      camp.decorate(true);
    }),
    h("div", "stat", h("span", "", "Banner on the wall"), h("span", "", camp.banner() ?? "none yet")),
    h("div", "stat", h("span", "", "Decorations set out"), h("span", "", String(save.extras.length))),
  ],

  visit: () =>
    staggered(
      MATES.map((m) => {
        const here = camp.here(m.id);
        return h(
          "div",
          "row",
          camp.face(m.id, 3),
          h("div", "", m.name, h("small", "", here ? "by your fire right now" : m.doing)),
          btn("gold", ["Visit"], () => {
            closePanel();
            camp.visit(m.id);
          }),
        );
      }),
    ),
};

function shake(b: HTMLElement): void {
  b.classList.remove("shake");
  void b.offsetWidth;
  b.classList.add("shake");
}

// ---------- the tray, when decorating ----------

export function showTray(on: boolean): void {
  const tray = $("tray");
  tray.hidden = !on;
  if (!on) return;
  tray.replaceChildren(
    ...DECOS.map((kind) => {
      const n = save.tray[kind] ?? 0;
      const b = btn(`slot${n ? "" : " none"}`, [pic(camp.deco(kind), 2), h("i", "", String(n))], () => camp.trayAdd(kind));
      b.title = NAMES[kind];
      return b;
    }),
    btn("", ["Tidy"], () => camp.tidyUp()),
    btn("gold", ["Done"], () => camp.decorate(false)),
  );
}
export function trayRect(): DOMRect | null {
  const tray = $("tray");
  return tray.hidden ? null : tray.getBoundingClientRect();
}
export function trayHot(on: boolean): void {
  $("tray").classList.toggle("drop", on);
}

// ---------- the Works, opened over the camp ----------

function openWorks(): void {
  if (document.querySelector("#works")) return;
  const frame = h("iframe");
  frame.src = "../works/";
  frame.title = "The Works";
  const el = h(
    "div",
    "",
    h(
      "header",
      "",
      h("b", "", "The Works"),
      btn("gold", ["Back to camp"], () => el.remove()),
    ),
    frame,
  );
  el.id = "works";
  document.body.append(el);
}
