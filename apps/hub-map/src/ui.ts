/**
 * The page around the map: the purse, the dock, the feed, the panel for each place, a guild-mate's
 * card, and the card that sums up what happened while the member was away. Everything shown is
 * stand-in content; none of it is fetched.
 */
import { isMuted, setMuted, sfx, unlock } from "./audio.ts";
import * as fx from "./fx.ts";
import {
  buy,
  cinfy,
  crabsHop,
  deliver,
  doing,
  DROP_AT,
  emote,
  type FeedEntry,
  gainCoins,
  gainLeaf,
  HIDES,
  hop,
  lanterns,
  type Member,
  members,
  owned,
  quests,
  raids,
  refreshQuests,
  say,
  SHOP,
  state,
  stray,
  works,
  you,
} from "./game.ts";
import type { Lands } from "./lands.ts";
import { P } from "./palette.ts";
import { type IconId, ICONS, iconEl } from "./pix.ts";
import { skinEl } from "./skins.ts";
import { cam, flyTo, poke, toScreen, view } from "./view.ts";
import { type GateId, GATES, NODES, type PlaceId, PLACES, ROPE, WORKS } from "./world.ts";

/** What the interface asks of the rest: filled in by `main`. */
export const act = {
  goTo: (_id: PlaceId): void => {},
  ping: (_x: number, _y: number): void => {},
  zoom: (_factor: number): void => {},
};

type Kid = Node | string | null | false;
type Props = { class?: string; text?: string; html?: string; title?: string; style?: string; on?: (e: Event) => void };
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props?.class) el.className = props.class;
  if (props?.text !== undefined) el.textContent = props.text;
  if (props?.html !== undefined) el.innerHTML = props.html;
  if (props?.title) el.title = props.title;
  if (props?.style) el.style.cssText = props.style;
  if (props?.on) el.addEventListener("click", props.on);
  for (const k of kids) if (k) el.append(k);
  return el;
}
const $ = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`) as T;
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)] as T;
const centre = (el: Element): { x: number; y: number } => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const phone = (): boolean => innerWidth <= 720;
let lands: Lands;

// ---------- the purse ----------

const shown = { leaf: state.leaf, coins: state.coins };
const leafEl = $("leaf");
const coinsEl = $("coins");
const leafNum = h("span", { text: String(state.leaf) });
const coinNum = h("span", { text: String(state.coins) });
leafEl.append(iconEl("leaf", 2), leafNum);
coinsEl.append(iconEl("coin", 2), coinNum);

export function purseChanged(what: "leaf" | "coins", delta: number): void {
  const el = what === "leaf" ? leafEl : coinsEl;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  const note = h("em", { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`, class: delta > 0 ? "" : "less" });
  el.append(note);
  setTimeout(() => note.remove(), 1300);
}

/** Small pictures fly from a point on screen to the purse, each landing with a tick. */
export function flyToPurse(what: "leaf" | "coins", from: { x: number; y: number }, n: number): void {
  const to = centre(what === "leaf" ? leafEl : coinsEl);
  for (let i = 0; i < n; i++)
    fx.fly(
      fx.topFlights,
      {
        icon: what === "leaf" ? ICONS.leaf : ICONS.coin,
        x0: from.x + (Math.random() - 0.5) * 30,
        y0: from.y + (Math.random() - 0.5) * 20,
        x1: to.x - 20,
        y1: to.y,
        dur: 0.65 + Math.random() * 0.2,
        arc: 50 + Math.random() * 70,
        scale: 2.4,
        done: () => {
          (what === "leaf" ? sfx.pop : sfx.coin)();
          const el = what === "leaf" ? leafEl : coinsEl;
          el.classList.remove("bump");
          void el.offsetWidth;
          el.classList.add("bump");
        },
      },
      i * 0.07,
    );
}

// ---------- the feed ----------

const feedList = $("feedlist");
const feedItems: { el: HTMLLIElement; at: number; age: HTMLElement }[] = [];
export function pushFeed(e: FeedEntry): void {
  const age = h("small", { text: e.earlier ? "while you were away" : "just now" });
  const text = h("div", { html: e.html });
  text.append(age);
  const el = h("li", { class: "new" }, iconEl(e.icon, 2), text);
  el.addEventListener("click", () => {
    unlock();
    sfx.go();
    closeCard();
    flyTo(e.x, e.y, Math.max(cam.z, 3));
    act.ping(e.x, e.y);
    el.classList.remove("new");
  });
  feedList.prepend(el);
  feedList.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  if (e.earlier) el.classList.remove("new");
  else feedItems.unshift({ el, at: state.T, age });
  setTimeout(() => el.classList.remove("new"), 3200);
  while (feedItems.length > 30) feedItems.pop()?.el.remove();
  while (feedList.children.length > 34) feedList.lastElementChild?.remove();
}
function ageFeed(): void {
  for (const f of feedItems) {
    const s = state.T - f.at;
    f.age.textContent = s < 12 ? "just now" : s < 60 ? `${Math.floor(s / 10) * 10} seconds ago` : `${Math.floor(s / 60)} min ago`;
    f.el.classList.toggle("old", s > 90);
  }
}

// ---------- the dock ----------

const DOCK: { id: PlaceId; icon: IconId | null; label: string }[] = [
  { id: "treasury", icon: "vault", label: "Treasury" },
  { id: "board", icon: "scroll", label: "Quests" },
  { id: "market", icon: "stall", label: "Market" },
  { id: "works", icon: "cog", label: "Works" },
  { id: "fire", icon: "flame", label: "Campfire" },
  { id: "pond", icon: "crab", label: "Crabs" },
  { id: "camp", icon: null, label: "Camp" },
];
const dock = $("dock");
const dockButtons = new Map<PlaceId, HTMLButtonElement>();
let dockPhone: boolean | null = null;
let goingTo: PlaceId | null = null;
function buildDock(): void {
  if (dockPhone === phone()) return;
  dockPhone = phone();
  dock.replaceChildren();
  for (const d of DOCK) {
    const scale = dockPhone ? 2 : 3;
    const pic = d.icon ? iconEl(d.icon, scale) : skinEl(you.skin.face, dockPhone ? 3 : 4.5);
    const b = h("button", { class: "plate", title: d.label }, pic, h("span", { text: d.label }));
    b.addEventListener("click", () => {
      unlock();
      act.goTo(d.id);
    });
    dock.append(b);
    dockButtons.set(d.id, b);
  }
}
export function setGoing(id: PlaceId | null): void {
  goingTo = id;
  markDock();
}
function markDock(): void {
  for (const [id, b] of dockButtons) {
    const p = PLACES.find((pl) => pl.id === id);
    b.classList.toggle("here", !!p && you.at === p.node && !you.route);
    b.classList.toggle("going", goingTo === id);
  }
  dockButtons.get("board")?.classList.toggle("ready", quests.some((q) => !q.claimed && q.have >= q.need));
  dockButtons.get("works")?.classList.toggle("ready", works.ready >= 40);
}

// ---------- toasts ----------

const toastBox = $("toast");
export function toast(text: string): void {
  const el = h("div", { text });
  toastBox.append(el);
  while (toastBox.children.length > 2) toastBox.firstElementChild?.remove();
  setTimeout(() => el.remove(), 3200);
}

// ---------- panels ----------

const panel = $("panel");
let openId: PlaceId | null = null;
/** Small jobs that keep an open panel's numbers true; run once a second. */
let live: (() => void)[] = [];
export const panelOpen = (): PlaceId | null => openId;

/** Tells the map how much of each edge the interface covers, so it centres in what is left. */
export function layout(): void {
  const away = document.body.classList.contains("away");
  if (phone()) {
    view.wantL = 0;
    view.wantR = 0;
    view.wantT = away ? 0 : 50;
    view.wantB = openId ? Math.min(innerHeight * 0.6, panel.offsetHeight) : away ? 0 : 132;
    view.coverR = 0;
    view.coverB = away ? 0 : 68;
  } else {
    view.wantL = openId ? 396 : 0;
    view.wantR = away ? 0 : 280;
    view.wantT = 0;
    view.wantB = away ? 0 : 64;
    view.coverR = away ? 0 : 280;
    view.coverB = 0;
  }
}

export function openPanel(id: PlaceId): void {
  openId = id;
  drawPanel();
  panel.classList.add("open");
  sfx.open();
  layout();
}
export function closePanel(): void {
  if (!openId) return;
  openId = null;
  live = [];
  panel.classList.remove("open");
  sfx.close();
  layout();
}

const TITLES: Record<PlaceId, [IconId, string]> = {
  town: ["lantern", "Guild Town"],
  treasury: ["vault", "The Treasury"],
  board: ["scroll", "Quest board"],
  market: ["stall", "The Market"],
  fire: ["flame", "The campfire"],
  works: ["cog", "The Works"],
  pond: ["crab", "The crab pond"],
  camp: ["leaf", "Your camp"],
  gateA: ["lantern", GATES.gateA.name],
  gateB: ["lantern", GATES.gateB.name],
  gateC: ["lantern", GATES.gateC.name],
};

function drawPanel(): void {
  if (!openId) return;
  live = [];
  const [icon, title] = TITLES[openId];
  const body = h("div", { class: "body" });
  const close = h("button", { class: "x", text: "✕", title: "Close", on: closePanel });
  panel.replaceChildren(h("header", null, iconEl(icon, 2), h("h2", { text: title }), close), body);
  switch (openId) {
    case "treasury":
      treasury(body);
      break;
    case "board":
      board(body);
      break;
    case "market":
      market(body);
      break;
    case "works":
      worksPanel(body);
      break;
    case "fire":
      fire(body);
      break;
    case "pond":
      pond(body);
      break;
    case "camp":
      camp(body);
      break;
    case "gateA":
    case "gateB":
    case "gateC":
      gate(body, openId);
      break;
    case "town":
      break;
  }
}

const speaker = (pic: HTMLElement, text: string): [HTMLElement, HTMLElement] => {
  const line = h("p", { text });
  return [h("div", { class: "says" }, h("div", { class: "portrait" }, pic), line), line];
};
const tell = (line: HTMLElement, text: string): void => {
  line.textContent = text;
  line.classList.remove("pop");
  void line.offsetWidth;
  line.classList.add("pop");
};
const shake = (el: HTMLElement): void => {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
};

// ----- Treasury: Cinfy's shop -----

let buying = false;
function treasury(body: HTMLElement): void {
  const [says, line] = speaker(
    skinEl(cinfy.skin.face, 7),
    pick(["Welcome back! It's all still here. I counted. Twice.", "Ah, a customer. Mind the gold, it's been polished.", "Everything is for sale except the door."]),
  );
  body.append(says);
  for (const item of SHOP) {
    const has = item.id === "lantern" ? owned.lantern : item.id === "sapling" ? owned.sapling : false;
    const btn = h("button", { class: "btn" }, iconEl("leaf", 1.5), String(item.cost));
    const row = h(
      "div",
      { class: "row" },
      iconEl(item.icon, 3),
      h("div", null, h("h3", { text: item.name }), h("p", { text: item.text })),
      has ? h("span", { class: "note", html: "<b>Yours</b>" }) : btn,
    );
    btn.addEventListener("click", () => {
      if (buying) return;
      if (!buy(item.id)) {
        sfx.no();
        shake(btn);
        tell(line, "Not quite enough Leaf, friend. Go and raid something.");
        return;
      }
      buying = true;
      sfx.buy();
      const from = centre(leafEl);
      const to = centre(btn);
      for (let i = 0; i < 5; i++)
        fx.fly(fx.topFlights, { icon: ICONS.leaf, x0: from.x, y0: from.y, x1: to.x, y1: to.y, dur: 0.5, arc: -40, scale: 2.2, done: null }, i * 0.06);
      row.append(h("div", { class: "stamp", text: "SOLD" }));
      btn.disabled = true;
      tell(line, item.id === "snacks" ? "The crabs thank you. Probably. Off to the pond it goes." : "A fine choice! I'll have it sent straight to your camp.");
      hop(cinfy);
      emote(cinfy, "leaf", 1.6);
      setTimeout(() => {
        closePanel();
        const at = DROP_AT[item.id];
        flyTo(at.x, at.y - 8, 4.2, 1);
        setTimeout(() => {
          deliver(item.id);
          buying = false;
        }, 1050);
        setTimeout(() => toast(item.id === "snacks" ? "The crabs have their snacks." : `${item.name}: delivered to your camp.`), 1900);
      }, 1000);
    });
    body.append(row);
  }
  body.append(h("p", { class: "note", html: "Leaf is earned with the guild, in raids and wars. Spend it slowly, or don't." }));
}

// ----- the quest board -----

function board(body: HTMLElement): void {
  refreshQuests();
  const icons: IconId[] = ["lantern", "banner", "cog"];
  quests.forEach((q, i) => {
    const ready = !q.claimed && q.have >= q.need;
    const btn = h("button", { class: "btn" }, ready ? "Claim " : "", iconEl("leaf", 1.5), String(q.reward));
    btn.disabled = !ready;
    const fill = h("i", { style: `width:${Math.min(100, (q.have / q.need) * 100)}%` });
    const row = h(
      "div",
      { class: `row${q.claimed ? " done" : ready ? " glow" : ""}` },
      iconEl(icons[i] as IconId, 3),
      h("div", null, h("h3", { text: q.title }), h("p", { text: `${q.text} ${Math.min(q.have, q.need)} of ${q.need}.` }), h("div", { class: "bar" }, fill)),
      q.claimed ? h("span", { class: "note", html: "<b>Claimed</b>" }) : btn,
    );
    btn.addEventListener("click", () => {
      q.claimed = true;
      sfx.leaf();
      flyToPurse("leaf", centre(btn), 9);
      fx.celebrate(view.w, [P.gold1, P.gold2, P.g4, P.cream, P.rose], 46);
      setTimeout(() => gainLeaf(q.reward), 600);
      hop(you);
      emote(you, "leaf", 1.8);
      drawPanel();
      markDock();
    });
    body.append(row);
  });
  body.append(h("p", { class: "note", html: "Quests fill as the guild plays. The board is checked at dusk, which it always is." }));
}
/** A quest has moved on: redraw the board if it is open, and say so if one has just become ready. */
let readyBefore = quests.filter((q) => !q.claimed && q.have >= q.need).length;
export function questsChanged(): void {
  refreshQuests();
  const ready = quests.filter((q) => !q.claimed && q.have >= q.need).length;
  if (ready > readyBefore) toast("A quest is ready to claim at the board.");
  readyBefore = ready;
  if (openId === "board") drawPanel();
  markDock();
}

// ----- the Market -----

const LISTINGS = [
  { who: "Bramblewick", item: "Three raid carries", text: "Will carry. Will also narrate.", price: 45, cur: "leaf" },
  { who: "Tansyfoot", item: "A hand-drawn nametag icon", text: "Your face, but rounder.", price: 20, cur: "leaf" },
  { who: "Oakum", item: "A stack of planks", text: "Sixty-four. Counted by Cinfy.", price: 300, cur: "coin" },
  { who: "Pipkin", item: "A crab trap, slightly used", text: "Has never caught a crab. Mint condition.", price: 5, cur: "leaf" },
] as const;
const asked = new Set<number>();
function market(body: HTMLElement): void {
  LISTINGS.forEach((l, i) => {
    const seller = members.find((m) => m.name === l.who) as Member;
    const btn = h("button", { class: "btn quiet" }, asked.has(i) ? "Asked" : "Ask ", !asked.has(i) && iconEl(l.cur, 1.5), asked.has(i) ? "" : String(l.price));
    btn.disabled = asked.has(i);
    btn.addEventListener("click", () => {
      asked.add(i);
      sfx.wave();
      say(seller, pick(["I'll hold it for you!", "sold! well, held.", "ooh, a customer"]), 3);
      emote(seller, "hand", 1.4);
      hop(seller);
      toast(`${l.who} will hold it for you.`);
      drawPanel();
    });
    body.append(
      h(
        "div",
        { class: "row" },
        h("div", { class: "portrait" }, skinEl(seller.skin.face, 4)),
        h("div", null, h("h3", { text: l.item }), h("p", { html: `${l.text} <b style="color:#ffd98a">${l.who}</b>` })),
        btn,
      ),
    );
  });
  body.append(h("p", { class: "note", html: "Members list things and favours for each other. Nothing here is sold by the guild." }));
}

// ----- the Works -----

function worksPanel(body: HTMLElement): void {
  const [says, line] = speaker(iconEl("cog", 4), "Your Works kept itself busy. The belts never sleep.");
  const till = h("h3", { text: "" });
  const btn = h("button", { class: "btn" }, "Collect");
  const fill = h("i", null);
  const planks = h("p", { text: "" });
  const update = (): void => {
    till.textContent = `${Math.floor(works.ready)} Coins in the till`;
    btn.disabled = works.ready < 1;
    fill.style.width = `${(works.planks / 20) * 100}%`;
    planks.textContent = `${works.planks} of 20 planks shipped to the guild stores.`;
  };
  update();
  live.push(update);
  btn.addEventListener("click", () => {
    const n = Math.floor(works.ready);
    if (n < 1) return;
    works.ready -= n;
    sfx.coin();
    const from = toScreen(WORKS.x, WORKS.y - 14);
    flyToPurse("coins", from, Math.min(12, 3 + Math.floor(n / 8)));
    setTimeout(() => gainCoins(n), 600);
    tell(line, pick(["Into the purse it goes.", "Spend it on more belts. You know you will.", "Clink."]));
    update();
    markDock();
  });
  const door = h("a", { class: "btn quiet big", html: "Step inside &nearr;" });
  door.href = "../works/";
  door.target = "_blank";
  door.rel = "noopener";
  door.addEventListener("click", () => sfx.go());
  body.append(
    says,
    h("div", { class: "row" }, iconEl("coin", 3), h("div", null, till, h("p", { text: "Made while you were out and about." })), btn),
    h("div", { class: "row" }, iconEl("scroll", 3), h("div", null, h("h3", { text: "Guild order: planks" }), planks, h("div", { class: "bar" }, fill)), null),
    h("div", { style: "display:flex;justify-content:center;padding:4px 0" }, door),
    h("p", { class: "note", html: "The Works is your own small factory: miners, belts and orders from the guild. It opens in its own tab." }),
  );
}

// ----- the campfire -----

const REPLIES = ["hah!", "aww", "leaf leaf leaf", "crab.", "cheers", "hear hear", "*scoots over*"];
function fire(body: HTMLElement): void {
  const [says, line] = speaker(iconEl("flame", 4), "Pull up a log. Nobody's counting anything here.");
  const faces = h("div", { class: "faces" });
  const sitBtn = h("button", { class: "btn quiet" });
  const update = (): void => {
    const here = members.filter((m) => m.at === "fire" && !m.route);
    if (here.length === 0) faces.replaceChildren(h("p", { class: "note", text: "Nobody just now. The fire is keeping itself company." }));
    else faces.replaceChildren(...here.map((m) => h("div", null, skinEl(m.skin.face, 3), m.you ? (you.sit ? "You, sitting" : "You, standing") : m.name)));
    sitBtn.textContent = you.sit ? "Stand up" : "Sit down";
  };
  update();
  live.push(update);
  sitBtn.addEventListener("click", () => {
    you.sit = !you.sit;
    sfx.soft();
    poke.fire = 1;
    if (you.sit) {
      tell(line, "There. Warm side's the left side.");
      const mate = members.find((m) => !m.you && m.at === "fire" && !m.route);
      if (mate) setTimeout(() => say(mate, pick(["budge up, budge up", "evening!", "saved you the good log"]), 2.6), 500);
    } else tell(line, "Come back any time. It'll still be dusk.");
    update();
  });
  const emotes: IconId[] = ["hand", "heart", "laugh", "leaf", "crab", "note"];
  const row = h("div", { class: "emotes" });
  for (const e of emotes) {
    const b = h("button", { class: "plate", title: e }, iconEl(e, 2.5));
    b.addEventListener("click", () => {
      emote(you, e, 1.7);
      hop(you);
      sfx.emote();
      poke.fire = 0.8;
      const mates = members.filter((m) => !m.you && m.at === "fire" && !m.route);
      mates.forEach((m, i) => {
        setTimeout(
          () => {
            if (Math.random() < 0.6) emote(m, Math.random() < 0.6 ? e : "heart", 1.5);
            else say(m, pick(REPLIES), 1.8);
            hop(m);
          },
          350 + i * 260 + Math.random() * 200,
        );
      });
    });
    row.append(b);
  }
  body.append(says, h("p", { class: "note", html: "<b>By the fire now</b>" }), faces, h("div", null, sitBtn), h("p", { class: "note", html: "<b>Say it with a picture</b>" }), row);
}

// ----- the crab pond -----

function pond(body: HTMLElement): void {
  const [says, line] = speaker(iconEl("crab", 4), "Roll call! Everyone hold still. …Everyone?");
  const grid = h("div", { class: "roll" });
  const sum = h("p", { class: "note" });
  const again = h("button", { class: "btn quiet", text: "Call the roll again" });
  const call = (): void => {
    again.disabled = true;
    sum.textContent = "";
    grid.replaceChildren();
    crabsHop();
    const missing = stray.n;
    for (let n = 1; n <= 9; n++) {
      const gone = n === missing;
      const cell = h("div", { class: gone ? "gone" : "" }, `No. ${n}`, h("span", { text: gone ? "?" : "✓" }));
      grid.append(cell);
      setTimeout(
        () => {
          cell.classList.add("in");
          if (gone) sfx.no();
          else sfx.tick();
          if (n === 9) {
            tell(line, "Eight of nine. As usual.");
            sum.innerHTML = `Crab No. ${missing} is unaccounted for. Rumour has it, it was last seen <b>${(HIDES[stray.spot] as (typeof HIDES)[number]).where}</b>.${stray.found ? ` Strays you have brought home: <b>${stray.found}</b>.` : ""}`;
            again.disabled = false;
          }
        },
        250 + n * 130,
      );
    }
  };
  again.addEventListener("click", () => {
    tell(line, "Again! Hold still this time.");
    call();
  });
  body.append(says, grid, sum, h("div", null, again));
  call();
}

// ----- your camp: the profile -----

function camp(body: HTMLElement): void {
  const xp = h("i", { style: "width:62%" });
  const stats = h("div", { class: "stats" });
  const update = (): void => {
    stats.replaceChildren(
      h("div", null, h("b", null, iconEl("leaf", 1.5), String(state.leaf)), "Leaf"),
      h("div", null, h("b", null, iconEl("coin", 1.5), String(state.coins)), "Coins"),
      h("div", null, h("b", null, iconEl("lantern", 1.5), String(lanterns.length)), "Lanterns on the guild's rope"),
      h("div", null, h("b", null, iconEl("banner", 1.5), String(lands.held())), "Lands the guild holds"),
    );
  };
  update();
  live.push(update);
  const things = [owned.lantern && "a lantern", owned.sapling && "a redwood sapling"].filter(Boolean);
  body.append(
    h(
      "div",
      { class: "profile" },
      h("div", { class: "portrait" }, skinEl(you.skin.doll, 5)),
      h(
        "div",
        null,
        h("h3", { text: "You" }),
        h("p", { class: "note", html: "<b>Ranger</b> of the guild · level 47" }),
        h("div", { class: "bar" }, xp),
        h("p", { class: "note", text: "3,410 of 5,500 to level 48" }),
      ),
    ),
    stats,
    h("p", {
      class: "note",
      html: things.length ? `At your camp: ${things.join(" and ")}, from Cinfy.` : "Your camp is a tent, a fire and a flag with your face on it. Cinfy sells things for it at the Treasury.",
    }),
  );
}

// ----- a raid gate -----

function gate(body: HTMLElement, id: GateId): void {
  const g = GATES[id];
  const [says] = speaker(iconEl("lantern", 4), g.lore);
  const status = h("h3", { text: "" });
  const sub = h("p", { text: "" });
  const faces = h("div", { class: "faces" });
  const fill = h("i", null);
  const update = (): void => {
    const raid = raids.find((r) => r.gate === id);
    if (!raid) {
      status.textContent = "Quiet, for now";
      sub.textContent = "No party is out here. One will be along.";
      fill.style.width = "0%";
      faces.replaceChildren();
      return;
    }
    status.textContent = raid.phase === "wait" ? "A party of four is inside" : raid.phase === "out" ? "A party is on its way here" : "Cleared! The party is heading home";
    sub.textContent = raid.phase === "wait" ? "The ring fills as they go. When it closes, they come out with a lantern." : "";
    fill.style.width = `${Math.round(raid.ring * 100)}%`;
    if (faces.children.length !== raid.party.length) faces.replaceChildren(...raid.party.map((m) => h("div", null, skinEl(m.skin.face, 3), m.name)));
  };
  update();
  live.push(update);
  const rope = h("button", { class: "btn quiet", text: "See the lantern rope" });
  rope.addEventListener("click", () => {
    sfx.go();
    closePanel();
    flyTo(NODES.town.x, ROPE.ay + 14, 4);
    poke.rope = 1;
  });
  body.append(
    says,
    h("div", { class: "row" }, iconEl("star", 3), h("div", null, status, sub, h("div", { class: "bar" }, fill)), null),
    faces,
    h("p", { class: "note", html: "Raids are run in the big game. Parties leave from here, and every lantern they win is hung on the rope in town." }),
    h("div", null, rope),
  );
}

// ---------- a guild-mate's card ----------

const card = $("card");
let cardOf: Member | null = null;
let cardDoing: HTMLElement | null = null;
export function openCard(m: Member): void {
  cardOf = m;
  cardDoing = h("p", { text: doing(m) });
  const wave = h("button", { class: "btn", text: "Wave" });
  wave.addEventListener("click", () => {
    sfx.wave();
    emote(you, "hand", 1.4);
    hop(you);
    setTimeout(() => {
      emote(m, "hand", 1.6);
      hop(m);
      setTimeout(() => say(m, pick(["hello!", "oh, hi!", "hey, you", "*waves back, twice*", "good to see you"]), 2.6), 700);
    }, 350);
  });
  const home = h("button", { class: "btn", text: "Go to your camp" });
  home.addEventListener("click", () => {
    closeCard();
    act.goTo("camp");
  });
  card.replaceChildren(
    h(
      "div",
      { class: "top" },
      h("div", { class: "portrait" }, skinEl(m.skin.face, 5)),
      h("div", null, h("b", { text: m.name }), h("small", { text: `${m.rank} · level ${m.level}` })),
    ),
    cardDoing,
    h("div", { class: "acts" }, m.you ? home : wave, h("button", { class: "btn quiet", text: "Close", on: closeCard })),
  );
  card.classList.remove("open");
  void card.offsetWidth;
  card.classList.add("open");
  placeCard();
}
export function closeCard(): void {
  cardOf = null;
  card.classList.remove("open");
}
export const cardOpen = (): Member | null => cardOf;
function placeCard(): void {
  if (!cardOf) return;
  const w = card.offsetWidth;
  const hgt = card.offsetHeight;
  const x = Math.max(8, Math.min(innerWidth - w - 8, cardOf.sx - w / 2));
  let y = cardOf.sy - cardOf.sr - hgt - 22;
  if (y < 56) y = cardOf.sy + cardOf.sr + 16;
  card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

// ---------- while you were away ----------

export function awayNote(text: string): void {
  const el = $("awaynote");
  el.textContent = text;
  el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 250, easing: "ease-out" });
}
export function showAwayCard(rows: { icon: IconId; title: string; sub: string; gain: string }[], onHome: (from: { x: number; y: number }) => void): void {
  const box = $("awaycard");
  const btn = h("button", { class: "btn big", text: "Good to be home" });
  btn.addEventListener("click", () => {
    unlock();
    onHome(centre(box));
  });
  box.replaceChildren(
    h("h2", { text: "Welcome home" }),
    h("p", { class: "sub", text: "While you were away, since this morning" }),
    h(
      "ul",
      null,
      ...rows.map((r, i) => h("li", { style: `--i:${i}` }, iconEl(r.icon, 2), h("div", null, r.title, h("small", { text: r.sub })), h("b", { text: r.gain }))),
    ),
    h("div", { class: "go" }, btn),
  );
  $("awaycap").style.opacity = "0";
  box.classList.add("open");
}
export function endAway(): void {
  $("awaycard").classList.remove("open");
  document.body.classList.remove("away");
  layout();
}

// ---------- set-up, and what runs each frame ----------

const muteBtn = $("mute");
function drawMute(): void {
  muteBtn.replaceChildren(iconEl(isMuted() ? "mute" : "sound", 2));
  muteBtn.title = isMuted() ? "Sound is off" : "Sound is on";
}

export function initUI(l: Lands): void {
  lands = l;
  const me = $("me");
  me.replaceChildren(h("div", { class: "portrait", style: "padding:2px" }, skinEl(you.skin.face, 3.5)), h("div", { class: "who" }, h("b", { text: "You" }), h("small", { text: "Ranger · level 47" })));
  me.addEventListener("click", () => {
    unlock();
    act.goTo("camp");
  });
  drawMute();
  muteBtn.addEventListener("click", () => {
    unlock();
    setMuted(!isMuted());
    drawMute();
    if (!isMuted()) sfx.tap();
  });
  $("zin").addEventListener("click", () => {
    unlock();
    sfx.tap();
    act.zoom(1.5);
  });
  $("zout").addEventListener("click", () => {
    unlock();
    sfx.tap();
    act.zoom(1 / 1.5);
  });
  dockPhone = null;
  buildDock();
  layout();
}
/** The member's own skin has loaded: every face of theirs on the page is redrawn. */
export function skinChanged(): void {
  dockPhone = null;
  buildDock();
  const me = $("me");
  me.firstElementChild?.replaceChildren(skinEl(you.skin.face, 3.5));
  if (openId === "camp") drawPanel();
}
export function resized(): void {
  buildDock();
  layout();
}

let second = 0;
export function tickUI(dt: number): void {
  for (const [key, el] of [
    ["leaf", leafNum],
    ["coins", coinNum],
  ] as const) {
    const want = state[key];
    if (shown[key] === want) continue;
    const step = Math.max(1, Math.ceil(Math.abs(want - shown[key]) * Math.min(1, dt * 6)));
    shown[key] += Math.sign(want - shown[key]) * Math.min(step, Math.abs(want - shown[key]));
    el.textContent = String(shown[key]);
  }
  placeCard();
  second += dt;
  if (second >= 1) {
    second = 0;
    ageFeed();
    markDock();
    for (const job of live) job();
    if (cardOf && cardDoing) cardDoing.textContent = doing(cardOf);
  }
}
