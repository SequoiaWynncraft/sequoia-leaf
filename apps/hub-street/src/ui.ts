/**
 * The page laid over the street: the purse, the feed, the dock, the panels each place opens, a
 * guild-mate's card, and the note that greets a member coming home. It draws nothing in the world;
 * it asks the game to act through `Actions`, and the game tells it when to redraw.
 */
import { icon, iconSprite, picture, type Sprite } from "./art.ts";
import { AWAY, CRAB_NAMES, me, type WareId, WARES } from "./data.ts";
import { type PlaceId, PLACES } from "./world.ts";

export type PanelId = PlaceId | "profile";
export type Emote = "wave" | "laugh" | "cheer" | "sing" | "mallow";

export interface Face {
  readonly name: string;
  readonly head: Sprite;
}
export interface MateCard {
  readonly index: number;
  readonly name: string;
  readonly rank: string;
  readonly level: number;
  readonly doing: string;
  readonly stand: Sprite;
}

export interface Actions {
  /** Open a place's panel and walk there. */
  go(id: PanelId): void;
  /** The panel was shut from the page. */
  shut(): void;
  /** These two return whether the member could pay. */
  buy(id: WareId): boolean;
  barter(index: number): boolean;
  /** `from` is where on the page the button was pressed, for what flies out of it. */
  claim(id: string, from: DOMRect): void;
  collect(from: DOMRect): void;
  sit(): void;
  emote(kind: Emote): void;
  rollCall(): void;
  greet(index: number, how: "wave" | "cheer"): void;
  mute(): boolean;
  sitters(): readonly Face[];
  cinfy(): { readonly head: Sprite; readonly line: string };
  visitors(): readonly Face[];
  player(): { readonly head: Sprite; readonly stand: Sprite };
}

function $(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`the page is missing ${selector}`);
  return found;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

/** Text with *starred* parts made bold. */
function rich(text: string): Node[] {
  return text.split("*").map((part, i) => (i % 2 ? h("b", "", part) : document.createTextNode(part)));
}

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

let act: Actions;
const panel = $("#panel");
const panelBody = $("#panel .body");
const card = $("#card");
const awayBox = $("#away");
const feedBox = $("#feed");
const hintBox = $("#hint");
let open: PanelId | null = null;
/** Small jobs the open panel wants done every half second or so: countdowns, who is sitting. */
let live: (() => void)[] = [];
let stopMini: (() => void) | null = null;
const dockButtons = new Map<PlaceId, HTMLButtonElement>();

// ---------- the purse ----------

const shown = { leaf: -1, coins: -1 };
const leafText = $("#leaf");
const coinText = $("#coins");

/** Rolls the numbers on screen toward what the member really has. Called every frame. */
export function rollNumbers(dt: number): void {
  for (const key of ["leaf", "coins"] as const) {
    const want = me[key];
    const have = shown[key];
    if (have === want) continue;
    const next = have < 0 ? want : Math.abs(want - have) < 1 ? want : have + (want - have) * Math.min(1, dt * 9);
    shown[key] = Math.abs(want - next) < 0.5 ? want : next;
    (key === "leaf" ? leafText : coinText).textContent = fmt(shown[key]);
  }
}

export function bump(which: "leaf" | "coins", short = false): void {
  const box = $(which === "leaf" ? "#leafBox" : "#coinBox");
  const cls = short ? "short" : "bump";
  box.classList.remove("bump", "short");
  void box.offsetWidth;
  box.classList.add(cls);
}

export function purseAt(which: "leaf" | "coins"): { x: number; y: number } {
  const r = $(which === "leaf" ? "#leafBox" : "#coinBox").getBoundingClientRect();
  return { x: r.left + 18, y: r.top + r.height / 2 };
}

// ---------- things that fly across the page ----------

export interface Flight {
  readonly ms?: number;
  readonly delay?: number;
  readonly arc?: number;
  readonly size?: number;
}

/** Sends a small picture from one point of the page to another along an arc, and says when it lands. */
export function fly(
  pic: Sprite,
  from: { x: number; y: number },
  to: { x: number; y: number },
  how: Flight = {},
  landed: (() => void) | null = null,
): void {
  const size = how.size ?? 24;
  const ms = how.ms ?? 620;
  const delay = how.delay ?? 0;
  const inner = picture(pic, size);
  inner.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  const outer = h("div", "fly", inner);
  outer.style.opacity = "0";
  document.body.append(outer);
  const across = outer.animate(
    [
      { transform: `translateX(${from.x}px)`, opacity: 1 },
      { transform: `translateX(${to.x}px)`, opacity: 1 },
    ],
    { duration: ms, delay, easing: "ease-in-out", fill: "forwards" },
  );
  inner.animate(
    [
      { transform: `translateY(${from.y}px) scale(0.4)`, easing: "ease-out" },
      {
        transform: `translateY(${(from.y + to.y) / 2 + (how.arc ?? -60)}px) scale(1.15)`,
        easing: "ease-in",
        offset: 0.45,
      },
      { transform: `translateY(${to.y}px) scale(0.75)` },
    ],
    { duration: ms, delay, fill: "both" },
  );
  across.addEventListener("finish", () => {
    outer.remove();
    landed?.();
  });
  across.addEventListener("cancel", () => outer.remove());
}

// ---------- the feed ----------

export function news(iconName: string, text: string): void {
  const item = h("div", "news", icon(iconName, 24), h("span", "", ...rich(text)));
  feedBox.prepend(item);
  const keep = innerWidth < 640 ? 2 : 3;
  [...feedBox.children].forEach((child, i) => {
    child.classList.toggle("old", i > 0);
    if (i >= keep) child.remove();
  });
  setTimeout(() => item.classList.add("gone"), 16_000);
  setTimeout(() => item.remove(), 16_800);
}

export function hint(text: string, seconds = 7): void {
  hintBox.textContent = text;
  hintBox.classList.add("on");
  setTimeout(() => {
    if (hintBox.textContent === text) hintBox.classList.remove("on");
  }, seconds * 1000);
}

// ---------- the panels ----------

function row(pic: Node, name: string, sub: (Node | string)[], right: Node | null, cls = ""): HTMLDivElement {
  const text = h("div", "", h("div", "name", name), h("div", "sub", ...sub));
  const r = h("div", `row ${cls}`, h("div", "pic", pic), text);
  if (right) r.append(right);
  return r;
}

function price(amount: number, onPress: () => boolean): HTMLButtonElement {
  const b = h("button", "btn", icon("leaf", 16), String(amount));
  b.addEventListener("click", () => {
    if (onPress()) return;
    b.classList.remove("no");
    void b.offsetWidth;
    b.classList.add("no");
  });
  return b;
}

function says(head: Sprite, who: string, line: string): HTMLDivElement {
  return h("div", "says", h("div", "face", picture(head, 36)), h("div", "", h("span", "label", who), h("q", "", line)));
}

const two = (n: number): string => String(n).padStart(2, "0");
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

function treasury(): Node[] {
  const c = act.cinfy();
  return [
    says(c.head, "Cinfy, keeper of the Treasury", c.line),
    ...WARES.map((ware) =>
      row(
        icon(ware.icon, 36),
        ware.name,
        [ware.blurb],
        me.owned.has(ware.id) ? h("span", "tag", "Yours") : price(ware.price, () => act.buy(ware.id)),
        me.owned.has(ware.id) ? "done" : "",
      ),
    ),
    h("div", "note", "Leaf is earned in raids and wars with the guild. It is spent here, and nowhere in a hurry."),
  ];
}

function quests(): Node[] {
  return [
    ...me.quests.map((q) => {
      const ready = q.have >= q.need && !q.claimed;
      const bar = h("div", "bar", h("i"));
      const fill = bar.firstElementChild;
      if (fill instanceof HTMLElement) fill.style.width = `${Math.min(100, (q.have / q.need) * 100)}%`;
      const left = h("span", "", "");
      const sub: Node[] = [bar, h("span", "", `${Math.min(q.have, q.need)} / ${q.need}${q.unit}`), left];
      if (q.closes > 0 && !q.claimed) {
        const tell = (): void => {
          left.textContent = ` · open for ${clock(q.closes)}`;
        };
        tell();
        live.push(tell);
      }
      let right: Node;
      if (q.claimed) right = h("span", "tag", "Claimed");
      else if (ready) {
        const b = h("button", "btn", "Claim ", icon("leaf", 16), `+${q.reward}`);
        b.addEventListener("click", () => act.claim(q.id, b.getBoundingClientRect()));
        right = b;
      } else right = h("span", "note", icon("leaf", 16), `+${q.reward}`);
      if (right instanceof HTMLElement && !ready && !q.claimed) {
        right.style.display = "flex";
        right.style.gap = "4px";
        right.style.alignItems = "center";
      }
      return row(
        icon(q.closes > 0 ? "lantern" : "scroll", 36),
        q.title,
        sub,
        right,
        q.claimed ? "done" : ready ? "ready" : "",
      );
    }),
    h(
      "div",
      "note",
      "New notices go up through the day. The guild-wide ones are open to everyone for a while, then come down.",
    ),
  ];
}

function market(): Node[] {
  return [
    h("div", "note", "Things and favours, from member to member. Paid in Leaf."),
    ...me.listings.map((l, i) =>
      row(
        icon(l.icon, 36),
        l.item,
        [`from ${l.seller} · ${l.note}`],
        l.bought ? h("span", "tag", "Yours") : price(l.price, () => act.barter(i)),
        l.bought ? "done" : "",
      ),
    ),
  ];
}

/** A belt with things riding it, for when the Works itself cannot be shown in the panel. */
function miniWorks(canvas: HTMLCanvasElement): () => void {
  canvas.width = 160;
  canvas.height = 48;
  const g = canvas.getContext("2d");
  const tones = ["#e2bd72", "#e8e2d4", "#c65a44", "#f5b95e", "#8bbf5a"];
  let t = 0;
  const draw = (): void => {
    if (!g) return;
    t += 1;
    g.fillStyle = "#1b1220";
    g.fillRect(0, 0, 160, 48);
    for (let x = 0; x < 160; x += 8) {
      g.fillStyle = (x / 8) % 2 ? "#261b2e" : "#231829";
      g.fillRect(x, 0, 8, 48);
    }
    g.fillStyle = "#4b3d5c";
    g.fillRect(0, 20, 160, 10);
    g.fillStyle = "#8f7fa8";
    for (let x = -8 + (t % 8); x < 160; x += 8) g.fillRect(x, 24, 3, 2);
    for (let i = 0; i < 7; i++) {
      const x = ((i * 26 + t * 1) % 186) - 12;
      g.fillStyle = "#1a0f1e";
      g.fillRect(x - 1, 21, 8, 8);
      g.fillStyle = tones[i % tones.length] ?? "#f5b95e";
      g.fillRect(x, 22, 6, 6);
    }
    for (const [x, c] of [
      [10, "#6a4a3a"],
      [70, "#5a4a7a"],
      [126, "#3f6a78"],
    ] as const) {
      g.fillStyle = "#1a0f1e";
      g.fillRect(x - 1, 3, 18, 15);
      g.fillStyle = c;
      g.fillRect(x, 4, 16, 13);
      g.fillStyle = "#f5b95e";
      g.fillRect(x + 2, 14, ((t + x) % 12) + 1, 2);
    }
    g.fillStyle = "#54286a";
    g.fillRect(138, 30, 20, 16);
    g.strokeStyle = "#f5b95e";
    g.strokeRect(139.5, 31.5, 17, 13);
  };
  draw();
  const timer = setInterval(draw, 90);
  return () => clearInterval(timer);
}

/** Shows the real factory in the panel, when it is being served beside this page. */
async function showFactory(holder: HTMLElement): Promise<void> {
  try {
    // On a phone the factory wants the whole screen, so there it keeps to its own tab.
    if (innerWidth < 640) return;
    const res = await fetch("../works/", { method: "HEAD" });
    if (!res.ok || open !== "works" || !holder.isConnected) return;
  } catch {
    return;
  }
  const frame = h("iframe", "works");
  frame.src = "../works/";
  frame.title = "The Works";
  stopMini?.();
  stopMini = null;
  holder.replaceChildren(frame);
  panel.classList.add("wide");
}

function works(): Node[] {
  const holder = h("div");
  const link = h("a", "btn", "Open the Works in its own tab");
  link.href = "../works/";
  link.target = "_blank";
  link.rel = "noopener";
  const mini = h("canvas", "mini");
  holder.append(mini);
  stopMini = miniWorks(mini);
  void showFactory(holder);
  return [
    h(
      "div",
      "stats",
      h("div", "stat", h("span", "label", "Made while you were away"), h("b", "", `+${fmt(AWAY.coins)} coins`)),
      h("div", "stat", h("span", "label", "On the belts"), h("b", "", "planks, ingots")),
    ),
    holder,
    h("div", "note", "Your own small factory. What it makes is paid in Coins, and Coins buy more of it."),
    link,
  ];
}

function fire(): Node[] {
  const list = h("div", "sitters");
  const tell = (): void => {
    const sitting = act.sitters();
    list.replaceChildren(
      ...(sitting.length
        ? sitting.map((s) => h("div", "sitter", h("span", "face", picture(s.head, 24)), s.name))
        : [h("span", "note", "Nobody just now. The fire is keeping itself company.")]),
    );
  };
  tell();
  live.push(tell);
  const seat = h("button", "btn", me.seated ? "Stand up" : "Sit down");
  seat.addEventListener("click", () => act.sit());
  const emotes: readonly (readonly [Emote, string, string])[] = [
    ["wave", "wave", "Wave"],
    ["laugh", "laugh", "Laugh"],
    ["cheer", "star", "Cheer"],
    ["sing", "note", "Sing"],
    ["mallow", "mallow", "Toast"],
  ];
  return [
    h("span", "label", "Round the fire"),
    list,
    seat,
    h("span", "label", "Say it without words"),
    h(
      "div",
      "emotes",
      ...emotes.map(([kind, pic, word]) => {
        const b = h("button", "btn quiet", icon(pic, 24), word);
        b.addEventListener("click", () => act.emote(kind));
        return b;
      }),
    ),
  ];
}

const rollRows: HTMLDivElement[] = [];

function pond(): Node[] {
  rollRows.length = 0;
  const grid = h("div", "roll");
  CRAB_NAMES.forEach((epithet, i) => {
    const gone = i + 1 === me.missing;
    const r = h(
      "div",
      gone ? "gone" : "here",
      h("b", "", String(i + 1)),
      h("span", "", epithet),
      h("em", "", gone ? "missing" : "here"),
    );
    rollRows.push(r);
    grid.append(r);
  });
  const call = h("button", "btn", "Call the roll");
  call.addEventListener("click", () => act.rollCall());
  return [
    h(
      "div",
      "says",
      h("div", "face", icon("crab", 36)),
      h(
        "div",
        "",
        h("span", "label", "The crab pond"),
        h("q", "", "Twelve crabs live here. Eleven answer. This is normal."),
      ),
    ),
    grid,
    call,
    h(
      "div",
      "note",
      me.found
        ? `You have walked ${me.found} stray ${me.found === 1 ? "crab" : "crabs"} home. Another always wanders off.`
        : "The missing one is usually somewhere along the street, looking pleased with itself.",
    ),
  ];
}

/** During a roll call: marks a crab as being called, then as here or missing. */
export function markRoll(index: number, state: "call" | "here" | "gone" | "wait"): void {
  const r = rollRows[index];
  if (!r) return;
  r.className = state === "wait" ? "" : state === "call" ? "call" : state;
  const em = r.querySelector("em");
  if (em) em.textContent = state === "here" ? "here" : state === "gone" ? "missing" : state === "call" ? "…" : "";
}

function profile(): Node[] {
  const p = act.player();
  const bar = h("div", "bar", h("i"));
  const fill = bar.firstElementChild;
  if (fill instanceof HTMLElement) fill.style.width = `${me.xp * 100}%`;
  const owned = WARES.filter((w) => me.owned.has(w.id));
  return [
    h(
      "div",
      "hero",
      h("div", "stand", picture(p.stand, 123)),
      h(
        "div",
        "",
        h("h3", "", me.name),
        h("div", "", `${me.rank} · level ${me.level}`),
        bar,
        h("div", "note", `${Math.round(me.xp * 100)}% of the way to level ${me.level + 1}`),
      ),
    ),
    h(
      "div",
      "stats",
      h("div", "stat", h("span", "label", "Leaf"), h("b", "", fmt(me.leaf))),
      h("div", "stat", h("span", "label", "Coins"), h("b", "", fmt(me.coins))),
      h("div", "stat", h("span", "label", "Raids this week"), h("b", "", String(me.raidsThisWeek))),
      h("div", "stat", h("span", "label", "Stray crabs walked home"), h("b", "", String(me.found))),
    ),
    h("span", "label", "Yours"),
    owned.length
      ? h("div", "sitters", ...owned.map((w) => h("div", "sitter", icon(w.icon, 24), w.name)))
      : h("div", "note", "Nothing yet. Cinfy would like a word."),
  ];
}

function camp(): Node[] {
  const faces = act.visitors();
  return [
    h(
      "div",
      "says",
      h("div", "face", icon("camp", 36)),
      h(
        "div",
        "",
        h("span", "label", "Down the left-hand path"),
        h("q", "", "A corner of the grove that is only yours. The path is roped off while it is being cleared."),
      ),
    ),
    h("span", "label", "Stopped by while you were out"),
    h("div", "sitters", ...faces.map((f) => h("div", "sitter", h("span", "face", picture(f.head, 24)), f.name))),
    h("div", "note", "This is a stand-in: the camp itself is not built yet."),
  ];
}

const BUILD: Record<PanelId, { readonly title: string; readonly icon: string; readonly body: () => Node[] }> = {
  treasury: { title: "The Treasury", icon: "sun", body: treasury },
  quests: { title: "Quest board", icon: "scroll", body: quests },
  market: { title: "Market", icon: "stall", body: market },
  works: { title: "The Works", icon: "gear", body: works },
  fire: { title: "Campfire", icon: "fire", body: fire },
  pond: { title: "Crab pond", icon: "crab", body: pond },
  profile: { title: "You", icon: "person", body: profile },
  camp: { title: "Your camp", icon: "camp", body: camp },
};

/** Redraws the open panel from the member's state, keeping the scroll where it was. */
export function refresh(): void {
  if (!open) return;
  const at = panelBody.scrollTop;
  live = [];
  stopMini?.();
  stopMini = null;
  panel.classList.remove("wide");
  panelBody.replaceChildren(...BUILD[open].body());
  panelBody.scrollTop = at;
  setQuestDot();
}

export function openPanel(id: PanelId): void {
  hideCard();
  open = id;
  const b = BUILD[id];
  $("#panel h2").textContent = b.title;
  $("#panel .ic").replaceChildren(icon(b.icon, 24));
  panelBody.scrollTop = 0;
  refresh();
  panel.classList.add("on");
}

export function closePanel(): void {
  if (!open) return;
  open = null;
  live = [];
  stopMini?.();
  stopMini = null;
  panel.classList.remove("on");
}

export const openNow = (): PanelId | null => open;

/** Called a couple of times a second while a panel is open. */
export function pulse(): void {
  for (const job of live) job();
}

/** Where the open panel sits on the page, so the street can keep what matters clear of it. */
export function panelBox(): DOMRect | null {
  return open ? panel.getBoundingClientRect() : null;
}

// ---------- the dock ----------

function setQuestDot(): void {
  const b = dockButtons.get("quests");
  if (!b) return;
  const ready = me.quests.some((q) => q.have >= q.need && !q.claimed);
  b.querySelector(".dot")?.remove();
  if (ready) b.append(h("i", "dot"));
}
export const questDot = setQuestDot;

export function setHere(id: PlaceId | null): void {
  for (const [key, b] of dockButtons) b.classList.toggle("here", key === id);
}

// ---------- a guild-mate's card ----------

let cardFor = -1;
export const cardOpenFor = (): number => cardFor;

export function showCard(m: MateCard, x: number, y: number): void {
  cardFor = m.index;
  const wave = h("button", "btn", icon("wave", 16), "Wave");
  wave.addEventListener("click", () => act.greet(m.index, "wave"));
  const cheer = h("button", "btn quiet", icon("star", 16), "Cheer");
  cheer.addEventListener("click", () => act.greet(m.index, "cheer"));
  card.replaceChildren(
    h(
      "div",
      "top",
      h("div", "stand", picture(m.stand, 82)),
      h("div", "", h("h3", "", m.name), h("div", "", `${m.rank} · level ${m.level}`), h("div", "note", m.doing)),
    ),
    h("div", "acts", wave, cheer),
  );
  card.classList.remove("on");
  void card.offsetWidth;
  card.classList.add("on");
  const box = card.getBoundingClientRect();
  const left = Math.max(8, Math.min(innerWidth - box.width - 8, x - box.width / 2));
  const above = y - box.height - 14;
  card.style.left = `${left}px`;
  card.style.top = `${above < 60 ? y + 24 : above}px`;
}

export function hideCard(): void {
  cardFor = -1;
  card.classList.remove("on");
}

// ---------- coming home ----------

export function showAway(): void {
  const faces = act.visitors();
  const names = faces.map((f) => f.name);
  const heads = h("div", "heads", ...faces.map((f) => picture(f.head, 24)));
  const go = h("button", "btn", "Gather it up");
  const rows = [
    h(
      "div",
      "got",
      icon("leaf", 28),
      h("span", "", `${AWAY.raids} raids with your guild-mates`),
      h("b", "", `+${AWAY.leaf}`),
    ),
    h("div", "got", icon("coin", 28), h("span", "", "The Works kept turning"), h("b", "", `+${fmt(AWAY.coins)}`)),
    h("div", "got", icon("camp", 28), h("span", "", `${names.join(" and ")} stopped by your camp`), heads),
  ];
  awayBox.replaceChildren(h("span", "label", "Welcome home"), h("h2", "", "While you were away"), ...rows, go);
  awayBox.classList.add("on");
  rows.forEach((r, i) => setTimeout(() => r.classList.add("in"), 250 + i * 280));
  go.addEventListener("click", () => {
    go.disabled = true;
    act.collect(go.getBoundingClientRect());
  });
}

/** Where on the page the note's first two lines are, for what flies out of them. */
export function awayRows(): DOMRect[] {
  return [...awayBox.querySelectorAll(".got")].map((r) => r.getBoundingClientRect());
}
export function hideAway(): void {
  awayBox.classList.remove("on");
}
export const awayShowing = (): boolean => awayBox.classList.contains("on");

// ---------- setting up ----------

export function setMuteIcon(muted: boolean): void {
  $("#mute").replaceChildren(icon(muted ? "soundOff" : "soundOn", 24));
}

export function initUI(actions: Actions, muted: boolean): void {
  act = actions;
  $("#leafBox").prepend(icon("leaf", 24));
  $("#coinBox").prepend(icon("coin", 24));
  const p = act.player();
  $("#me").append(
    h("span", "face", picture(p.head, 26)),
    h("span", "who", h("b", "", me.name), h("span", "", `${me.rank} · level ${me.level}`)),
  );
  $("#me").addEventListener("click", () => act.go("profile"));
  $("#leafBox").addEventListener("click", () => act.go("treasury"));
  $("#coinBox").addEventListener("click", () => act.go("works"));
  setMuteIcon(muted);
  $("#mute").addEventListener("click", () => setMuteIcon(act.mute()));
  $("#panel .x").addEventListener("click", () => act.shut());
  const dock = $("#dock");
  for (const stop of PLACES) {
    const b = h("button", "stop", icon(stop.icon, 24), h("small", "", stop.short));
    b.setAttribute("aria-label", stop.name);
    b.addEventListener("click", () => {
      b.classList.remove("pop");
      void b.offsetWidth;
      b.classList.add("pop");
      act.go(stop.id);
    });
    dockButtons.set(stop.id, b);
    dock.append(b);
  }
  setQuestDot();
  // Pre-warm the pictures the panels use, so the first opening does not stutter.
  for (const w of WARES) iconSprite(w.icon);
}
