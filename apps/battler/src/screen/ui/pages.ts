/**
 * The pages that sit over the table: the front page before a run, the almanac of everything met so
 * far, how to play, the looks for the table that Leaf buys, and the paper at a run's end. One is up
 * at a time.
 */
import { add, amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import { balance, has, spend } from "@sequoia-leaf/kit/purse.ts";
import { closeLeaf } from "@sequoia-leaf/kit/pursebar.ts";

import {
  BOSS_IDS,
  COMPONENT_IDS,
  FIGURE_IDS,
  type FigureId,
  FIGURES,
  FINISHED,
  FINISHED_IDS,
  isLocked,
  itemName,
  MILESTONES,
  pieces,
  ROOM_COUNT,
  ROOMS,
  type Run,
  specOf,
  TRAIL_COUNT,
  trailOpen,
  TRAILS,
  TRAIT_IDS,
  TRAITS,
} from "../../game/index.ts";
import { glyph, itemIcon, roomIcon, traitIcon } from "../art/icons.ts";
import { portrait, starsPic } from "../art/sprites.ts";
import { paintSwatch } from "../art/table.ts";
import { later } from "../fx.ts";
import {
  baseOf,
  clothOf,
  lanternOf,
  LOOK_KINDS,
  LOOK_TITLES,
  type LookId,
  type LookKind,
  LOOKS,
  owns,
} from "../keep.ts";
import { snd } from "../sounds.ts";
import { dress } from "../stage.ts";
import { prefsChanged, S } from "../state.ts";
import { explain, figPic, figureCard, itemCard, pic, traitCard } from "./cards.ts";

export type PageId = "front" | "almanac" | "howto" | "looks" | "summary";

/** What the pages ask for. */
export interface PageAsks {
  carryOn: () => void;
  start: (trail: number) => void;
  goHome: () => void;
  leave: () => void;
}

let asks: PageAsks | null = null;
/** A page opened on top of whichever the table would show by itself. */
let extra: PageId | null = null;
let shownKey = "";
let tab = "figures";
let trail = 0;
/** The look being tried on in the looks page, before it is bought or worn. */
let trying: { kind: LookKind; id: LookId } | null = null;
let sureHome = false;

export function openPages(a: PageAsks): void {
  asks = a;
  trail = S.prefs.trail;
}
/** Opens a page over the table. */
export function showPage(id: PageId | null): void {
  extra = id;
  sureHome = false;
  if (id) snd.open();
  else snd.close();
  renderPages(true);
}
export const pageUp = (): PageId | null =>
  extra ?? (S.mode === "front" ? "front" : S.mode === "over" ? "summary" : null);

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
    el("header", "k-head", {}, sign, el("h1", "k-title", { text: title }), withClose ? close() : null),
    body,
  );
}

/** The figures a run has on its board, with their stars. */
function partyRow(run: Run): HTMLElement {
  const row = el("div", "party", {});
  const board = run.board.flatMap((p) => (p ? [p] : []));
  for (const p of board.length > 0 ? board : pieces(run)) {
    row.append(el("div", "who", {}, pic(starsPic(p.stars)), figPic(portrait(p.kind))));
  }
  return row;
}

// ---------- the front page ----------

function front(): HTMLElement {
  const run = S.run;
  const body = el("div", "k-body k-scroll", {});
  if (run && run.phase !== "over") {
    const going = el(
      "div",
      "k-card going",
      {},
      el(
        "div",
        "k-col k-grow tight",
        {},
        el("b", "k-gold", { text: "A raid is laid out" }),
        el("span", "k-d", {
          text: `Room ${run.room + 1} of ${ROOM_COUNT}, ${TRAILS[run.trail]?.name ?? ""}. Resolve ${run.resolve}.`,
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
    add(
      body,
      sureHome
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
  add(body, el("div", "k-label", { text: run ? "Or set out afresh" : "Which way?" }));
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
        "aria-selected": String(trail === i && open),
        "aria-checked": String(trail === i && open),
        onclick: () => {
          if (!open) {
            snd.no();
            return;
          }
          trail = i;
          snd.tap();
          renderPages(true);
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
          ? el("span", "k-s k-dim", { text: `Furthest: room ${best}. Pays ${t.pays}%.` })
          : open && t.pays > 100
            ? el("span", "k-s k-dim", { text: `Pays ${t.pays}%.` })
            : null,
      ),
    );
    trails.append(card);
  }
  add(
    body,
    trails,
    el(
      "button",
      `k-btn wide${run ? " wood" : ""}`,
      { type: "button", id: "start", onclick: () => asks?.start(trail) },
      pic(glyph("swords")),
      run ? "Set out afresh" : "Set out",
    ),
  );
  if (run) add(body, el("span", "k-s k-dim", { text: "Setting out afresh puts down the raid that is laid out." }));
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

function figureTile(id: FigureId): HTMLElement {
  const met = S.almanac.fielded.includes(id);
  const locked = isLocked(id) && !S.almanac.opened.includes(id);
  const starred = S.almanac.threeStars.includes(id);
  const how = MILESTONES.find((m) => m.figure === id)?.text ?? "";
  const tile = el(
    "button",
    `k-card tile${met ? "" : " unmet"}${locked ? " locked" : ""}`,
    { type: "button" },
    pic(portrait(id, { dark: locked || !met }), 2),
    el("span", "k-s", {
      text: locked ? (id === "crab40" ? "Uncounted" : "Not opened") : met ? FIGURES[id].name : "Not met",
    }),
    locked ? el("span", "k-s k-dim how", { text: how }) : null,
    starred ? pic(starsPic(3), 1, "badge") : null,
  );
  if (met && !locked) explain(tile, () => figureCard(id, starred ? 3 : 1, { lore: true }));
  return tile;
}

function almanac(): HTMLElement {
  const a = S.almanac;
  const tabs = el("div", "k-tabs", { role: "tablist" });
  for (const [id, name] of [
    ["figures", "Figures"],
    ["traits", "Traits"],
    ["items", "Items"],
    ["raids", "Raids"],
  ] as const) {
    tabs.append(
      el(
        "button",
        "k-btn sm",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(tab === id),
          onclick: () => {
            tab = id;
            snd.tap();
            renderPages(true);
          },
        },
        name,
      ),
    );
  }
  const page = el("div", "leaf k-scroll", {});
  if (tab === "figures") {
    add(
      page,
      el("div", "k-d", {
        text: `${a.fielded.length} of ${FIGURE_IDS.length} met. ${a.threeStars.length} taken to three stars.`,
      }),
    );
    add(page, el("div", "tiles", {}, ...FIGURE_IDS.map(figureTile)));
  } else if (tab === "traits") {
    add(page, el("div", "k-d", { text: `${a.topped.length} switched all the way on.` }));
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
      explain(row, () => traitCard(id, null, S.almanac, true));
      list.append(row);
    }
    add(page, list);
  } else if (tab === "items") {
    add(page, el("div", "k-d", { text: `${a.forged.length} of ${FINISHED_IDS.length} made.` }));
    const comps = el("div", "tiles small", {});
    for (const id of COMPONENT_IDS) {
      const tile = el(
        "button",
        "k-card tile",
        { type: "button" },
        pic(itemIcon(id), 2),
        el("span", "k-s", { text: itemName(id) }),
      );
      explain(tile, () => itemCard(id, null, -1, true));
      comps.append(tile);
    }
    const made = el("div", "tiles small", {});
    for (const id of FINISHED_IDS) {
      const have = a.forged.includes(id);
      const [x, y] = FINISHED[id].made;
      const tile = el(
        "button",
        `k-card tile${have ? "" : " unmet"}`,
        { type: "button" },
        have ? pic(itemIcon(id), 2) : el("span", "pair", {}, pic(itemIcon(x)), pic(itemIcon(y))),
        el("span", "k-s", { text: have ? itemName(id) : "Not made" }),
      );
      explain(tile, () => itemCard(id, null, -1, true));
      made.append(tile);
    }
    add(page, comps, el("hr", "k-rule"), made);
  } else {
    add(page, el("div", "k-d", { text: `${a.runs} raid${a.runs === 1 ? "" : "s"} walked.` }));
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
            el("span", "k-d", {
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
  return panel("The almanac", pic(glyph("book")), el("div", "k-body", {}, tabs, page), true, "wide");
}

// ---------- how to play ----------

const HOW: readonly (readonly [Parameters<typeof glyph>[0], string])[] = [
  ["acorn", "Buy figures at the stall with acorns. Drag them onto the board, or tap one and then tap a hex."],
  ["figure", "Your level is how many you may field. The rest wait on the bench."],
  ["up", "Three the same become one with a star more. Three of those become one with three."],
  ["book", "Figures that share a kin or a calling switch a trait on. The chips say how far along each is."],
  ["swords", "Set out, and they fight by themselves. You win the room if any of yours is left standing."],
  ["door", "A lost room costs resolve. There are fifteen rooms, with a boss at the end of each wing."],
  ["pin", "Every ten acorns you keep earns one more each room. Hold the stall to keep what is on it."],
  ["brush", "Two components on one figure make an item. Drag one on, or tap it and tap the figure."],
  ["help", "Point at anything, or keep a finger on it, and it says what it is."],
];

function howto(): HTMLElement {
  const paper = el("section", "k-paper page k-rise how", { role: "dialog", "aria-label": "How to play" });
  add(paper, el("div", "k-row", {}, el("h1", "k-title big k-grow", { text: "How to play" }), close()));
  for (const [sign, text] of HOW)
    add(paper, el("div", "k-row line", {}, pic(glyph(sign), 2), el("span", "k-grow", { text })));
  add(paper, el("hr", ""), el("i", "", { text: "Nothing here is timed. Take as long as you like over a room." }));
  return paper;
}

// ---------- looks for the table ----------

function wearing(kind: LookKind): LookId {
  return kind === "cloth" ? S.prefs.cloth : kind === "lantern" ? S.prefs.lantern : S.prefs.bases;
}
function wear(kind: LookKind, id: LookId): void {
  const cloth = clothOf(id);
  const lantern = lanternOf(id);
  const bases = baseOf(id);
  if (kind === "cloth" && cloth) S.prefs.cloth = cloth;
  else if (kind === "lantern" && lantern) S.prefs.lantern = lantern;
  else if (kind === "bases" && bases) S.prefs.bases = bases;
  dress(S.prefs.cloth, S.prefs.lantern);
  prefsChanged();
}

function looks(): HTMLElement {
  const tried: { kind: LookKind; id: LookId } = trying ?? { kind: "cloth", id: wearing("cloth") };
  const spec = LOOKS[tried.kind].find((l) => l.id === tried.id);
  const dressed = {
    cloth: (tried.kind === "cloth" ? clothOf(tried.id) : null) ?? S.prefs.cloth,
    lantern: (tried.kind === "lantern" ? lanternOf(tried.id) : null) ?? S.prefs.lantern,
    bases: (tried.kind === "bases" ? baseOf(tried.id) : null) ?? S.prefs.bases,
  };
  const body = el("div", "k-body k-scroll", {});
  add(
    body,
    el(
      "div",
      "k-row",
      {},
      el("span", "k-d k-grow", { text: "They change how the table looks, and nothing else." }),
      amount("leaf", balance().leaf),
    ),
  );
  add(body, el("div", "swatch", {}, figPic(paintSwatch(dressed.cloth, dressed.lantern, dressed.bases))));
  if (spec) {
    const mine = owns(S.prefs, tried.kind, tried.id);
    const on = wearing(tried.kind) === tried.id;
    const act = on
      ? el("span", "k-chip lit", {}, icon("check"), "On the table")
      : mine
        ? el(
            "button",
            "k-btn sm",
            { type: "button", id: "uselook", onclick: () => wear(tried.kind, tried.id) },
            "Use it",
          )
        : el(
            "button",
            `k-btn leaf sm${has("leaf", spec.leaf) ? "" : " off"}`,
            {
              type: "button",
              id: "buylook",
              onclick: () => {
                if (!spend("leaf", spec.leaf, `The Little Raid: ${spec.name}`)) {
                  snd.no();
                  return;
                }
                S.prefs.owned.push(tried.id);
                snd.leaf();
                wear(tried.kind, tried.id);
              },
            },
            "Buy",
            amount("leaf", spec.leaf),
          );
    if (!on && !mine) closeLeaf(act, `${spec.leaf} Leaf`);
    add(
      body,
      el(
        "div",
        "k-card",
        {},
        el(
          "div",
          "k-col k-grow tight",
          {},
          el("b", "k-gold", { text: spec.name }),
          el("span", "k-d", { text: spec.text }),
        ),
        act,
      ),
    );
  }
  for (const kind of LOOK_KINDS) {
    add(body, el("div", "k-label", { text: LOOK_TITLES[kind] }));
    const row = el("div", "k-wrap", {});
    for (const l of LOOKS[kind]) {
      const mine = owns(S.prefs, kind, l.id);
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
  const ended = S.ended;
  if (!ended) return null;
  const { run, summary: sum, paid, news } = ended;
  const title = sum.won ? "The raid is done." : sum.left ? "Home early." : "Home again.";
  const paper = el("section", "k-paper page k-rise summary", { role: "dialog", "aria-label": title });
  add(
    paper,
    el("h1", "k-title big", { text: title }),
    el("div", "", {
      text: sum.won
        ? "Fifteen rooms, and the crab nobody counted has been counted."
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

  const opened = news.filter((n) => n.t === "opened");
  if (opened.length > 0) {
    add(right, el("div", "k-label", { text: "Opened" }));
    opened.forEach((n, i) => {
      if (n.t !== "opened") return;
      const row = el(
        "div",
        "opened",
        {},
        el("span", "flip", {}, pic(portrait(n.figure, { dark: true }), 2, "was"), pic(portrait(n.figure), 2, "is")),
        el(
          "div",
          "k-col k-grow tight",
          {},
          el("b", "", { text: `${FIGURES[n.figure].name} may turn up at the stall now.` }),
          el("span", "k-dim", { text: n.figure === "crab40" ? "Counted at last." : n.text }),
        ),
      );
      right.append(row);
      later(0.9 + i * 0.7, () => {
        row.classList.add("lit");
        snd.unlock();
      });
    });
  }
  const fresh = news.filter((n) => n.t !== "opened" && n.t !== "best");
  if (fresh.length > 0) {
    const list = el("div", "news", {});
    for (const n of fresh) {
      if (n.t === "fielded")
        list.append(el("span", "new", {}, pic(portrait(n.figure)), `Met ${FIGURES[n.figure].name}`));
      else if (n.t === "threeStars")
        list.append(el("span", "new", {}, pic(starsPic(3)), `${FIGURES[n.figure].name} to three stars`));
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
    add(left, el("div", "k-row pay", {}, el("span", "k-grow", { text: WHY[l.why] }), amount("coin", `+${l.coins}`)));
  if (right.childElementCount === 0)
    add(
      right,
      el("div", "k-label", { text: "New in the almanac" }),
      el("i", "", { text: "Nothing this time. The almanac has seen it all before." }),
    );
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
      el("button", "k-btn", { type: "button", id: "again", onclick: () => asks?.start(sum.trail) }, "Again"),
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
  const key = `${id}:${S.run?.seed ?? 0}:${S.run?.room ?? 0}:${S.ended ? 1 : 0}`;
  if (!force && key === shownKey) return;
  shownKey = key;
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
  box.hidden = false;
  box.dataset.page = id;
  box.replaceChildren(node);
}

/** A touch outside a page that can be closed closes it. */
export function pagesClick(e: MouseEvent): void {
  if (extra && e.target instanceof HTMLElement && e.target.id === "modal") showPage(null);
}
