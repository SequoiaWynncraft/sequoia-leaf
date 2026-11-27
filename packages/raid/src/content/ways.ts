/**
 * The courses a run can set out on, one row each (`COURSES`): where a run on it is kept at the
 * table, the rooms it meets and the last of them, how the forest grows, the chairs a run earns,
 * whether a rule binds each wing, who waits in a sparring room, the rooms that pay, the figures it
 * may set out with, and its name. A run carries its course and its figures as one value (`Way`);
 * `way.ts` works out everything else about its mode from that value and this row. A mode is a row
 * here and a variant of `Course`; a new kind of `Across` or of rooms is one small function beside
 * the others.
 */
import type { Figures } from "./catalog.ts";
import { CYCLE, ENDLESS } from "./endless.ts";
import { ROOM_COUNT, type RoomKind, ROOMS, type RoomSpec, TRAILS } from "./rooms.ts";

/** Where a table keeps a run: the run in hand, or the endless run beside it. */
export type Slot = "main" | "endless";
/** What a run sets out on: a trail of fifteen rooms, or one of the endless ways. */
export type Course =
  { readonly id: "trail"; readonly trail: number } | { readonly id: "wilds" } | { readonly id: "deep" };
export type CourseId = Course["id"];
/** Whose figures a run's stall sells: everyone's, or the member's own (`Figures`, with their roster as it was at the start). */
export type Pool = Figures["pool"];
/** How a run set out: its course, and whose figures. Every way that can be written can be played. */
export interface Way {
  readonly course: Course;
  readonly figures: Figures;
}

/**
 * Who waits in a sparring room: a board another member left there, else a regular (`met`); a
 * regular always (`regular`); or from a room on, the member who holds it, else a regular (`held`).
 */
export type Across = "met" | "regular" | { readonly held: { readonly from: number } };

/** A room fought, as much as the chairs a course gives read of it. */
interface Fought {
  readonly room: number;
  readonly kind: RoomKind;
  readonly result: "win" | "loss" | "draw";
}

export interface CourseSpec {
  /** Where a run on it is kept at the table. */
  readonly slot: Slot;
  /** The room at a place, counting from 0. */
  readonly rooms: (at: number) => RoomSpec | undefined;
  /** The last room, counting from 0: the fifteenth, or none. */
  readonly last: number;
  /** How strong the forest is in a room, in percent. */
  readonly grows: (at: number) => number;
  /** The chairs a run has earned by the rooms it fought: more figures it may field. */
  readonly chairs: (record: readonly Fought[]) => number;
  /** Whether the member picks a rule for each wing (`wilds.ts`). */
  readonly binds: "none" | "wing";
  readonly across: Across;
  /** How many rooms, from the first, pay Coins and count towards a win's pay. */
  readonly paysThrough: number;
  /** Whose figures a run may set out on it with. */
  readonly pools: readonly Pool[];
  readonly name: string;
}

// ---------- the parts ----------

/** The room at a place, counting from 0: one of the fifteen, and after them the cycle, round and round. */
export const roomAt = (room: number): RoomSpec | undefined =>
  room < ROOM_COUNT ? ROOMS[room] : CYCLE[(room - ROOM_COUNT) % CYCLE.length];

/** How strong the forest is in a room, in percent: 100 to the fifteenth, then `ENDLESS.grows` more for each room past it. */
export const grownAt = (room: number): number =>
  room < ROOM_COUNT ? 100 : 100 * (1 + ENDLESS.grows / 100) ** (room - ROOM_COUNT + 1);

/** The chairs bosses beaten after the fifteenth room give: one each, `ENDLESS.chairs` at most. */
const bossChairs = (record: readonly Fought[]): number =>
  Math.min(
    ENDLESS.chairs,
    record.filter((r) => r.room >= ROOM_COUNT && r.kind === "boss" && r.result === "win").length,
  );

/** The endless ways' rooms, forest and chairs, which the two share. */
const ENDLESS_ROOMS = { slot: "endless", rooms: roomAt, last: Infinity, grows: grownAt, chairs: bossChairs } as const;

// ---------- the rows ----------

export const COURSES: { readonly [K in CourseId]: CourseSpec } = {
  trail: {
    slot: "main",
    // Fifteen. A live table's runs go past them, as runs on a trail, until they have a course of their own.
    rooms: roomAt,
    last: ROOM_COUNT - 1,
    grows: () => 100,
    chairs: () => 0,
    binds: "none",
    across: "met",
    paysThrough: ROOM_COUNT,
    pools: ["fair", "own"],
    name: "The trails",
  },
  wilds: {
    ...ENDLESS_ROOMS,
    binds: "wing",
    across: "regular",
    paysThrough: ROOM_COUNT,
    pools: ["fair"],
    name: "The Wilds",
  },
  deep: {
    ...ENDLESS_ROOMS,
    binds: "none",
    across: { held: { from: ENDLESS.heldFrom } },
    paysThrough: ROOM_COUNT,
    pools: ["fair"],
    name: "The Deep Woods",
  },
};

/** What the page calls a way: its course ("The Wilds", or a trail's own name) and its figures. */
export function wayWords(way: Way): { name: string; figures: string } {
  const { course, figures } = way;
  return {
    name: course.id === "trail" ? (TRAILS[course.trail]?.name ?? COURSES.trail.name) : COURSES[course.id].name,
    figures: figures.pool === "own" ? "Your figures" : "All figures",
  };
}
