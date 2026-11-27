/**
 * The live tables on the raid's front page, in its Versus category: the tables open to sit at (who
 * opened each, how many sat), Open a table and Sit down; once sat, the table's eight seats until it
 * starts, with Start for whoever opened it and Leave for anyone; once started, Carry on (and the
 * strip along the top, as a run in hand has); once over, how it ended. The member's record at the
 * tables is the card's board (`tablesBoard` in `modes.ts`).
 *
 * The list is read from Leaf every 2 seconds while the card is up and the member sits nowhere; the
 * member's own sitting is read by its line (`line.ts`), and a member who sits at one when the page
 * opens is given it back.
 */
import { el, icon } from "@sequoia-leaf/kit/dom.ts";
import { ask, isRecord } from "@sequoia-leaf/kit/net.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";
import { CHAIRS } from "@sequoia-leaf/raid/sitting/sitting.ts";
import type { SittingView } from "@sequoia-leaf/raid/sitting/view.ts";

import { glyph } from "../art/icons.ts";
import { snd } from "../sounds.ts";
import { pic } from "../ui/cards.ts";
import type { TablesRecord } from "../ui/modes.ts";
import { type Line, openLine } from "./line.ts";
import { placeText, refusalWords } from "./reads.ts";
import { enterTable } from "./seat.ts";
import { doneWithTable, liveLine, liveView, onDone, takeUp } from "./seated.ts";

/** A table open to sit at, as Leaf lists it. */
interface Listed {
  readonly id: string;
  readonly by: string;
  readonly sat: number;
}

const T: {
  scope: Scope | null;
  me: { id: string; name: string } | null;
  redraw: () => void;
  open: readonly Listed[] | null;
  record: TablesRecord | null;
  recordAt: number;
  /** Why the last thing asked was not done, said under the buttons. */
  why: string | null;
  /** Leaving a started table is asked first. */
  leaving: boolean;
  asking: boolean;
} = {
  scope: null,
  me: null,
  redraw: () => undefined,
  open: null,
  record: null,
  recordAt: -Infinity,
  why: null,
  leaving: false,
  asking: false,
};

const RECORD_EVERY = 60_000;
const LIST_EVERY = 2000;

/** The list Leaf answers, and the member's own sitting. */
function readListed(body: unknown): { open: Listed[]; yours: string | null } | null {
  if (!isRecord(body) || !Array.isArray(body.open)) return null;
  const open = body.open.flatMap((t): Listed[] =>
    isRecord(t) &&
    typeof t.id === "string" &&
    isRecord(t.by) &&
    typeof t.by.name === "string" &&
    typeof t.sat === "number"
      ? [{ id: t.id, by: t.by.name, sat: t.sat }]
      : [],
  );
  return { open, yours: typeof body.yours === "string" ? body.yours : null };
}

async function readList(): Promise<void> {
  const answer = await ask("/v1/game/sittings");
  const listed = answer.status === 200 ? readListed(answer.body) : null;
  if (!listed) return;
  const before = JSON.stringify(T.open);
  T.open = listed.open;
  if (listed.yours && !liveLine()) await follow(listed.yours);
  if (JSON.stringify(T.open) !== before) T.redraw();
}

async function readRecord(): Promise<void> {
  T.recordAt = Date.now();
  const answer = await ask("/v1/game/sittings/record");
  const b = answer.body;
  if (answer.status !== 200 || !isRecord(b)) return;
  const { played, won, top_four: four } = b;
  if (typeof played !== "number" || typeof won !== "number" || typeof four !== "number") return;
  T.record = { played, won, four };
  T.redraw();
}

/** Takes up a sitting from Leaf's answer for it. */
function lineFrom(id: string, body: unknown): Line | null {
  const line = T.scope && T.me ? openLine(T.scope, id, T.me.id, body) : null;
  if (line) takeUp(line);
  return line;
}

/** Follows the member's own sitting, as Leaf has it: the line to it, and the front page drawn again. */
async function follow(id: string): Promise<Line | null> {
  const answer = await ask(`/v1/game/sittings/${id}`);
  const line = answer.status === 200 ? lineFrom(id, answer.body) : null;
  T.redraw();
  return line;
}

/** Asks something of Leaf for the card, one thing at a time, and says why when it was not done. */
async function asking(what: () => Promise<string | null>): Promise<void> {
  if (T.asking) return;
  T.asking = true;
  T.why = null;
  snd.tap();
  try {
    T.why = await what();
  } finally {
    T.asking = false;
    T.redraw();
  }
}

/** Opens a table, with the member sat at it. */
function openTable(): void {
  void asking(async () => {
    const answer = await ask("/v1/game/sittings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: T.me?.id }),
    });
    if (answer.status === 200 && isRecord(answer.body) && typeof answer.body.id === "string") {
      return lineFrom(answer.body.id, answer.body) ? null : "That table could not be read.";
    }
    return isRecord(answer.body) && typeof answer.body.message === "string"
      ? `${answer.body.message}.`
      : "Leaf did not answer. Try again.";
  });
}

/** Sits down at an open table. */
function sitAt(id: string): void {
  void asking(async () => {
    const line = await follow(id);
    if (!line) return "That table is gone.";
    const answer = await line.send({ do: "sit" });
    if (!("refused" in answer)) return null;
    doneWithTable();
    return refusalWords(answer.refused, answer.why);
  });
}

/** A command of the member's at their sitting, from the card. */
function command(c: { do: "start" } | { do: "leave" }, then: () => void = () => undefined): void {
  void asking(async () => {
    const line = liveLine();
    if (!line) return null;
    const answer = await line.send(c);
    if ("refused" in answer) return refusalWords(answer.refused, answer.why);
    then();
    return null;
  });
}

const mineOf = (view: SittingView) => (view.you === null ? null : (view.seats[view.you] ?? null));
const inCount = (view: SittingView): number => view.seats.filter((s) => s.place === null).length;

// ---------- the card ----------

/** The eight seats of a table not started: who sat, in order, and the rest for regulars. */
function seatsOf(view: Extract<SittingView["stage"], { at: "open" }>, by: string): HTMLElement {
  const rows = Array.from({ length: CHAIRS }, (_, i) => {
    const m = view.sat[i];
    return el(
      "div",
      m?.id === T.me?.id ? "k-card lit board-row" : "board-row",
      {},
      el("span", "place", { text: String(i + 1) }),
      m ? el("span", "k-grow", { text: m.name }) : el("span", "k-grow k-dim", { text: "A regular will sit here" }),
      m?.id === by ? el("span", "k-dim", { text: "Opened it" }) : null,
    );
  });
  return el("div", "k-col tight live-seats", { id: "live-seats" }, ...rows);
}

/** The tables open to sit at, each with Sit down. */
function openList(): HTMLElement[] {
  if (T.open === null) return [el("p", "k-d k-dim", { text: "Looking for tables." })];
  if (T.open.length === 0)
    return [
      el("p", "k-d", { text: "No tables are open. Open one: others can sit down, and you start it when you like." }),
    ];
  return [
    el("div", "k-label", { text: "Open tables" }),
    el(
      "div",
      "k-col tight live-list",
      {},
      ...T.open.map((t) =>
        el(
          "div",
          "board-row",
          {},
          el("span", "k-grow", { text: `${t.by}'s table` }),
          el("span", "k-dim", { text: `${t.sat} of ${CHAIRS} seated` }),
          el(
            "button",
            "k-btn sm",
            { type: "button", "data-table": t.id, disabled: T.asking, onclick: () => sitAt(t.id) },
            "Sit down",
          ),
        ),
      ),
    ),
  ];
}

/** What the card holds: the open tables, the member's table before it starts, or how it stands. */
export function tablesBody(redraw: () => void): HTMLElement[] {
  T.redraw = redraw;
  if (Date.now() - T.recordAt >= RECORD_EVERY) void readRecord();
  const view = liveView();
  if (!view) return [el("div", "k-col", { id: "live-tables" }, ...openList())];
  const mine = mineOf(view);
  if (view.stage.at === "open")
    return [el("div", "k-label", { id: "live-tables", text: "Your table" }), seatsOf(view.stage, view.by)];
  const where =
    view.stage.at === "over"
      ? `Your table is over${mine?.place ? `: ${placeText(mine.place)}` : ""}.`
      : mine?.place
        ? `You are out of your table: ${placeText(mine.place)}. ${inCount(view)} of ${CHAIRS} still in.`
        : `Your table is on: room ${view.room + 1}, health ${mine?.resolve ?? 0}. ${inCount(view)} of ${CHAIRS} still in.`;
  return [el("p", "k-d", { id: "live-tables", text: where })];
}

const button = (id: string, words: string, onclick: () => void, look = "", sign: HTMLElement | null = null) =>
  el("button", `k-btn ${look}`.trim(), { type: "button", id, disabled: T.asking, onclick }, sign, words);

/** The buttons of a table started: Carry on, and leaving it (asked first: it is going out). */
function startedFoot(view: SittingView): HTMLElement[] {
  if (T.leaving)
    return [
      button("live-leave-yes", "Leave", () => command({ do: "leave" }, doneWithTable), "coral"),
      button(
        "live-leave-no",
        "Stay",
        () => {
          T.leaving = false;
          T.redraw();
        },
        "wood",
      ),
    ];
  const out = mineOf(view)?.place != null;
  return [
    out
      ? null
      : button(
          "live-quit",
          "Leave the table",
          () => {
            T.leaving = true;
            T.redraw();
          },
          "wood",
        ),
    button("live-carry", "Carry on", enterTable, "", pic(glyph("play"))),
  ].filter((b) => b !== null);
}

/** The card's foot: its buttons, and the line under them. */
export function tablesFoot(): HTMLElement {
  const view = liveView();
  let buttons: HTMLElement[];
  let line: string;
  if (!view) {
    buttons = [button("live-open", "Open a table", openTable, "", pic(glyph("swords")))];
    line = "";
  } else if (view.stage.at === "open") {
    const opener = view.by === T.me?.id;
    const empty = CHAIRS - view.stage.sat.length;
    buttons = [
      button("live-leave", "Leave", () => command({ do: "leave" }, doneWithTable), "wood", icon("back")),
      opener ? button("live-start", "Start", () => command({ do: "start" }), "", pic(glyph("swords"))) : null,
    ].filter((b) => b !== null);
    const who = view.stage.sat.find((m) => m.id === view.by)?.name ?? "whoever opened it";
    line = opener
      ? `Start now, and regulars take the ${empty} empty seat${empty === 1 ? "" : "s"}.`
      : `Waiting for ${who} to start. A full table starts by itself.`;
  } else if (view.stage.at === "over") {
    buttons = [button("live-end", "See how it ended", enterTable, "", pic(glyph("play")))];
    line = "";
  } else {
    buttons = startedFoot(view);
    line = T.leaving ? "Leave? You go out, in the last place of those still in." : "";
  }
  return el("div", "mode-foot", {}, el("div", "k-row", {}, ...buttons), el("p", "k-d", { text: T.why ?? line }));
}

/** The strip along the top for the member's live table, started and not over, as a run in hand has one. */
export function liveStrip(): HTMLElement | null {
  const view = liveView();
  const mine = view ? mineOf(view) : null;
  if (!view || !mine || view.stage.at === "open" || view.stage.at === "over" || mine.place !== null) return null;
  return el(
    "div",
    "k-card lit run",
    {},
    el(
      "div",
      "k-col k-grow tight",
      {},
      el("b", "k-gold", { text: "Live table" }),
      el("span", "k-dim", {
        text: `Room ${view.room + 1}. Health ${mine.resolve}. ${inCount(view)} of ${CHAIRS} still in.`,
      }),
    ),
    el("div", "k-row acts", {}, button("live-strip-carry", "Carry on", enterTable, "", pic(glyph("play")))),
  );
}

/** The member's record at the tables, for the card's board. */
export const tablesRecord = (): TablesRecord | null => T.record;

/** Starts following the live tables: the member's own sitting, if they are at one, and the list while the card is up. */
export function openTables(scope: Scope, me: { id: string; name: string }, redraw: () => void): void {
  T.scope = scope;
  T.me = me;
  T.redraw = redraw;
  // Done with a table: the list again, and why when the page says so; a table over has a place in the record, read again.
  onDone((why) => {
    T.recordAt = -Infinity;
    T.leaving = false;
    if (why !== null) T.why = why;
    T.redraw();
  });
  void readList();
  scope.every(LIST_EVERY, () => {
    if (!liveLine() && document.getElementById("live-tables")?.isConnected) void readList();
  });
}
