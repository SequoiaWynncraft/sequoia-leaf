/**
 * The pages that sit over the table: the front page before a run, the almanac of everything met so
 * far, how to play, the looks for the table that Leaf buys, and the paper at a run's end. One is up
 * at a time. The front page is its own (`front.ts`), and so is the paper (`ended.ts`).
 */
import { nameOf, portrait, starsPic } from "@sequoia-leaf/figures/sprites.ts";
import { link } from "@sequoia-leaf/kit/card.ts";
import { type Choice, choices } from "@sequoia-leaf/kit/choices.ts";
import { add, amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { balance, LEAF_MEMBERS, leafFor, leafOpen } from "@sequoia-leaf/kit/purse.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { tipAt } from "@sequoia-leaf/kit/tip.ts";
import {
  BOSS_IDS,
  COMPONENT_IDS,
  ECONOMY,
  type EndlessWay,
  FIGHT,
  FIGURE_IDS,
  type FigureId,
  FINISHED,
  FINISHED_IDS,
  isMemberId,
  itemName,
  LOOK_KINDS,
  LOOK_TITLES,
  type LookId,
  type LookKind,
  LOOKS,
  owns,
  type RaidCommand,
  ROOM_COUNT,
  specOf,
  TRAIL_COUNT,
  trailOpen,
  TRAILS,
  TRAIT_IDS,
  TRAITS,
  tryOn,
  wornOf,
} from "@sequoia-leaf/raid";

import { glyph, itemIcon, traitIcon } from "../art/icons.ts";
import { paintLook } from "../art/place.ts";
import { endedOf } from "../screen.ts";
import { snd } from "../sounds.ts";
import { ask, laidKey, S, type Slot } from "../state.ts";
import { figPic, pic } from "./cards.ts";
import { summary } from "./ended.ts";
import { frontAway, frontBody } from "./front.ts";
import { figuresHere, pulledLine, pulledTag, unshown } from "./own.ts";
import { frontShown } from "./woods.ts";

export type PageId = "front" | "almanac" | "howto" | "looks" | "summary";

/** What the pages ask for. */
export interface PageAsks {
  /** Sit down to the run in a slot: the run in hand, or the endless run. */
  carryOn: (slot: Slot) => void;
  /** Sit down to the run in a slot and watch its last fight again. */
  watch: (slot: Slot) => void;
  /** Set out on a trail, with all figures or (`own`) the member's own. */
  start: (trail: number, own: boolean) => void;
  /** Set out on an endless run, one way or the other. */
  endless: (way: EndlessWay) => void;
  /** End the run in a slot early. */
  goHome: (slot: Slot) => void;
  leave: () => void;
  /** A gear for the settings menu, on the pages that cover the table and have no close of their own. */
  gear: () => HTMLElement;
}

let asks: PageAsks | null = null;
/** A page opened on top of whichever the table would show by itself. */
let extra: PageId | null = null;
let shownKey = "";
let tab: AlmanacTab = "figures";
/** The look being tried on in the looks page, before it is bought or worn. */
let trying: { kind: LookKind; id: LookId } | null = null;
/** What had the keyboard when a page was opened over the table: it has it back when the page goes. */
let opener: HTMLElement | null = null;

export function openPages(a: PageAsks): void {
  asks = a;
}
/** Whether a page is open over the one the table shows by itself: Escape puts it away (`settings.ts`). */
export const pageOver = (): boolean => extra !== null;
/** Opens a page over the table, with the keyboard in it; or puts it away, giving the keyboard back. */
export function showPage(id: PageId | null): void {
  if (id && !extra) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  extra = id;
  frontAway();
  if (id) snd.open();
  else snd.close();
  renderPages(true);
  if (id) {
    document.querySelector<HTMLElement>("#modal:not([hidden]) button")?.focus({ preventScroll: true });
    return;
  }
  // The front page is drawn again as a page over it goes: its button of the same id has the keyboard then.
  const back = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
  back?.focus({ preventScroll: true });
  opener = null;
}
export const pageUp = (): PageId | null =>
  extra ?? (S.screen.at === "front" ? "front" : S.screen.at === "over" ? "summary" : null);

const close = (): HTMLElement =>
  el(
    "button",
    "k-btn wood icon sm",
    { type: "button", "aria-label": "Close", onclick: () => showPage(null) },
    icon("close"),
  );

function panel(title: string, sign: HTMLElement | null, body: HTMLElement, withClose: boolean, cls = ""): HTMLElement {
  return el(
    "section",
    `k-panel page k-rise ${cls}`.trim(),
    { role: "dialog", "aria-label": title },
    el("header", "k-head", {}, sign, el("h1", "k-title", { text: title }), withClose ? close() : asks?.gear()),
    body,
  );
}

// ---------- the almanac ----------

/** A figure in the almanac: shown once it has been fielded or pulled, dark until then; a badge for three stars. */
function figureTile(id: FigureId): HTMLElement {
  const met = isMemberId(id) || S.almanac.fielded.includes(id) || S.roster[id] !== undefined;
  const starred = S.almanac.threeStars.includes(id);
  const tile = el(
    "button",
    `k-card tile${met ? "" : " unmet"}`,
    { type: "button", "aria-label": met ? null : "Not met" },
    pic(portrait(id, { dark: !met }), 2),
    met ? el("span", "k-s", { text: nameOf(id) }) : null,
    starred ? pic(starsPic(3), 1, "badge") : null,
    pulledTag(id),
  );
  if (met) link(tile, `figure:${id}/${starred ? 3 : 1}/lore`);
  return tile;
}

type AlmanacTab = "figures" | "traits" | "items" | "raids";
const ALMANAC: readonly Choice<AlmanacTab>[] = [
  { id: "figures", name: "Figures" },
  { id: "traits", name: "Traits" },
  { id: "items", name: "Items" },
  { id: "raids", name: "Raids" },
];

function almanac(): HTMLElement {
  const a = S.almanac;
  const page = el("div", "leaf k-scroll", {});
  // Drawn again on a choice: the page keeps the keyboard on the tab chosen, by its id (`renderPages`).
  const tabs = choices(ALMANAC, {
    kind: "tabs",
    name: "Almanac",
    chosen: tab,
    look: "sm",
    page,
    choose: (id) => {
      tab = id;
      snd.tap();
      renderPages(true);
    },
  });
  if (tab === "figures") {
    add(
      page,
      el("div", "k-dim", {
        text: `${a.fielded.length} of ${FIGURE_IDS.length} fielded. ${a.threeStars.length} taken to three stars.${pulledLine()}`,
      }),
    );
    add(page, el("div", "tiles", {}, ...figuresHere().map(figureTile)));
  } else if (tab === "traits") {
    add(page, el("div", "k-dim", { text: `${a.topped.length} switched all the way on.` }));
    const list = el("div", "k-col", {});
    for (const id of TRAIT_IDS) {
      const row = el(
        "button",
        `k-card${a.topped.includes(id) ? " lit" : ""}`,
        { type: "button" },
        pic(traitIcon(id), 2),
        el(
          "div",
          "k-col k-grow tight",
          {},
          el("b", "", { text: TRAITS[id].name }),
          el("span", "k-d", { text: TRAITS[id].gist }),
        ),
        a.topped.includes(id) ? icon("check") : null,
      );
      link(row, `trait:${id}/lore`);
      list.append(row);
    }
    add(page, list);
  } else if (tab === "items") {
    add(page, el("div", "k-dim", { text: `${a.forged.length} of ${FINISHED_IDS.length} made.` }));
    const comps = el("div", "tiles small", {});
    for (const id of COMPONENT_IDS) {
      const tile = el(
        "button",
        "k-card tile",
        { type: "button" },
        pic(itemIcon(id), 2),
        el("span", "k-s", { text: itemName(id) }),
      );
      link(tile, `item:${id}/lore`);
      comps.append(tile);
    }
    const made = el("div", "tiles small", {});
    for (const id of FINISHED_IDS) {
      const have = a.forged.includes(id);
      const [x, y] = FINISHED[id].made;
      const tile = el(
        "button",
        `k-card tile${have ? "" : " unmet"}`,
        { type: "button", "aria-label": have ? null : "Not made" },
        have ? pic(itemIcon(id), 2) : el("span", "pair", {}, pic(itemIcon(x)), pic(itemIcon(y))),
        have ? el("span", "k-s", { text: itemName(id) }) : null,
      );
      link(tile, `item:${id}/lore`);
      made.append(tile);
    }
    add(page, comps, el("hr", "k-rule"), made);
  } else {
    add(page, el("div", "k-dim", { text: `${a.runs} raid${a.runs === 1 ? "" : "s"} walked.` }));
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const best = a.best[i] ?? 0;
      const beaten = a.bosses[i] ?? [];
      add(
        page,
        el(
          "div",
          "k-card",
          {},
          el(
            "div",
            "k-col k-grow tight",
            {},
            el("b", "", { text: TRAILS[i]?.name ?? "" }),
            el("span", "k-dim", {
              text:
                best > 0
                  ? `Furthest: room ${best} of ${ROOM_COUNT}.`
                  : trailOpen(a, i)
                    ? "Not walked yet."
                    : "Not open yet.",
            }),
            el(
              "div",
              "party",
              {},
              ...BOSS_IDS.map((boss) =>
                el(
                  "div",
                  "who",
                  { title: beaten.includes(boss) ? specOf(boss).name : "" },
                  pic(portrait(boss, { dark: !beaten.includes(boss) })),
                ),
              ),
            ),
          ),
        ),
      );
    }
  }
  return panel("The almanac", pic(glyph("book")), el("div", "k-body", {}, tabs.el, page), true, "wide");
}

// ---------- how to play ----------

const HOW: readonly (readonly [() => HTMLCanvasElement, string])[] = [
  [
    () => glyph("acorn"),
    "Buy figures at the stall with acorns. Drag them onto the board, or tap one and then tap a hex.",
  ],
  [() => glyph("figure"), "Your level is how many you may field. The rest wait on the bench."],
  [() => glyph("up"), "3 of the same figure become 1 with 2 stars. 3 of those become 1 with 3 stars."],
  [
    () => glyph("book"),
    "Figures that share a kin or a calling switch a trait on. The chips say how far along each is.",
  ],
  [
    () => glyph("swords"),
    `Set out, and they fight by themselves. You win the room if any of yours is left standing. After ${FIGHT.dusk} s dusk hurts everyone: ${FIGHT.duskGrows}% of their health, ${FIGHT.duskGrows}% more each second. At ${FIGHT.cap} s it is a draw.`,
  ],
  [
    () => traitIcon("bulwark"),
    "Each attacks the nearest enemy. Tanks count as 1 hex nearer, assassins as 1 hex further.",
  ],
  [
    () => glyph("door"),
    `A lost room costs health. There are ${ROOM_COUNT} rooms, with a boss at the end of each wing.`,
  ],
  [
    () => glyph("pin"),
    `Every ${ECONOMY.interestPer} acorns you keep earn 1 more each room. Hold keeps the stall as it is.`,
  ],
  [() => glyph("brush"), "Two components make an item, on a figure or the rack. Drag one onto the other, or tap both."],
  [() => glyph("help"), "Point at anything for its card; click or tap to keep it open. Names in a card open theirs."],
];

function howto(): HTMLElement {
  const paper = el("section", "k-paper page k-rise how", { role: "dialog", "aria-label": "How to play" });
  add(paper, el("div", "k-row", {}, el("h1", "k-title big k-grow", { text: "How to play" }), close()));
  for (const [sign, text] of HOW)
    add(paper, el("div", "k-row line", {}, pic(sign(), 2), el("span", "k-grow k-read", { text })));
  add(paper, el("hr", ""), el("i", "k-read", { text: "Nothing here is timed. Take as long as you like over a room." }));
  return paper;
}

// ---------- looks for the table ----------

const wearing = (kind: LookKind): LookId => wornOf(S.looks, kind);
/**
 * Puts a look on the table (`look`), or buys it with Leaf and puts it there (`buyLook`): Leaf keeps
 * which are worn and owned; its answer brings the purse Leaf's word on the member's Leaf. A refusal
 * is said at the button, since the page covers the table's own line.
 */
async function wear(c: Extract<RaidCommand, { do: "look" | "buyLook" }>, button: EventTarget | null): Promise<void> {
  const at = button instanceof HTMLElement ? button : null;
  const did = await ask(c, at);
  if (did && !did.ok && at) {
    replay(at, "shake");
    const r = at.getBoundingClientRect();
    tipAt({ x: r.left, y: r.top, w: r.width, h: r.height }, did.why, "", at);
  }
  if (!did?.ok) return;
  renderPages(true);
  if (c.do === "buyLook") snd.buy();
}

/** A look's name, words and button (use it, buy it, or on the table); `shown` for the one tried, the rest hidden but holding their room. */
function lookLine(kind: LookKind, spec: (typeof LOOKS)[LookKind][number], shown: boolean): HTMLElement {
  const { id: look } = spec;
  const mine = owns(S.looks, kind, look);
  const on = wearing(kind) === look;
  const act = on
    ? el("span", "k-chip lit", {}, icon("check"), "On the table")
    : el(
        "button",
        mine ? "k-btn sm" : "k-btn leaf sm",
        {
          type: "button",
          id: shown ? (mine ? "uselook" : "buylook") : null,
          onclick: (e: Event) => void wear({ do: mine ? "look" : "buyLook", kind, look }, e.currentTarget),
        },
        ...(mine ? ["Use it"] : ["Buy", amount("leaf", spec.leaf)]),
      );
  // With spending off, or for a guest a look for members, the look is shown and its Buy button closed.
  if (!on && !mine && !leafOpen()) closeLeaf(act, `${spec.leaf} Leaf`);
  else if (!on && !mine && !leafFor(spec.for)) closeLeaf(act, `${spec.leaf} Leaf`, LEAF_MEMBERS);
  return el(
    "div",
    "k-card",
    unshown(shown),
    el("div", "k-col k-grow tight", {}, el("b", "k-gold", { text: spec.name }), el("span", "k-d", { text: spec.text })),
    act,
  );
}

function looks(): HTMLElement {
  const tried: { kind: LookKind; id: LookId } = trying ?? { kind: "place", id: wearing("place") };
  const body = el("div", "k-body k-scroll", {});
  add(body, el("div", "k-row", {}, el("span", "k-grow"), amount("leaf", balance().leaf)));
  add(body, el("div", "swatch", {}, figPic(paintLook(tryOn(S.looks, tried.kind, tried.id)))));
  // Every look's line, one over another and only the one tried shown: the box is as tall as the
  // tallest whichever is tried, so nothing under it moves.
  add(
    body,
    el(
      "div",
      "stack",
      {},
      ...LOOK_KINDS.flatMap((kind) =>
        LOOKS[kind].map((l) => lookLine(kind, l, kind === tried.kind && l.id === tried.id)),
      ),
    ),
  );
  for (const kind of LOOK_KINDS) {
    add(body, el("div", "k-label", { text: LOOK_TITLES[kind] }));
    const row = el("div", "k-wrap", {});
    for (const l of LOOKS[kind]) {
      const mine = owns(S.looks, kind, l.id);
      row.append(
        el(
          "button",
          `k-card look${wearing(kind) === l.id ? " lit" : ""}`,
          {
            type: "button",
            "aria-pressed": String(tried.kind === kind && tried.id === l.id),
            onclick: () => {
              trying = { kind, id: l.id };
              snd.tap();
              renderPages(true);
            },
          },
          el("span", "", { text: l.name }),
          mine ? (wearing(kind) === l.id ? icon("check") : null) : amount("leaf", l.leaf),
        ),
      );
    }
    add(body, row);
  }
  return panel("Table looks", pic(glyph("brush")), body, true);
}

/** The front page in its panel, once the page has been told what it asks for. */
const frontPage = (): HTMLElement | null =>
  asks &&
  panel(
    "The Little Raid",
    pic(glyph("swords")),
    frontBody({ ...asks, open: showPage, redraw: () => renderPages(true) }),
    false,
    "front",
  );

/** Shows whichever page is due, or none. */
export function renderPages(force = false): void {
  const box = document.getElementById("modal");
  if (!box) return;
  const id = pageUp();
  // While the front page is up, what it shows of the endless ways is read again every minute.
  frontShown(id === "front");
  const key = `${id}:${S.runs}:${S.run?.room ?? 0}:${endedOf(S.screen) ? 1 : 0}:${laidKey()}`;
  if (!force && key === shownKey) return;
  shownKey = key;
  // While a page is opened over the table, the table behind it cannot be reached.
  for (const part of ["hud", "bottom", "rack", "picks"]) {
    const node = document.getElementById(part);
    if (node) node.inert = extra !== null;
  }
  if (!id) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  const node =
    id === "front"
      ? frontPage()
      : id === "almanac"
        ? almanac()
        : id === "howto"
          ? howto()
          : id === "looks"
            ? looks()
            : summary(asks);
  if (!node) {
    box.hidden = true;
    return;
  }
  if (force) node.classList.remove("k-rise");
  // Drawn again (a tab, a look tried on), the page keeps the keyboard where it was.
  const before = controlKeys(box);
  const was = before.find(([b]) => b === document.activeElement)?.[1];
  place(box, id, node);
  if (was !== undefined)
    controlKeys(box)
      .find(([, k]) => k === was)?.[0]
      .focus({ preventScroll: true });
}

/**
 * Puts a page in the box. Drawn again, the same page keeps its body scrolled where it was, so that
 * a choice made, or the front page's minute's reading, does not carry the member back to its top.
 */
function place(box: HTMLElement, id: PageId, node: HTMLElement): void {
  const top = box.dataset.page === id ? (box.querySelector(".k-body")?.scrollTop ?? 0) : 0;
  box.hidden = false;
  box.dataset.page = id;
  box.replaceChildren(node);
  const body = node.querySelector(".k-body");
  if (body) body.scrollTop = top;
}

/**
 * Which control each button in a page is, the same when the page is drawn again with a button more or
 * fewer: its id, else its name, else its words, and which of the buttons so called it is.
 */
function controlKeys(box: HTMLElement): [HTMLButtonElement, string][] {
  const seen = new Map<string, number>();
  return [...box.querySelectorAll("button")].map((b) => {
    const name = b.id || b.getAttribute("aria-label") || (b.textContent ?? "");
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return [b, `${name}#${n}`];
  });
}

/** A touch outside a page that can be closed closes it. */
export function pagesClick(e: MouseEvent): void {
  if (extra && e.target instanceof HTMLElement && e.target.id === "modal") showPage(null);
}
