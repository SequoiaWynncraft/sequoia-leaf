/**
 * The endless runs on the front page, with no page in it: what each way is called, its boards of
 * depths as Leaf gives them (`GET /v1/game/raid/depths/{way}/{span}`), the line a run of it says on
 * the strip, whether the Deep Woods still asks to be agreed to, and the news that a room held there
 * was taken (`held_taken`, in the member's events). `modes.ts` makes the modes of them.
 */
import {
  type Almanac,
  chairsOf,
  ENDLESS,
  type EndlessWay,
  lanes,
  ROOM_COUNT,
  type RunView,
  wayOn,
  wayWords,
} from "@sequoia-leaf/raid";

/** What the member's own figures are called (`wayWords`). */
const OWN_FIGURES = wayWords(wayOn({ id: "deep" }, {})).figures;
/** What an endless way is called (`wayWords`). */
export const courseName = (course: EndlessWay): string => wayWords(wayOn({ id: course })).name;
/** The Deep Woods with everyone's figures and with the member's own, whose held rooms a room-taken event names by their lanes. */
const DEEP_WOODS = { fair: lanes(wayOn({ id: "deep" })), own: lanes(wayOn({ id: "deep" }, {})) };

/** A board's span: every week there has been, or this one. */
export type Span = "ever" | "week";
export const SPAN_NAMES: Readonly<Record<Span, string>> = { ever: "Ever", week: "This week" };

/** An endless board as Leaf gives it: its first rows, each a member's deepest room won (from 1), and the member's own place. */
export interface DepthBoard {
  readonly top: readonly { place: number; name: string; room: number; you: boolean }[];
  readonly you: { place: number; room: number } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A row of a board from plain data, or null. */
function rowOf(v: unknown): DepthBoard["top"][number] | null {
  if (!isRecord(v) || !whole(v.place) || !whole(v.room) || typeof v.name !== "string") return null;
  return { place: v.place, name: v.name, room: v.room, you: v.you === true };
}
/** An endless board from Leaf's answer, or null for one that does not read. */
export function readDepthBoard(v: unknown): DepthBoard | null {
  if (!isRecord(v) || !Array.isArray(v.top)) return null;
  const top = v.top.map(rowOf);
  if (top.some((r) => r === null)) return null;
  const you =
    isRecord(v.you) && whole(v.you.place) && whole(v.you.room) ? { place: v.you.place, room: v.you.room } : null;
  return { top: top.filter((r) => r !== null), you };
}

/** What a board is shown as: its title, rows of a rank, a name and a room, and the member's own row. */
interface Shown {
  readonly title: string;
  readonly rows: readonly { place: number | null; name: string; value: string; you: boolean }[];
  readonly you: { place: number | null; name: string; value: string; you: true } | null;
}
const roomWord = (room: number): string => `Room ${room}`;
/**
 * An endless board, titled: Leaf's rows, and the member's own place; until Leaf has given one (or
 * where it gives none), the member's own deepest room as the table keeps it (`own`), with no place.
 */
export function depthBoard(title: string, board: DepthBoard | null, own: number): Shown {
  const you = board?.you ?? (own > 0 ? { place: null, room: own } : null);
  return {
    title,
    rows: (board?.top ?? []).map((r) => ({ place: r.place, name: r.name, value: roomWord(r.room), you: r.you })),
    you: you ? { place: you.place, name: "You", value: roomWord(you.room), you: true } : null,
  };
}

/** What an endless run's chairs add, for the level's card: nothing for a run with none. */
export function chairsSaid(run: Pick<RunView, "way" | "record" | "before">): string[] {
  const n = chairsOf(run);
  if (n === 0) return [];
  return [
    `Bosses beaten after room ${ROOM_COUNT}: ${n} more ${n === 1 ? "figure" : "figures"} than your level, ${ENDLESS.chairs} at most.`,
  ];
}

/** Where an endless run is, on its strip: its room (there is no last) and its health. */
export const endlessWhere = (run: Pick<RunView, "room" | "resolve">): string =>
  `Room ${run.room + 1}. Health ${run.resolve}.`;

/**
 * Whether the Deep Woods' card still says that setting out there lets other members meet the
 * member's board and name: until they have set out there with the figures chosen (`own`: their own)
 * (a run there laid out, or a room won there: `deepest`, those figures' deepest rooms).
 */
export const askToBeMet = (deepest: Almanac["deepest"], endless: RunView | null, own = false): boolean =>
  deepest.deep === 0 && !(endless?.way.course.id === "deep" && (endless.way.figures.pool === "own") === own);

/** A room of the Deep Woods taken from the member: the event's number, the room (from 1), whether it was held with their own figures, and by whom. */
export interface Taken {
  readonly id: number;
  readonly room: number;
  readonly own: boolean;
  readonly by: string;
}
/** A room-taken event (`held_taken`) of the member's, from plain data, if it is one of the raid's from this week (`since`, ms). */
function takenOf(v: unknown, since: number): Taken | null {
  if (!isRecord(v) || v.type !== "held_taken" || !whole(v.id) || !isRecord(v.data)) return null;
  const at = typeof v.created_at === "string" ? Date.parse(v.created_at) : Number.NaN;
  const { game, slot, by } = v.data;
  const fair = typeof slot === "string" ? DEEP_WOODS.fair.heldRoom(slot) : null;
  const room = fair ?? (typeof slot === "string" ? DEEP_WOODS.own.heldRoom(slot) : null);
  const name = isRecord(by) && typeof by.username === "string" ? by.username : null;
  if (game !== "raid" || room === null || name === null || !(at >= since)) return null;
  return { id: v.id, room: room + 1, own: fair === null, by: name };
}

/**
 * The member's events as Leaf gives them (`GET /v1/me/events`), read after the newest already looked
 * at (`seen`): the newest one's number, to look after next time, and a line for each room of the Deep
 * Woods taken from them this week (since `since`, ms) and not looked at yet, the last taker of each,
 * by room. Each is said once: read again from the newest, the same events say nothing.
 */
export function takenNews(body: unknown, since: number, seen: number): { newest: number; lines: string[] } {
  const events = isRecord(body) && Array.isArray(body.events) ? body.events : [];
  const newest = Math.max(seen, ...events.map((e) => (isRecord(e) && whole(e.id) ? e.id : 0)));
  // By room, everyone's figures' and the member's own apart.
  const last = new Map<string, Taken>();
  for (const t of events.map((e) => takenOf(e, since))) {
    const key = `${t?.own ? "own." : ""}${t?.room}`;
    if (t && t.id > seen && (last.get(key)?.id ?? -1) < t.id) last.set(key, t);
  }
  const lines = [...last.values()]
    .toSorted((a, b) => Number(a.own) - Number(b.own) || a.room - b.room)
    .map((t) => `Room ${t.room}${t.own ? `, ${OWN_FIGURES.toLowerCase()},` : ""} was taken from you by ${t.by}.`);
  return { newest, lines };
}
