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
  heldRoom,
  ROOM_COUNT,
  type RunView,
} from "@sequoia-leaf/raid";

/** The ways into the endless slot, by name. */
export const WAY_NAMES: Readonly<Record<EndlessWay, string>> = { wilds: "The Wilds", deep: "The Deep Woods" };

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
export function chairsSaid(run: Pick<RunView, "endless" | "record">): string[] {
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
 * member's board and name: until they have set out there (a run there laid out, or a room won there).
 */
export const askToBeMet = (almanac: Pick<Almanac, "deepest">, endless: RunView | null): boolean =>
  almanac.deepest.deep === 0 && endless?.endless !== "deep";

/** A room of the Deep Woods taken from the member: the event's number, the room (from 1), and by whom. */
export interface Taken {
  readonly id: number;
  readonly room: number;
  readonly by: string;
}
/** A room-taken event (`held_taken`) of the member's, from plain data, if it is one of the raid's from this week (`since`, ms). */
function takenOf(v: unknown, since: number): Taken | null {
  if (!isRecord(v) || v.type !== "held_taken" || !whole(v.id) || !isRecord(v.data)) return null;
  const at = typeof v.created_at === "string" ? Date.parse(v.created_at) : Number.NaN;
  const { game, slot, by } = v.data;
  const room = typeof slot === "string" ? heldRoom(slot) : null;
  const name = isRecord(by) && typeof by.username === "string" ? by.username : null;
  if (game !== "raid" || room === null || name === null || !(at >= since)) return null;
  return { id: v.id, room: room + 1, by: name };
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
  const last = new Map<number, Taken>();
  for (const t of events.map((e) => takenOf(e, since))) {
    if (t && t.id > seen && (last.get(t.room)?.id ?? -1) < t.id) last.set(t.room, t);
  }
  const lines = [...last.values()]
    .toSorted((a, b) => a.room - b.room)
    .map((t) => `Room ${t.room} was taken from you by ${t.by}.`);
  return { newest, lines };
}
