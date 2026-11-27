/**
 * The front page's parts for the endless ways (`endless.ts`, `modes.ts`): their boards, the rooms of
 * the Deep Woods the member holds, and the news of one taken from them, each read from Leaf when the
 * page is drawn, at most once a minute; the Wilds' choice of board, ever or this week; the lines on
 * an endless way's card; and the line at the top saying a room was taken, said once. The member's
 * newest event looked at is kept in the browser, so the line is not said again here.
 */
import { type Choice, choices } from "@sequoia-leaf/kit/choices.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { isGuest } from "@sequoia-leaf/kit/live.ts";
import { ask as fetchLeaf, isRecord } from "@sequoia-leaf/kit/net.ts";
import { ENDLESS, type EndlessWay, ROOM_COUNT, TRAILS } from "@sequoia-leaf/raid";

import { snd } from "../sounds.ts";
import { S } from "../state.ts";
import { askToBeMet, type DepthBoard, readDepthBoard, type Span, SPAN_NAMES, takenNews } from "./endless.ts";
import type { At, Mode } from "./modes.ts";
import { unshown } from "./own.ts";

/** How often something on the front page is read from Leaf again, at most. */
const READ_EVERY_MS = 60_000;
/** When each thing was last read. */
const readAt = new Map<string, number>();
/** Reads something from Leaf when the front page is drawn, unless it was read less than a minute ago. */
export function readNow(what: string, read: () => Promise<void>): void {
  if (Date.now() - (readAt.get(what) ?? -Infinity) < READ_EVERY_MS) return;
  readAt.set(what, Date.now());
  void read();
}

/** The endless boards as Leaf last gave them, by way and span (`wilds:ever`); the Wilds' board chosen; the rooms held; the lines of rooms taken. */
const woods: { boards: Map<string, DepthBoard>; span: Span; held: number[]; taken: string[] } = {
  boards: new Map(),
  span: "ever",
  held: [],
  taken: [],
};
/** What the front page is read against, of the endless ways. */
export const woodsAt = (): Pick<At, "depths" | "span"> => ({ depths: woods.boards, span: woods.span });
/** The front page has been left: a room taken has been said. */
export const woodsAway = (): void => void (woods.taken = []);

/** The endless way a mode sets out on, if it is one. */
const wayOf = (mode: Mode, at: At): EndlessWay | null => {
  const c = mode.setOut?.(at);
  return c?.do === "endless" ? c.way : null;
};

/** Where the newest of the member's events looked at is kept. */
const SEEN = "raid.taken.v1";
/** Reads the member's events since the newest looked at, for rooms of the Deep Woods taken from them this week. */
async function readTaken(redraw: () => void): Promise<void> {
  const since = Number(keptText(SEEN) ?? 0) || 0;
  const answer = await fetchLeaf(since > 0 ? `/v1/me/events?after=${since}` : "/v1/me/events");
  if (answer.status !== 200) return;
  const news = takenNews(answer.body, S.week.at, since);
  if (news.newest > since) keepText(SEEN, String(news.newest));
  if (news.lines.length === 0) return;
  woods.taken = news.lines;
  redraw();
}
async function readBoard(way: EndlessWay, span: Span, redraw: () => void): Promise<void> {
  const answer = await fetchLeaf(`/v1/game/raid/depths/${way}/${span}`);
  const board = answer.status === 200 ? readDepthBoard(answer.body) : null;
  if (!board) return;
  woods.boards.set(`${way}:${span}`, board);
  redraw();
}
async function readHeld(redraw: () => void): Promise<void> {
  const answer = await fetchLeaf("/v1/game/raid/held");
  const rooms = isRecord(answer.body) && Array.isArray(answer.body.rooms) ? answer.body.rooms : null;
  if (answer.status !== 200 || !rooms) return;
  woods.held = rooms.filter((r): r is number => typeof r === "number");
  redraw();
}

/** Reads what the front page shows of the endless ways: the news of a room taken, and the chosen way's board and rooms held. */
export function readWoods(mode: Mode, at: At, redraw: () => void): void {
  // A guest has no news of their own, and holds nothing.
  const member = !isGuest();
  if (member) readNow("taken", () => readTaken(redraw));
  const way = wayOf(mode, at);
  if (!way) return;
  const span: Span = way === "deep" ? "week" : woods.span;
  readNow(`${way}:${span}`, () => readBoard(way, span, redraw));
  if (member && way === "deep") readNow("held", () => readHeld(redraw));
}

/** The line at the top of the front page: each room of the Deep Woods taken from the member since they last looked. */
export const takenLine = (): HTMLElement | null =>
  woods.taken.length > 0
    ? el("div", "k-card lit taken", {}, ...woods.taken.map((text) => el("b", "", { text })))
    : null;

const SPANS: readonly Choice<Span>[] = [
  { id: "ever", name: SPAN_NAMES.ever },
  { id: "week", name: SPAN_NAMES.week },
];
/** The Wilds' boards to choose between, ever or this week; nothing for any other mode's board. */
export function spanTabs(mode: Mode, at: At, redraw: () => void): HTMLElement | null {
  if (wayOf(mode, at) !== "wilds") return null;
  return choices(SPANS, {
    kind: "tabs",
    name: "Deepest room",
    chosen: woods.span,
    row: "spans",
    look: "sm",
    choose: (id) => {
      woods.span = id;
      snd.tap();
      redraw();
    },
  }).el;
}

/** What setting out on an endless way gives, the same for both. */
const RULES = [
  `After room ${ROOM_COUNT}, the forest has ${ENDLESS.grows}% more health and attack every room, and every boss beaten lets you field 1 more figure, up to ${ENDLESS.chairs} more.`,
  `Rooms 1 to ${ROOM_COUNT} pay Coins as on ${TRAILS[0]?.name ?? ""}. Deeper rooms pay nothing.`,
];
/**
 * An endless way's card, under its words: what both ways give, and for the Deep Woods the rooms the
 * member holds this week and, until they have set out there, that their board and name can be met
 * there. The Deep Woods' lines are held in their place on the Wilds' card too, unseen, so that
 * choosing between the two moves nothing.
 */
export function woodsOpts(mode: Mode, at: At): HTMLElement[] {
  const way = wayOf(mode, at);
  if (!way) return [];
  const deep = way === "deep";
  const held = woods.held.length > 0 ? `Rooms you hold this week: ${woods.held.join(", ")}.` : "";
  const met = askToBeMet(at.almanac, at.endless)
    ? el("p", "k-read k-gold", { text: "Your board and your name can be met by other members in the Deep Woods." })
    : null;
  return [
    ...RULES.map((text) => el("p", "k-d", { text })),
    el("div", "stack", {}, el("div", "k-col tight", unshown(deep), el("p", "k-d", { text: held }), met)),
  ];
}
