import { nameOf, portrait, starsPic } from "@sequoia-leaf/figures/sprites.ts";
/**
 * The pages that sit over the table: the front page before a run, the almanac of everything met so
 * far, how to play, the looks for the table that Leaf buys, and the paper at a run's end. One is up
 * at a time.
 */
import { link } from "@sequoia-leaf/kit/card.ts";
import { type Choice, choices } from "@sequoia-leaf/kit/choices.ts";
import { add, amount, el, icon, replay } from "@sequoia-leaf/kit/dom.ts";
import { balance, LEAF_MEMBERS, leafFor, leafOpen } from "@sequoia-leaf/kit/purse.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";
import { tipAt } from "@sequoia-leaf/kit/tip.ts";
import {
  baseOf,
  BOSS_IDS,
  clothOf,
  COMPONENT_IDS,
  ECONOMY,
  FIGHT,
  FIGURE_IDS,
  type FigureId,
  FINISHED,
  FINISHED_IDS,
  isMemberId,
  itemName,
  lanternOf,
  LOOK_KINDS,
  LOOK_TITLES,
  type LookId,
  type LookKind,
  LOOKS,
  owns,
  pieces,
  type RaidCommand,
  ROOM_COUNT,
  ROOMS,
  type RunView,
  specOf,
  TRAIL_COUNT,
  trailOpen,
  TRAILS,
  TRAIT_IDS,
  TRAITS,
  unfought,
  wornOf,
} from "@sequoia-leaf/raid";

import { glyph, itemIcon, roomIcon, traitIcon } from "../art/icons.ts";
import { paintSwatch } from "../art/table.ts";
import { endedOf } from "../screen.ts";
import { snd } from "../sounds.ts";
import { dress } from "../stage.ts";
import { ask, S } from "../state.ts";
import { figPic, pic } from "./cards.ts";
import { figuresHere, nothingNew, pulledLine, pulledTag, runTag, setsOutOwn, wayPrefix, waysOf } from "./own.ts";

export type PageId = "front" | "almanac" | "howto" | "looks" | "summary";

/** What the pages ask for. */
export interface PageAsks {
  carryOn: () => void;
  /** Set out on a trail, with all figures or (`own`) the member's own. */
  start: (trail: number, own: boolean) => void;
  goHome: () => void;
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
let sureHome = false;
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
  sureHome = false;
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

/** The figures a run has on its board, with their stars. */
function partyRow(run: RunView): HTMLElement {
  const row = el("div", "party", {});
  const board = run.board.flatMap((p) => (p ? [p] : []));
  for (const p of board.length > 0 ? board : pieces(run)) {
    const who = el("div", "who", {}, pic(starsPic(p.stars)), figPic(portrait(p.kind)), runTag(run, p.kind));
    link(who, `figure:${p.kind}/${p.stars}`);
    row.append(who);
  }
  return row;
}

// ---------- the front page ----------

/** Picks the trail to set out on next: Leaf keeps it. */
async function pickTrail(trail: number, card: Element | null): Promise<void> {
  await ask({ do: "trail", trail }, card);
  renderPages(true);
}

function front(): HTMLElement {
  const run = S.run;
  const body = el("div", "k-body k-scroll", {});
  if (run && run.stage.phase !== "over") {
    const going = el(
      "div",
      "k-card going",
      {},
      el(
        "div",
        "k-col k-grow tight",
        {},
        el("b", "k-gold", { text: "A raid is laid out" }),
        el("span", "k-dim", {
          text: `${wayPrefix(run)}Room ${run.room + 1} of ${ROOM_COUNT}, ${TRAILS[run.trail]?.name ?? ""}. Health ${run.resolve}.`,
        }),
        partyRow(run),
      ),
    );
    add(
      body,
      going,
      el(
        "button",
        "k-btn wide",
        { type: "button", id: "carryon", onclick: () => asks?.carryOn() },
        pic(glyph("play")),
        "Carry on",
      ),
    );
    // A raid that has fought no room yet is not put down: it is the one set out on, until its first room.
    const kept = unfought(run);
    add(
      body,
      kept
        ? el("span", "k-read k-dim", { text: "You can go home once the first room is fought." })
        : sureHome
          ? el(
              "div",
              "k-row",
              {},
              el("span", "k-d k-grow", { text: "Go home now? You are paid for the rooms you won." }),
              el("button", "k-btn coral sm", { type: "button", onclick: () => asks?.goHome() }, "Go home"),
              el(
                "button",
                "k-btn wood sm",
                {
                  type: "button",
                  onclick: () => {
                    sureHome = false;
                    renderPages(true);
                  },
                },
                "Stay",
              ),
            )
          : el(
              "button",
              "k-btn wood sm",
              {
                type: "button",
                id: "gohome",
                onclick: () => {
                  sureHome = true;
                  renderPages(true);
                },
              },
              "Go home early",
            ),
    );
    add(body, el("hr", "k-rule"));
  }
  // The raid laid out, while it has fought no room, stays the one set out on.
  const keep = run !== null && run.stage.phase !== "over" && unfought(run);
  add(body, ...waysOf(keep, () => renderPages(true)));
  const trails = el("div", "trails", { role: "radiogroup" });
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const t = TRAILS[i];
    if (!t) continue;
    const open = trailOpen(S.almanac, i);
    const best = S.almanac.best[i] ?? 0;
    const card = el(
      "button",
      `k-card trail${open ? "" : " done"}`,
      {
        type: "button",
        role: "radio",
        "aria-selected": String(S.trail === i && open),
        "aria-checked": String(S.trail === i && open),
        onclick: (e: Event) => {
          if (!open) {
            snd.no();
            return;
          }
          snd.tap();
          // The trail picked is Leaf's to keep: it is the one set out on next, on any page.
          void pickTrail(i, e.currentTarget instanceof Element ? e.currentTarget : null);
        },
      },
      open ? pic(roomIcon(i === 0 ? "trouble" : i === 1 ? "spar" : "boss"), 2) : icon("lock", 2),
      el(
        "div",
        "k-col k-grow tight",
        {},
        el("b", "", { text: t.name }),
        el("span", "k-d", { text: open ? t.text : `Clear ${TRAILS[i - 1]?.name ?? "the one before"} first.` }),
        best > 0
          ? el("span", "k-dim", { text: `Furthest: room ${best}. Pays ${t.pays}%.` })
          : open && t.pays > 100
            ? el("span", "k-dim", { text: `Pays ${t.pays}%.` })
            : null,
      ),
    );
    trails.append(card);
  }
  add(body, trails);
  if (!keep)
    add(
      body,
      el(
        "button",
        `k-btn wide${run ? " wood" : ""}`,
        { type: "button", id: "start", onclick: () => asks?.start(S.trail, setsOutOwn()) },
        pic(glyph("swords")),
        run ? "New raid" : "Set out",
      ),
    );
  if (run && !keep) add(body, el("span", "k-read k-dim", { text: "A new raid ends the one you are on." }));
  add(
    body,
    el("hr", "k-rule"),
    el(
      "div",
      "k-row three",
      {},
      el(
        "button",
        "k-btn wood sm",
        { type: "button", id: "toalmanac", onclick: () => showPage("almanac") },
        pic(glyph("book")),
        "Almanac",
      ),
      el(
        "button",
        "k-btn wood sm",
        { type: "button", id: "tohowto", onclick: () => showPage("howto") },
        pic(glyph("help")),
        "How to play",
      ),
      el(
        "button",
        "k-btn wood sm",
        { type: "button", id: "tolooks", onclick: () => showPage("looks") },
        pic(glyph("brush")),
        "Table looks",
      ),
    ),
    el(
      "button",
      "k-btn wood wide",
      { type: "button", id: "leave", onclick: () => asks?.leave() },
      icon("back"),
      "Leave the table",
    ),
  );
  return panel("The Little Raid", pic(glyph("swords")), body, false, "front");
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
  dress(S.looks.cloth, S.looks.lantern);
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
    shown ? {} : { "aria-hidden": "true", inert: "" },
    el("div", "k-col k-grow tight", {}, el("b", "k-gold", { text: spec.name }), el("span", "k-d", { text: spec.text })),
    act,
  );
}

function looks(): HTMLElement {
  const tried: { kind: LookKind; id: LookId } = trying ?? { kind: "cloth", id: wearing("cloth") };
  const dressed = {
    cloth: (tried.kind === "cloth" ? clothOf(tried.id) : null) ?? S.looks.cloth,
    lantern: (tried.kind === "lantern" ? lanternOf(tried.id) : null) ?? S.looks.lantern,
    bases: (tried.kind === "bases" ? baseOf(tried.id) : null) ?? S.looks.bases,
  };
  const body = el("div", "k-body k-scroll", {});
  add(body, el("div", "k-row", {}, el("span", "k-grow"), amount("leaf", balance().leaf)));
  add(body, el("div", "swatch", {}, figPic(paintSwatch(dressed.cloth, dressed.lantern, dressed.bases))));
  // Every look's line, one over another and only the one tried shown: the box is as tall as the
  // tallest whichever is tried, so nothing under it moves.
  add(
    body,
    el(
      "div",
      "lookinfo",
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

// ---------- the end of a run ----------

function summary(): HTMLElement | null {
  const ended = endedOf(S.screen);
  if (!ended) return null;
  const { run, summary: sum, paid, news } = ended;
  const title = sum.ending === "won" ? "The raid is done." : sum.ending === "left" ? "Home early." : "Out of health.";
  const paper = el("section", "k-paper page k-rise summary", { role: "dialog", "aria-label": title });
  add(
    paper,
    el("h1", "k-title big", { text: title }),
    el("div", "", {
      text:
        sum.ending === "won"
          ? `${ROOM_COUNT} rooms, and the crab nobody counted has been counted.`
          : `${TRAILS[sum.trail]?.name ?? ""}: ${sum.cleared} room${sum.cleared === 1 ? "" : "s"} won, as far as room ${sum.reached}.`,
    }),
  );
  const pips = el("div", "pips", {});
  ROOMS.forEach((room, i) => {
    const record = run.record.findLast((r) => r.room === i);
    pips.append(
      el(
        "span",
        `k-slot pip ${record ? (record.result === "win" ? "won" : record.result === "loss" ? "lost" : "drawn") : ""}`,
        {},
        pic(roomIcon(room.kind)),
      ),
    );
  });
  const left = el("div", "k-col", {});
  const right = el("div", "k-col", {});
  add(paper, pips, el("div", "cols", {}, left, right));
  add(left, el("div", "k-label", { text: "The party that got there" }), partyRow(run));

  const fresh = news.filter((n) => n.t !== "best");
  if (fresh.length > 0) {
    const list = el("div", "news", {});
    for (const n of fresh) {
      if (n.t === "fielded") list.append(el("span", "new", {}, pic(portrait(n.figure)), `Met ${nameOf(n.figure)}`));
      else if (n.t === "threeStars")
        list.append(el("span", "new", {}, pic(starsPic(3)), `${nameOf(n.figure)} to three stars`));
      else if (n.t === "forged") list.append(el("span", "new", {}, pic(itemIcon(n.item)), `Made ${itemName(n.item)}`));
      else if (n.t === "topped")
        list.append(el("span", "new", {}, pic(traitIcon(n.trait)), `${TRAITS[n.trait].name} all the way on`));
      else if (n.t === "boss")
        list.append(el("span", "new", {}, pic(portrait(n.boss)), `Saw off ${specOf(n.boss).name}`));
      else list.append(el("span", "new", {}, pic(glyph("door")), `${TRAILS[n.trail]?.name ?? ""} is open`));
    }
    add(right, el("div", "k-label", { text: "New in the almanac" }), list);
  }
  add(left, el("hr", ""));
  const WHY = {
    rooms: "Rooms won",
    bosses: "Bosses seen off",
    win: "The whole raid",
    trail: "The harder way",
  } as const;
  for (const l of paid.lines)
    add(
      left,
      l.why === "full"
        ? el("div", "k-d", { text: "Your purse can take no more for now. It has room again within the hour." })
        : el("div", "k-row pay", {}, el("span", "k-grow", { text: WHY[l.why] }), amount("coin", `+${l.coins}`)),
    );
  if (right.childElementCount === 0) add(right, ...nothingNew(run));
  add(
    left,
    el(
      "div",
      "k-row pay total",
      {},
      el("b", "k-grow", { text: paid.coins > 0 ? "Paid into your purse" : "Nothing to pay this time" }),
      amount("coin", paid.coins),
    ),
    el(
      "div",
      "k-wrap ends",
      {},
      el("button", "k-btn", { type: "button", id: "again", onclick: () => asks?.start(sum.trail, !!run.own) }, "Again"),
      el(
        "button",
        "k-btn wood",
        { type: "button", id: "totown", onclick: () => asks?.leave() },
        icon("back"),
        "Back to town",
      ),
    ),
  );
  return paper;
}

/** Shows whichever page is due, or none. */
export function renderPages(force = false): void {
  const box = document.getElementById("modal");
  if (!box) return;
  const id = pageUp();
  const key = `${id}:${S.runs}:${S.run?.room ?? 0}:${endedOf(S.screen) ? 1 : 0}`;
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
      ? front()
      : id === "almanac"
        ? almanac()
        : id === "howto"
          ? howto()
          : id === "looks"
            ? looks()
            : summary();
  if (!node) {
    box.hidden = true;
    return;
  }
  if (force) node.classList.remove("k-rise");
  // Drawn again (a tab, a look tried on), the page keeps the keyboard where it was.
  const before = controlKeys(box);
  const was = before.find(([b]) => b === document.activeElement)?.[1];
  box.hidden = false;
  box.dataset.page = id;
  box.replaceChildren(node);
  if (was !== undefined)
    controlKeys(box)
      .find(([, k]) => k === was)?.[0]
      .focus({ preventScroll: true });
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
