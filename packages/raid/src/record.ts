/**
 * A run's record of the rooms it fought: the last `KEPT_ROOMS` in full (`Run.record`), and every room
 * before them folded into totals (`Run.before`), so a run keeps the same few kilobytes whatever room
 * it is in. Everything a reader of the record wants of rooms no longer kept in full is a total here:
 * rooms fought, won and lost, the furthest fought and won, the rooms a run is paid for, the bosses
 * beaten, the chairs bosses gave, and whose boards were met lately. `totalsOf` adds the rooms kept in
 * full to them, so a reader reads every room fought the same way however many were folded.
 *
 * A run is stored with its record as rows of values (`roomRow`), the rooms' fields in order: a
 * late run's hundred rooms are three kilobytes so, where as objects they were eight.
 */
import type { BossId } from "./content/figures.ts";
import { ROOM_COUNT, type RoomKind, ROOMS } from "./content/rooms.ts";
import type { FightResult } from "./fight/types.ts";
import type { Party } from "./party.ts";
import { courseOf, type Way } from "./way.ts";

/** How one room went. */
export interface RoomRecord {
  room: number;
  kind: RoomKind;
  result: FightResult;
  standing: [number, number];
  /** The boss that was in it, beaten or not. */
  boss: BossId | null;
  /** Whose board it was, when it was another member's: their Leaf id. */
  met?: string;
}

/** How many of the last rooms a run's record keeps in full. */
export const KEPT_ROOMS = 100;
/** How many of the members met lately are not met again: one member's board at most once in three met in a row. */
export const MET_APART = 2;

/** Rooms fought, as totals: the rooms a run folded out of its record (`Run.before`), or every room it fought (`totalsOf`). */
export interface RoomTotals {
  /** Rooms fought. */
  fought: number;
  /** Of them, the rooms won and the rooms lost; the rest were drawn. */
  won: number;
  lost: number;
  /** The furthest room fought, and the furthest won, counting from 1; 0 for none. */
  furthest: number;
  deepest: number;
  /** The rooms of the fifteen won as the room they are (`ROOMS`), counting from 0, each once: what a run is paid for. */
  cleared: number[];
  /** The bosses beaten in rooms that pay (the course's `paysThrough`), each once, first beaten first. */
  bosses: BossId[];
  /** Boss rooms won past the fifteenth: an endless course gives a chair for each. */
  bossesPast: number;
  /** The members whose boards were met last, most lately last: `MET_APART` at most. */
  met: string[];
}

/** No rooms fought. */
export const noRooms = (): RoomTotals => ({
  fought: 0,
  won: 0,
  lost: 0,
  furthest: 0,
  deepest: 0,
  cleared: [],
  bosses: [],
  bossesPast: 0,
  met: [],
});

/** A list with one more on its end, unless it has it already. */
const once = <T>(list: T[], v: T): T[] => (list.includes(v) ? list : [...list, v]);

/** What a room won adds to totals besides: how deep, a room cleared, a boss beaten, a chair past the fifteenth. */
function won(t: RoomTotals, r: RoomRecord, paysThrough: number): Partial<RoomTotals> {
  return {
    deepest: Math.max(t.deepest, r.room + 1),
    // A room is cleared only as the room it is: a sitting's rooms past the fifteenth are kept as the last, as sparring.
    cleared: r.kind === ROOMS[r.room]?.kind ? once(t.cleared, r.room) : t.cleared,
    bosses: r.boss !== null && r.room < paysThrough ? once(t.bosses, r.boss) : t.bosses,
    bossesPast: t.bossesPast + (r.room >= ROOM_COUNT && r.kind === "boss" ? 1 : 0),
  };
}

/** Totals with one room more, fought on a way. */
export function addRoom(t: RoomTotals, r: RoomRecord, way: Way): RoomTotals {
  return {
    ...t,
    fought: t.fought + 1,
    won: t.won + (r.result === "win" ? 1 : 0),
    lost: t.lost + (r.result === "loss" ? 1 : 0),
    furthest: Math.max(t.furthest, r.room + 1),
    ...(r.result === "win" && won(t, r, courseOf(way).paysThrough)),
    met: r.met === undefined ? t.met : [...t.met, r.met].slice(-MET_APART),
  };
}

/** What of a run its record is: how it set out, the rooms kept in full, and the rest folded. */
export interface Recorded {
  readonly way: Way;
  readonly record: readonly RoomRecord[];
  readonly before: RoomTotals;
}

/** Every room a run fought, as totals: those folded, and those its record keeps. */
export const totalsOf = (run: Recorded): RoomTotals => run.record.reduce((t, r) => addRoom(t, r, run.way), run.before);

/** How many rooms a run has fought. */
export const roomsFought = (run: Pick<Recorded, "record" | "before">): number => run.before.fought + run.record.length;

/**
 * A record kept to its last `KEPT_ROOMS` rooms, the rooms before them folded into `before`: as a room
 * fought is written down, and as a run kept with a longer record is read.
 */
export function folded(
  way: Way,
  record: RoomRecord[],
  before: RoomTotals,
): { record: RoomRecord[]; before: RoomTotals } {
  const over = Math.max(0, record.length - KEPT_ROOMS);
  return { record: record.slice(over), before: record.slice(0, over).reduce((t, r) => addRoom(t, r, way), before) };
}

/** Writes a room fought into a run's record. */
export function keepRoom(run: { way: Way; record: RoomRecord[]; before: RoomTotals }, r: RoomRecord): void {
  const kept = folded(run.way, [...run.record, r], run.before);
  run.record = kept.record;
  run.before = kept.before;
}

/** Whether a run has fought a room: one its record keeps, or one it folded (rooms are fought in turn, so all up to its furthest). */
export const foughtAt = (run: Pick<Recorded, "record" | "before">, room: number): boolean =>
  room < run.before.furthest || run.record.some((r) => r.room === room);

/**
 * The members whose boards a run met in its last `MET_APART` rooms against one, most lately last:
 * those its record says, and the one across now (`now`), whose room is not in the record until it
 * is taken (Leaf asks `Game.meets` before the take).
 */
export const metLately = (run: Recorded, now: Party): string[] =>
  [...totalsOf(run).met, ...(now.by === undefined ? [] : [now.by])].slice(-MET_APART);

/** A room's record as a run is stored: its fields in order, and whose board it was only when it was a member's. */
export type RoomRow =
  | [room: number, kind: RoomKind, result: FightResult, ours: number, theirs: number, boss: BossId | null]
  | [room: number, kind: RoomKind, result: FightResult, ours: number, theirs: number, boss: BossId | null, met: string];
export const roomRow = (r: RoomRecord): RoomRow => {
  const row: RoomRow = [r.room, r.kind, r.result, r.standing[0], r.standing[1], r.boss];
  return r.met === undefined ? row : [...row, r.met];
};

/** A run as it is stored: its record as rows (`roomRow`). */
export const storedRun = <R extends { record: readonly RoomRecord[] }>(
  run: R,
): Omit<R, "record"> & { record: RoomRow[] } => ({ ...run, record: run.record.map(roomRow) });
