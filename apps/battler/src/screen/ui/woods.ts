/**
 * The front page's parts for the endless ways (`endless.ts`, `modes.ts`): their boards, the rooms of
 * the Deep Woods the member holds, and the news of one taken from them, each read from Leaf when the
 * page is drawn (at most once a minute) and again every minute while it stays up (`frontShown`),
 * drawn again only when they changed; the Wilds' choice of board, ever or this week; the lines on
 * an endless way's card; and the line at the top saying a room was taken, said once. The newest of
 * a member's events looked at is kept in the browser under their Leaf id, so the line is not said
 * to them again here, and another member signing in on the same browser has their own.
 */
import { type Choice, choices } from "@sequoia-leaf/kit/choices.ts";
import { el } from "@sequoia-leaf/kit/dom.ts";
import { keepText, keptText } from "@sequoia-leaf/kit/keep.ts";
import { isGuest, member } from "@sequoia-leaf/kit/live.ts";
import { ask as fetchLeaf, isRecord } from "@sequoia-leaf/kit/net.ts";
import { type Release, scope } from "@sequoia-leaf/kit/scope.ts";
import { ENDLESS, type EndlessWay, ROOM_COUNT, TRAILS } from "@sequoia-leaf/raid";

import { snd } from "../sounds.ts";
import { S } from "../state.ts";
import { askToBeMet, type DepthBoard, readDepthBoard, type Span, SPAN_NAMES, takenNews } from "./endless.ts";
import type { At, Mode } from "./modes.ts";
import { unshown } from "./own.ts";

/** How often something on the front page is read from Leaf again: at most, when it is drawn, and every time while it stays up. */
export const READ_EVERY_MS = 60_000;
/** When each thing was last read. */
const readAt = new Map<string, number>();
/** Reads something from Leaf, unless it was read less than a minute ago; `again`, however lately it was. */
export function readNow(what: string, read: () => Promise<void>, again = false): void {
  if (!again && Date.now() - (readAt.get(what) ?? -Infinity) < READ_EVERY_MS) return;
  readAt.set(what, Date.now());
  void read();
}

/**
 * The endless boards as Leaf last gave them, by way and span (`wilds:ever`); the Wilds' board chosen;
 * the rooms held; the lines of rooms taken; and what the front page last showed of them, to read it
 * again while it stays up: the endless way chosen, and how to draw the page again.
 */
const woods: {
  boards: Map<string, DepthBoard>;
  span: Span;
  held: number[];
  taken: string[];
  way: EndlessWay | null;
  redraw: () => void;
} = { boards: new Map(), span: "ever", held: [], taken: [], way: null, redraw: () => undefined };
/** What the front page is read against, of the endless ways. */
export const woodsAt = (): Pick<At, "depths" | "span"> => ({ depths: woods.boards, span: woods.span });
/** The front page has been left: a room taken has been said. */
export const woodsAway = (): void => void (woods.taken = []);

/** The endless way a mode sets out on, if it is one. */
const wayOf = (mode: Mode, at: At): EndlessWay | null => {
  const c = mode.setOut?.(at);
  return c && "course" in c ? c.course : null;
};

/** Whether two things read from Leaf are the same, to draw the page again only when one changed. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Where the newest of a member's events looked at is kept: by their Leaf id, so each member on this browser has their own. */
export const seenKey = (player: string): string => `raid.taken.v1:${player}`;
/**
 * Reads a member's events since the newest they have looked at, for rooms of the Deep Woods taken
 * from them this week: each one not said yet is added to the lines at the top, and the page drawn again.
 */
export async function readTaken(player: string, redraw: () => void): Promise<void> {
  const since = Number(keptText(seenKey(player)) ?? 0) || 0;
  const answer = await fetchLeaf(since > 0 ? `/v1/me/events?after=${since}` : "/v1/me/events");
  if (answer.status !== 200) return;
  const news = takenNews(answer.body, S.week.at, since);
  if (news.newest > since) keepText(seenKey(player), String(news.newest));
  const fresh = news.lines.filter((line) => !woods.taken.includes(line));
  if (fresh.length === 0) return;
  woods.taken = [...woods.taken, ...fresh];
  redraw();
}
async function readBoard(way: EndlessWay, span: Span, redraw: () => void): Promise<void> {
  const answer = await fetchLeaf(`/v1/game/raid/depths/${way}/${span}`);
  const board = answer.status === 200 ? readDepthBoard(answer.body) : null;
  if (!board || same(board, woods.boards.get(`${way}:${span}`))) return;
  woods.boards.set(`${way}:${span}`, board);
  redraw();
}
async function readHeld(redraw: () => void): Promise<void> {
  const answer = await fetchLeaf("/v1/game/raid/held");
  const listed = isRecord(answer.body) && Array.isArray(answer.body.rooms) ? answer.body.rooms : null;
  const rooms = (listed ?? []).filter((r): r is number => typeof r === "number");
  if (answer.status !== 200 || !listed || same(rooms, woods.held)) return;
  woods.held = rooms;
  redraw();
}

/**
 * Reads what the front page shows of the endless ways: for a member (a guest has no news of their
 * own, and holds nothing), the news of a room taken and the rooms held; and the chosen way's board.
 * `again` reads them however lately they were read: the minute has come round.
 */
function readAll(again: boolean): void {
  const { way, redraw } = woods;
  const player = isGuest() ? null : (member()?.id ?? null);
  if (player !== null) {
    readNow("taken", () => readTaken(player, redraw), again);
    readNow("held", () => readHeld(redraw), again);
  }
  if (!way) return;
  const span: Span = way === "deep" ? "week" : woods.span;
  readNow(`${way}:${span}`, () => readBoard(way, span, redraw), again);
}
/** Reads what the front page shows of the endless ways, as it is drawn, and keeps what it shows to read it again while it stays up. */
export function readWoods(mode: Mode, at: At, redraw: () => void): void {
  woods.way = wayOf(mode, at);
  woods.redraw = redraw;
  readAll(false);
}

/**
 * A switch for something done every minute while a page is shown: on starts it (once, however
 * often it is said), off stops it. `every` is the scope's own (`Scope.every`).
 */
export function whileShown(every: (ms: number, tick: () => void) => Release, tick: () => void): (on: boolean) => void {
  const ticking: { stop: Release | null } = { stop: null };
  return (on) => {
    if (on && !ticking.stop) ticking.stop = every(READ_EVERY_MS, tick);
    if (!on && ticking.stop) {
      ticking.stop();
      ticking.stop = null;
    }
  };
}
/** The front page's own scope, which its minute's reading is held by. */
const front = scope();
/**
 * Says whether the front page is shown: while it is, what it shows of the endless ways is read again
 * every minute and drawn again if it changed (the page keeps the keyboard where it was); once it goes,
 * no longer.
 */
export const frontShown = whileShown(
  (ms, tick) => front.every(ms, tick),
  () => readAll(true),
);

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
