/**
 * The front page, a picker of the ways to play (`modes.ts`): along the top a strip for each run laid
 * out; down the left the categories, and under the chosen one its modes; in the middle the chosen
 * mode's card, with its options and its Set out; on the right its board; along the bottom the
 * almanac, how to play, table looks and leaving. A phone has the same, one under another. Whatever
 * is chosen, the card, the board and the button keep their size and place.
 */
import { choices, stepped } from "@sequoia-leaf/kit/choices.ts";
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { ask as fetchLeaf } from "@sequoia-leaf/kit/net.ts";
import { type Board as Standings, readBoard } from "@sequoia-leaf/kit/person.ts";
import { ROOM_COUNT, type RunView, TRAILS, unfought } from "@sequoia-leaf/raid";

import { type Glyph, glyph, roomIcon } from "../art/icons.ts";
import { paintLook } from "../art/place.ts";
import { snd } from "../sounds.ts";
import { ask, S } from "../state.ts";
import { figPic, pic } from "./cards.ts";
import {
  type At,
  type Board,
  type BoardRow,
  footOf,
  listed,
  type Mode,
  type ModeId,
  MODES,
  shownCategories,
  shownModes,
  THE_TRAILS,
  trailClosed,
} from "./modes.ts";
import { setsOutOwn, unshown, wayPrefix, waysOf } from "./own.ts";

/** What the front page asks of the rest of the page. */
export interface FrontAsks {
  carryOn: () => void;
  start: (trail: number, own: boolean) => void;
  goHome: () => void;
  leave: () => void;
  open: (page: "almanac" | "howto" | "looks") => void;
  /** Draws the page again, the keyboard where it was. */
  redraw: () => void;
}

/** How many lines a board lists. */
const BOARD_MOST = 10;
/** Each trail's picture: the kind of room it is hardest in. */
const TRAIL_ICONS = ["trouble", "spar", "boss"] as const;

/**
 * What the page keeps for the session: the mode chosen, a trail not open yet that the member is
 * looking at (of those open, Leaf keeps the one picked), and whether ending the raid is being asked.
 */
const kept: { mode: ModeId; trail: number | null; home: boolean } = { mode: "trails", trail: null, home: false };
/** A page has been opened over it, or it has been put away: ending the raid is asked from the start again, and a trail not open yet is no longer looked at. */
export const frontAway = (): void => {
  kept.home = false;
  kept.trail = null;
};

/** The guild's raid board as last read, and when: read again when the front page is drawn a minute or more after. */
const guild: { board: Standings | null; readAt: number } = { board: null, readAt: -Infinity };
const READ_EVERY_MS = 60_000;
async function readGuild(redraw: () => void): Promise<void> {
  guild.readAt = Date.now();
  const answer = await fetchLeaf("/v1/game/play/raid/standings");
  const board = answer.status === 200 ? readBoard(answer.body) : null;
  if (!board) return;
  guild.board = board;
  redraw();
}
const atNow = (): At => ({
  run: S.run,
  almanac: S.almanac,
  trail: kept.trail ?? S.trail,
  own: setsOutOwn(),
  standings: guild.board,
});

// ---------- along the top ----------

/** Ending the raid before its last room: asked first, and not before its first room is fought (the rules' `unfought`). */
function homeOf(go: FrontAsks, run: RunView): HTMLElement {
  if (unfought(run))
    return el("span", "k-read k-dim", { text: "You can end this raid once its first room is fought." });
  const asking = (on: boolean) => (): void => {
    kept.home = on;
    go.redraw();
  };
  if (!kept.home)
    return el("button", "k-btn coral sm", { type: "button", id: "gohome", onclick: asking(true) }, "End this raid");
  const won = run.record.filter((r) => r.result === "win").length;
  return el(
    "div",
    "k-row",
    {},
    el("span", "k-d", {
      text: `End this raid now? You are paid for the ${won} ${won === 1 ? "room" : "rooms"} you won.`,
    }),
    el("button", "k-btn coral sm", { type: "button", onclick: () => go.goHome() }, "End raid"),
    el("button", "k-btn wood sm", { type: "button", onclick: asking(false) }, "Keep playing"),
  );
}

/** A run laid out: its trail, room and health, ending it, and carrying on. */
function strip(go: FrontAsks, run: RunView): HTMLElement {
  return el(
    "div",
    "k-card lit run",
    {},
    el(
      "div",
      "k-col k-grow tight",
      {},
      el("b", "k-gold", { text: TRAILS[run.trail]?.name ?? "" }),
      el("span", "k-dim", { text: `${wayPrefix(run)}Room ${run.room + 1} of ${ROOM_COUNT}. Health ${run.resolve}.` }),
    ),
    el(
      "div",
      "k-row acts",
      {},
      homeOf(go, run),
      el(
        "button",
        "k-btn",
        { type: "button", id: "carryon", onclick: () => go.carryOn() },
        pic(glyph("play")),
        "Carry on",
      ),
    ),
  );
}

// ---------- down the left ----------

/** Chooses a mode, kept for the session. */
function chooseMode(go: FrontAsks, id: ModeId): void {
  if (id === kept.mode) return;
  kept.mode = id;
  snd.tap();
  go.redraw();
}

/** The categories as tabs (only those with a mode shown), and under the chosen one its modes as cards. */
function picker(go: FrontAsks, shown: readonly Mode[], mode: Mode): HTMLElement {
  const list = el("div", "modes", {});
  const cats = shownCategories(shown);
  const tabs = choices(cats, {
    kind: "tabs",
    name: "Ways to play",
    chosen: mode.category,
    row: "cats",
    page: list,
    choose: (id) => chooseMode(go, shown.find((m) => m.category === id)?.id ?? mode.id),
  });
  cats.forEach((c, i) => tabs.el.children[i]?.prepend(pic(glyph(c.icon), 2)));
  for (const m of shown)
    if (m.category === mode.category)
      list.append(
        el(
          "button",
          "k-card",
          {
            type: "button",
            id: `mode-${m.id}`,
            "aria-pressed": String(m === mode),
            onclick: () => chooseMode(go, m.id),
          },
          el("b", "", { text: m.name }),
        ),
      );
  return el("nav", "picker", { "aria-label": "Ways to play" }, tabs.el, list);
}

// ---------- the chosen mode ----------

/** Chooses a trail: one open is Leaf's to keep (it is the one set out on next, on any page); one not open yet is only looked at. */
async function chooseTrail(go: FrontAsks, trail: number, byKey: boolean): Promise<void> {
  if (trail === atNow().trail) return;
  snd.tap();
  const open = trailClosed(S.almanac, trail) === null;
  kept.trail = open ? null : trail;
  if (open) await ask({ do: "trail", trail }, document.getElementById(`trail-${trail}`));
  go.redraw();
  if (byKey) document.getElementById(`trail-${trail}`)?.focus({ preventScroll: true });
}

/**
 * The three trails, a radio group (one stop for Tab, the arrows choose), and under them what the
 * chosen one is: every trail's words in one place, the others hidden, so choosing moves nothing. A
 * trail not open yet says why under Set out when it is chosen.
 */
function trailsOf(go: FrontAsks, at: At): HTMLElement[] {
  const ids = TRAILS.map((_, i) => String(i));
  const group = el("div", "trails", {
    role: "radiogroup",
    "aria-label": "Trails",
    onkeydown: (e: Event) => {
      const next = "key" in e && typeof e.key === "string" ? stepped(ids, String(at.trail), e.key, "radio") : null;
      if (next === null) return;
      e.preventDefault();
      void chooseTrail(go, Number(next), true);
    },
  });
  TRAILS.forEach((t, i) => {
    const why = trailClosed(at.almanac, i);
    const on = at.trail === i;
    group.append(
      el(
        "button",
        `k-card trail${why ? " done" : ""}${on ? " chosen" : ""}`,
        {
          type: "button",
          id: `trail-${i}`,
          role: "radio",
          "aria-checked": String(on),
          tabindex: on ? 0 : -1,
          "aria-describedby": `trail-is-${i}`,
          onclick: () => void chooseTrail(go, i, false),
        },
        why ? icon("lock") : pic(roomIcon(TRAIL_ICONS[i] ?? "trouble")),
        el("b", "k-grow", { text: t.name }),
        t.pays > 100 ? el("span", "k-dim", { text: `Pays ${t.pays}%` }) : null,
      ),
    );
  });
  const about = TRAILS.map((t, i) => el("p", "k-d", { id: `trail-is-${i}`, text: t.text, ...unshown(i === at.trail) }));
  return [group, el("div", "stack", {}, ...about)];
}

/** Set out, or carry on with the run laid out (and beside it New raid); under them, why not or what a new raid ends. */
function footOfCard(go: FrontAsks, mode: Mode, at: At): HTMLElement {
  const foot = footOf(mode, at);
  const start = (words: string, look: string): HTMLElement =>
    el(
      "button",
      `k-btn ${look}`,
      {
        type: "button",
        id: "start",
        disabled: foot.off,
        onclick: () => {
          const c = mode.setOut?.(at);
          if (c) go.start(c.trail, c.own === true);
        },
      },
      pic(glyph("swords")),
      words,
    );
  return el(
    "div",
    "mode-foot",
    {},
    el(
      "div",
      "k-row",
      {},
      foot.anew ? start("New raid", "wood") : null,
      foot.button === "setOut"
        ? start("Set out", "")
        : el(
            "button",
            "k-btn",
            { type: "button", id: "mode-carry", onclick: () => go.carryOn() },
            pic(glyph("play")),
            "Carry on",
          ),
    ),
    el("p", "k-d", { text: foot.line ?? "" }),
  );
}

/** The chosen mode: its name, what it is, a picture of the table, its options, and its foot. */
function card(go: FrontAsks, mode: Mode, at: At): HTMLElement {
  const run = mode.run(at);
  // The raid laid out, while it has fought no room, stays the one set out on: what is chosen is for the next.
  const keep = run !== null && unfought(run);
  const options =
    mode.id === "trails"
      ? [
          keep ? el("div", "k-label", { text: "Which way, next time?" }) : null,
          ...trailsOf(go, at),
          ...waysOf(keep, go.redraw),
        ]
      : [];
  return el(
    "section",
    "k-card mode",
    { "aria-label": mode.name },
    el(
      "div",
      "mode-head",
      {},
      figPic(paintLook(S.looks)),
      el("div", "k-col tight", {}, el("h2", "k-title big", { text: mode.name }), el("p", "k-d", { text: mode.text })),
    ),
    el("div", "mode-opts k-scroll", {}, ...options),
    footOfCard(go, mode, at),
  );
}

// ---------- on the right ----------

/** A line of a board: its rank, its name and its number; lit for the member's own. */
const boardRow = (r: BoardRow): HTMLElement =>
  el(
    "div",
    r.you ? "k-card lit board-row" : "board-row",
    {},
    el("span", "place", { text: r.place === null ? "" : String(r.place) }),
    el("span", "k-grow", { text: r.name }),
    el("b", "k-gold", { text: r.value }),
  );

/** A board: its title, its rows (the member's own lit), and the member's own under them when it is below them. */
export function boardOf(board: Board): HTMLElement {
  const { top, under } = listed(board, BOARD_MOST);
  return el(
    "section",
    "k-card board",
    { "aria-label": board.title },
    el("h2", "k-title", { text: board.title }),
    ...top.map(boardRow),
    ...(under ? [el("hr", "k-rule"), boardRow(under)] : []),
  );
}

// ---------- the page ----------

function bottom(go: FrontAsks): HTMLElement {
  const to = (page: "almanac" | "howto" | "looks", words: string, sign: Glyph): HTMLElement =>
    el(
      "button",
      "k-btn wood sm",
      { type: "button", id: `to${page}`, onclick: () => go.open(page) },
      pic(glyph(sign)),
      words,
    );
  return el(
    "div",
    "k-row menu-foot",
    {},
    to("almanac", "Almanac", "book"),
    to("howto", "How to play", "help"),
    to("looks", "Table looks", "brush"),
    el(
      "button",
      "k-btn wood sm",
      { type: "button", id: "leave", onclick: () => go.leave() },
      icon("back"),
      "Leave the table",
    ),
  );
}

/** What the front page's panel holds. */
export function frontBody(go: FrontAsks): HTMLElement {
  if (Date.now() - guild.readAt >= READ_EVERY_MS) void readGuild(go.redraw);
  const at = atNow();
  const shown = shownModes(MODES);
  const mode = shown.find((m) => m.id === kept.mode) ?? THE_TRAILS;
  const runs = MODES.flatMap((m) => m.run(at) ?? []);
  return el(
    "div",
    "k-body menu",
    {},
    runs.length > 0 ? el("div", "runs", {}, ...runs.map((r) => strip(go, r))) : null,
    el("div", "menu-cols", {}, picker(go, shown, mode), card(go, mode, at), boardOf(mode.board(at))),
    bottom(go),
  );
}
