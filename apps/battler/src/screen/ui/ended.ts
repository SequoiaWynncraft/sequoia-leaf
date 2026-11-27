/**
 * The paper at a run's end: how it went (for an endless run, how deep, and the member's deepest), its
 * rooms, the party that got there, what is new in the almanac, the Coins paid, and Again or back to
 * town.
 */
import { nameOf, portrait, starsPic } from "@sequoia-leaf/figures/sprites.ts";
import { link } from "@sequoia-leaf/kit/card.ts";
import { add, amount, el, icon } from "@sequoia-leaf/kit/dom.ts";
import {
  type EndlessWay,
  itemName,
  type News,
  type Payout,
  pieces,
  ROOM_COUNT,
  type RunSummary,
  type RunView,
  specOf,
  TRAILS,
  TRAITS,
} from "@sequoia-leaf/raid";

import { glyph, itemIcon, traitIcon } from "../art/icons.ts";
import { endedOf } from "../screen.ts";
import { S } from "../state.ts";
import { figPic, pic } from "./cards.ts";
import { WAY_NAMES } from "./endless.ts";
import { nothingNew, runTag } from "./own.ts";
import { pipsOf } from "./rooms.ts";

/** What the end page asks for: the same again, or the town. */
export interface EndAsks {
  start: (trail: number, own: boolean) => void;
  endless: (way: EndlessWay) => void;
  leave: () => void;
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

/** How far a run went: a trail's rooms won and the furthest reached, or an endless run's depth and the member's deepest in its way. */
function howFar(run: RunView, sum: RunSummary): HTMLElement[] {
  if (sum.ending === "won")
    return [el("div", "", { text: `${ROOM_COUNT} rooms, and the crab nobody counted has been counted.` })];
  const way = run.endless;
  if (!way) {
    const rooms = `${sum.cleared} room${sum.cleared === 1 ? "" : "s"}`;
    return [el("div", "", { text: `${TRAILS[sum.trail]?.name ?? ""}: ${rooms} won, as far as room ${sum.reached}.` })];
  }
  const wins = run.record.filter((r) => r.result === "win");
  const deepest = Math.max(0, ...wins.map((r) => r.room + 1));
  const ever = S.almanac.deepest[way];
  return [
    el("div", "", { text: `${WAY_NAMES[way]}: ${wins.length} rooms won, as deep as room ${deepest}.` }),
    ever > 0
      ? el("div", "k-gold", { text: `Your deepest: room ${ever} ever, room ${S.week.deepest[way]} this week.` })
      : null,
  ].filter((e) => e !== null);
}

/** One thing new in the almanac, with its picture. */
function newThing(n: News): HTMLElement {
  if (n.t === "fielded") return el("span", "new", {}, pic(portrait(n.figure)), `Met ${nameOf(n.figure)}`);
  if (n.t === "threeStars") return el("span", "new", {}, pic(starsPic(3)), `${nameOf(n.figure)} to three stars`);
  if (n.t === "forged") return el("span", "new", {}, pic(itemIcon(n.item)), `Made ${itemName(n.item)}`);
  if (n.t === "topped") return el("span", "new", {}, pic(traitIcon(n.trait)), `${TRAITS[n.trait].name} all the way on`);
  if (n.t === "boss") return el("span", "new", {}, pic(portrait(n.boss)), `Saw off ${specOf(n.boss).name}`);
  return el("span", "new", {}, pic(glyph("door")), n.t === "trail" ? `${TRAILS[n.trail]?.name ?? ""} is open` : "");
}

/** What the run paid, a line for each reason, and the whole. */
function paidLines(paid: Payout, endless: boolean): HTMLElement[] {
  const WHY = {
    rooms: "Rooms won",
    bosses: "Bosses seen off",
    win: endless ? `The first ${ROOM_COUNT} rooms` : "The whole raid",
    trail: "The harder way",
  } as const;
  return [
    ...paid.lines.map((l) =>
      l.why === "full"
        ? el("div", "k-d", { text: "Your purse can take no more for now. It has room again within the hour." })
        : el("div", "k-row pay", {}, el("span", "k-grow", { text: WHY[l.why] }), amount("coin", `+${l.coins}`)),
    ),
    el(
      "div",
      "k-row pay total",
      {},
      el("b", "k-grow", { text: paid.coins > 0 ? "Paid into your purse" : "Nothing to pay this time" }),
      amount("coin", paid.coins),
    ),
  ];
}

/** Again (the same trail and figures, or the same endless way), or back to town. */
function endsRow(asks: EndAsks | null, run: RunView, sum: RunSummary): HTMLElement {
  const way = run.endless;
  const again = (): void => (way ? asks?.endless(way) : asks?.start(sum.trail, !!run.own));
  return el(
    "div",
    "k-wrap ends",
    {},
    el("button", "k-btn", { type: "button", id: "again", onclick: again }, "Again"),
    el(
      "button",
      "k-btn wood",
      { type: "button", id: "totown", onclick: () => asks?.leave() },
      icon("back"),
      "Back to town",
    ),
  );
}

/** The paper for the run the screen shows has ended, or null for none. */
export function summary(asks: EndAsks | null): HTMLElement | null {
  const ended = endedOf(S.screen);
  if (!ended) return null;
  const { run, summary: sum, paid, news } = ended;
  const title = sum.ending === "won" ? "The raid is done." : sum.ending === "left" ? "Raid ended." : "Out of health.";
  const paper = el("section", "k-paper page k-rise summary", { role: "dialog", "aria-label": title });
  add(paper, el("h1", "k-title big", { text: title }), ...howFar(run, sum));
  const left = el("div", "k-col", {});
  const right = el("div", "k-col", {});
  add(paper, el("div", "pips", {}, ...pipsOf(run, "span")), el("div", "cols", {}, left, right));
  add(left, el("div", "k-label", { text: "The party that got there" }), partyRow(run), el("hr", ""));
  const fresh = news.filter((n) => n.t !== "best");
  if (fresh.length > 0)
    add(right, el("div", "k-label", { text: "New in the almanac" }), el("div", "news", {}, ...fresh.map(newThing)));
  else add(right, ...nothingNew(run));
  add(left, ...paidLines(paid, run.endless !== null), endsRow(asks, run, sum));
  return paper;
}
