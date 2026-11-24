/**
 * The Tally's panel, where the town keeps count. The boards to choose from, by group, and the board
 * chosen, for this week or for all time, as Leaf works it out (`tally.ts` reads it): the top three
 * on the podium, each face as the town draws it on a plinth with their name and number, places 4 to
 * 10 under it, and the member's own place pinned at the foot when they are not in the top ten.
 * Choosing anybody shows their card (`person`). Where the panel is wide the boards are listed
 * beside the board; where it is narrow, "Boards" shows the list in the board's place. A board is
 * read when it is chosen and each minute while it stays open, and its podium rises as it comes,
 * with a note for each place, and the first time the member opens it, a fanfare for the first.
 */

import {
  GROUP_NAMES,
  type Period,
  TALLY_BOARDS,
  TALLY_GROUPS,
  TALLY_KEPT_MS,
  type TallyBoard,
  tallyPath,
  type TallyUnit,
} from "@sequoia-leaf/core";
import { link } from "@sequoia-leaf/kit/card.ts";
import { amount, el, shown, when } from "@sequoia-leaf/kit/dom.ts";
import { member, where } from "@sequoia-leaf/kit/live.ts";
import { ask } from "@sequoia-leaf/kit/net.ts";
import { known } from "@sequoia-leaf/kit/person.ts";
import { waitingLook } from "@sequoia-leaf/kit/play.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { faceFor, facesCame } from "@sequoia-leaf/kit/skin.ts";
import { sfx } from "@sequoia-leaf/kit/sound.ts";

import { G } from "./game.ts";
import { button, pic, slot } from "./hud.ts";
import { knownRanks } from "./players.ts";
import { type Board, laidOut, type Note, readBoard, rising, type Row, sawTally, scoreText } from "./tally.ts";
import { plinth } from "./tallyart.ts";

/** Whether this is the member's first time at the Tally: first place has a fanfare. */
let firstTime = false;
/** The board chosen and the span, while the page is open. */
let chosen: TallyBoard = TALLY_BOARDS[0];
let period: Period = "week";
/** What Leaf answered for each board and span, and when: asked again once `TALLY_KEPT_MS` has passed. */
const answers = new Map<string, { at: number; board: Board | "unread" }>();

/** The span a board is shown for: this week where it has one. */
const spanOf = (b: TallyBoard): Period => (b.week ? period : "all");

// ---------- people ----------

/** Somebody's face as the town draws them: the member's own figure, anybody else's from their skin. */
function faceOf(r: { readonly id: string; readonly name: string; readonly you: boolean }): HTMLCanvasElement {
  const own = r.you ? G.player?.body?.face : undefined;
  return own ?? faceFor(r.id, r.name, where().mode === "live");
}

/** Says who somebody is for their card, and makes `target` open it. */
function personLink(target: HTMLElement, r: Row, face: HTMLCanvasElement): void {
  known({ id: r.id, name: r.name, line: r.guest ? "Guest" : (knownRanks.get(r.id) ?? ""), face });
  link(target, `person:${r.id}`, { side: true });
}

/** A score as its board writes it, Leaf and Coins with their mark. */
function scoreOf(unit: TallyUnit, score: number): HTMLElement {
  const text = scoreText(unit, score);
  if (unit === "leaf") return amount("leaf", text);
  if (unit === "coins") return amount("coin", text);
  return el("b", "k-name k-gold", { text });
}

/** A name, with "Guest" under it for a guest. A long name may break after an underscore before anywhere else. */
function who(r: Row): HTMLElement {
  const parts = r.name.split(/(?<=_)/);
  const name = el("b", "k-name", {}, ...parts.flatMap((part, i) => (i === 0 ? [part] : [el("wbr"), part])));
  return el("span", "tally-who", {}, name, r.guest ? el("span", "k-s k-dim", { text: "Guest" }) : null);
}

// ---------- the board ----------

/** One of the top three, on the plinth of their place; or the plinth alone, for nobody yet. */
function spot(r: Row | undefined, at: 1 | 2 | 3, unit: TallyUnit): HTMLElement {
  const place = r === undefined ? at : r.place === 1 || r.place === 2 ? r.place : 3;
  const stand = el("div", `tally-spot p${at}`);
  if (r !== undefined) {
    const face = faceOf(r);
    const frame =
      place === 1
        ? el("div", "k-tier-5 tally-face", {}, pic(face, 3), el("i", "k-crest"))
        : place === 2
          ? el("div", "k-tier-1 tally-face", {}, pic(face, 3))
          : slot(pic(face, 3), 34);
    const figure = el(
      "button",
      "tally-figure",
      { type: "button" },
      el("b", "k-title big tally-medal", { text: String(r.place) }),
      frame,
      el("span", "tally-said", {}, who(r), scoreOf(unit, r.score)),
    );
    personLink(figure, r, face);
    stand.append(figure);
  }
  const block = shown(plinth(place), 1);
  block.classList.add("tally-plinth");
  stand.append(block);
  return stand;
}

/** A place under the podium. */
function line(r: Row, unit: TallyUnit, i: number): HTMLElement {
  const face = faceOf(r);
  const row = el(
    "button",
    r.you ? "k-card lit tally-row" : "k-card tally-row",
    { type: "button", style: `--i: ${i}` },
    el("b", "k-name tally-place", { text: String(r.place) }),
    el("span", "k-thing-pic", {}, pic(face, 2)),
    who(r),
    r.you ? el("span", "k-info-tagged", { text: "You" }) : null,
    scoreOf(unit, r.score),
  );
  personLink(row, r, face);
  return row;
}

/** The member's own place, pinned at the foot of a board they are on but not in the top of. */
function ownPlace(board: Board, unit: TallyUnit): HTMLElement | null {
  const me = member();
  const { own: place } = laidOut(board);
  if (!me || place === null) return null;
  return el("div", "tally-own", {}, line({ ...place, id: me.id, name: me.name, guest: me.guest, you: true }, unit, 0));
}

/**
 * Draws a board: the podium, the places under it and the member's own. A board just come rises;
 * gives back its notes, one a place.
 */
function drawBoard(at: HTMLElement, board: Board, b: TallyBoard, rise: boolean): readonly Note[] {
  const { podium, rest } = laidOut(board);
  const stage = el(
    "div",
    rise ? "tally-podium rise" : "tally-podium",
    {},
    spot(podium[1], 2, b.unit),
    spot(podium[0], 1, b.unit),
    spot(podium[2], 3, b.unit),
  );
  const empty = podium.length === 0 ? el("div", "k-dim tally-empty", { text: "Nobody yet." }) : null;
  const rows = el("div", rise ? "tally-rows rise" : "tally-rows", {}, ...rest.map((r, i) => line(r, b.unit, i)));
  // A guest is told nothing of a guild's board, which is for members.
  const canJoin = member()?.guest !== true || b.group !== "guild";
  const foot =
    board.you === null && podium.length > 0
      ? canJoin
        ? el("div", "k-dim tally-off", { text: "You are not on this board yet." })
        : null
      : ownPlace(board, b.unit);
  at.replaceChildren(stage, ...(empty ? [empty] : []), rows, ...(foot ? [foot] : []));
  if (!rise) return [];
  // Third, second, then first: a note as each lands; the first board of the first visit, a fanfare.
  const fanfare = firstTime;
  firstTime = false;
  const notes: readonly Note[] = [
    [140, () => sfx.pluck(3)],
    [300, () => sfx.pluck(5)],
    [480, () => (fanfare ? sfx.fanfare() : sfx.twinkle())],
  ];
  return notes.slice(3 - Math.min(3, podium.length));
}

// ---------- the panel ----------

/** Fills the Tally's panel, for as long as `life` lasts; gives back how to keep it up to date. */
export function tallyPanel(body: HTMLElement, life: Scope): () => void {
  firstTime = sawTally();
  const podium = rising(life);
  const root = el("div", "tally");
  const list = el("nav", "tally-list", { "aria-label": "Boards" });
  const view = el("div", "tally-view");
  const tabs = el("div", "k-tabs tally-tabs", { role: "tablist" });
  const heading = el("div", "tally-name");
  const board = el("div", "tally-board");
  const picker = button("wood sm tally-pick", ["Boards"], () => {
    sfx.tap();
    root.classList.add("picking");
    list.querySelector<HTMLElement>("[aria-pressed='true']")?.scrollIntoView({ block: "center" });
  });
  view.append(el("div", "tally-bar", {}, picker, tabs), heading, board);
  root.append(list, view);
  body.append(root);

  /** The answer for the chosen board and span: asked of Leaf now if it has none, or one older than a minute. */
  let readFor: string | null = null;
  const read = (): void => {
    const b = chosen;
    const path = tallyPath(b.id, spanOf(b));
    const had = answers.get(path);
    if ((had && Date.now() - had.at < TALLY_KEPT_MS) || readFor === path) return;
    readFor = path;
    void (async () => {
      const a = await waitingLook(board, ask(path));
      answers.set(path, { at: Date.now(), board: (a.status === 200 ? readBoard(a.body) : null) ?? "unread" });
      if (readFor === path) readFor = null;
    })();
  };

  const choose = (b: TallyBoard): void => {
    chosen = b;
    root.classList.remove("picking");
    sfx.paper();
    read();
  };
  for (const group of TALLY_GROUPS) {
    list.append(el("div", "k-label", { text: GROUP_NAMES[group] }));
    for (const b of TALLY_BOARDS)
      if (b.group === group)
        list.append(
          el("button", "k-card tally-choice", { type: "button", "data-board": b.id, onclick: () => choose(b) }, b.name),
        );
  }

  const span = (p: Period, label: string): HTMLButtonElement => {
    const tab = button("sm", [label], () => {
      period = p;
      sfx.tap();
      read();
    });
    tab.setAttribute("role", "tab");
    tab.dataset.period = p;
    return tab;
  };
  tabs.append(span("week", "This week"), span("all", "All time"));

  /** What was last drawn, so that a board that has just come rises and one drawn again does not. */
  let drawn: string | null = null;
  const draw = when(
    () => {
      const path = tallyPath(chosen.id, spanOf(chosen));
      return `${path}|${facesCame()}|${JSON.stringify(answers.get(path)?.board ?? null)}`;
    },
    () => {
      const b = chosen;
      const p = spanOf(b);
      for (const pick of list.querySelectorAll<HTMLElement>(".tally-choice"))
        pick.setAttribute("aria-pressed", String(pick.dataset.board === b.id));
      for (const tab of tabs.querySelectorAll<HTMLElement>("[data-period]")) {
        tab.setAttribute("aria-selected", String(tab.dataset.period === p));
        tab.hidden = tab.dataset.period === "week" && !b.week;
      }
      heading.replaceChildren(
        el("h3", "k-title", { text: b.name }),
        ...(b.counts === undefined ? [] : [el("p", "k-d", { text: b.counts })]),
      );
      const path = tallyPath(b.id, p);
      const got = answers.get(path)?.board;
      if (got === undefined) return;
      if (got === "unread") {
        podium.still();
        board.replaceChildren(
          el("div", "k-dim", { text: "The Tally could not be read." }),
          button("wood sm", ["Try again"], () => {
            answers.delete(path);
            read();
          }),
        );
        return;
      }
      const fresh = drawn !== path;
      const notes = drawBoard(board, got, b, fresh);
      if (fresh) podium.rise(notes);
      drawn = path;
    },
  );
  read();
  return () => {
    read();
    draw();
  };
}
