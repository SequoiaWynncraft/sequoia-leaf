/**
 * How a run set out (`Way`: its course and whose figures), and everything keyed from it, one
 * function each: the slot a table keeps it in (`slotOf`), where its boards, holders and depths are
 * left with Leaf (`lanes`), what it is written into (`counts`), what the page calls it
 * (`wayWords`), what a log line and a fight's record say of it (`wayLogged`), and the key its Coins
 * are paid under (`payKey`). Each reads the course's row (`content/ways.ts`) and the pool; none
 * names a mode. A run carries its way from the moment it sets out, and nothing else says it.
 */
import type { Roster } from "./content/catalog.ts";
import { TRAILS } from "./content/rooms.ts";
import {
  type Course,
  type CourseId,
  COURSES,
  type CourseSpec,
  type Pool,
  type Slot,
  type Way,
} from "./content/ways.ts";
import { readRoster } from "./own.ts";

export type { Figures, Roster } from "./content/catalog.ts";
export type { Across, Course, CourseId, CourseSpec, Pool, Slot, Way } from "./content/ways.ts";
export { COURSES, wayWords } from "./content/ways.ts";

export const COURSE_IDS: readonly CourseId[] = ["trail", "wilds", "deep"];
const POOLS: readonly Pool[] = ["fair", "own"];

/** A way on a course: with everyone's figures, or (`roster`) the member's own, as their roster is now. */
export const wayOn = (course: Course, roster: Roster | null = null): Way => ({
  course,
  figures: roster ? { pool: "own", roster } : { pool: "fair" },
});
/** A way on a trail, counting from 0. */
export const onTrail = (trail: number, roster: Roster | null = null): Way => wayOn({ id: "trail", trail }, roster);

/** A way whose trail, if it is on one, is one the forest has: the first to the last of `TRAILS`. */
export const onTrailThere = (way: Way): Way =>
  way.course.id === "trail"
    ? { ...way, course: { id: "trail", trail: Math.min(TRAILS.length - 1, Math.max(0, Math.trunc(way.course.trail))) } }
    : way;

/** A way's course's row. */
export const courseOf = (way: Way): CourseSpec => COURSES[way.course.id];
/** Where a table keeps a run on this way. */
export const slotOf = (way: Way): Slot => courseOf(way).slot;
/** The trail whose forest a run meets: its own on a trail, the first on any other course. */
export const trailOf = (way: Way): number => (way.course.id === "trail" ? way.course.trail : 0);
/** Whether a run may set out on this way: its course offers its pool. */
export const offered = (way: Way): boolean => courseOf(way).pools.includes(way.figures.pool);

// ---------- addressing ----------

/** Where a run is: a slot of a table, or a seat of a sitting (the seat is the caller's, never sent). */
export type RunRef = { readonly at: "table"; readonly slot: Slot } | { readonly at: "sitting"; readonly id: string };

/** The key a run's Coins are paid under: its number in its slot at a table, or its seat at a sitting. */
export const payKey = (ref: RunRef, n: number): string =>
  ref.at === "sitting" ? `sitting:${ref.id}:seat:${n}` : ref.slot === "endless" ? `endless:${n}` : `run:${n}`;

// ---------- lanes ----------

/** A board's or a depth's span: every week there has been, or this one. */
export type Span = "ever" | "week";

/** Where a way's pieces are left with Leaf (`Done.keep`, `Ctx.met`). Null where the way leaves none. */
export interface Lanes {
  /** A member's board at a sparring room (counting from 0), for others on this way to meet. */
  board(room: number): string | null;
  /** The board of the member who holds a room (counting from 0). */
  held(room: number): string | null;
  /** The room a slot of `held` is, or null for any other slot. */
  heldRoom(slot: string): number | null;
  /** A member's deepest room, for this way's board, ever or this week. */
  depth(span: Span): string | null;
}

/**
 * Where a way's boards, holders and depths are left. A course whose sparring rooms meet boards
 * leaves them by trail and room (`board:` everyone's figures, `own:` the member's); one that goes on
 * for ever leaves its depths (`depth:<course>:`, or `depth:own.<course>:`); one whose rooms are held
 * leaves its holders by room (`deep:`, or `deep.own:`). A pool's lanes are its own, so a level never
 * reaches a lane of everyone's figures.
 */
export function lanes(way: Way): Lanes {
  const spec = courseOf(way);
  const own = way.figures.pool === "own";
  const id = way.course.id;
  const held = typeof spec.across === "object" ? `${id}${own ? ".own" : ""}:` : null;
  return {
    board: (room) => (spec.across === "met" ? `${own ? "own" : "board"}:${trailOf(way)}:${room}` : null),
    held: (room) => (held === null ? null : `${held}${room}`),
    heldRoom: (slot) => {
      const room = held !== null && slot.startsWith(held) ? slot.slice(held.length) : "";
      return /^\d{1,4}$/.test(room) ? Number(room) : null;
    },
    depth: (span) => (spec.last === Infinity ? `depth:${own ? "own." : ""}${id}:${span}` : null),
  };
}

// ---------- what it counts for ----------

export interface Counts {
  /** Written into the almanac, and so the trophies, the standing and the trails open. */
  readonly almanac: boolean;
  /** Counted by the Tally: its rooms won, and its win. */
  readonly tally: boolean;
  /** Its deepest room is written down (each pool's apart) and left for its way's board. */
  readonly deepest: boolean;
  /** The boards it meets keep their levels. */
  readonly levelsMet: boolean;
}
/**
 * What a run is written into. Everyone's figures count: on a trail in the almanac and the Tally; on a
 * course without end, its rooms in the Tally and its deepest room. The member's own figures count
 * for nothing but a course's deepest room, kept apart, and meet boards with levels.
 */
export function counts(way: Way): Counts {
  const fair = way.figures.pool === "fair";
  const endless = courseOf(way).last === Infinity;
  return { almanac: fair && !endless, tally: fair, deepest: endless, levelsMet: !fair };
}

// ---------- logged ----------

/** What a log line and a fight's record say of a way. */
export interface WayLogged {
  readonly course: CourseId;
  readonly trail: number;
  readonly pool: Pool;
}
export const wayLogged = (way: Way): WayLogged => ({
  course: way.course.id,
  trail: trailOf(way),
  pool: way.figures.pool,
});

/** How a record kept before the way was logged said it (`FightRecord.way`): the main way, the member's own figures, or an endless way. */
export type OldWay = "main" | "own" | "wilds" | "deep";
/** A way as a fight's record says it in its first column: an endless course by name, or a trail's pool. */
export const oldWayOf = (way: Way): OldWay =>
  way.course.id === "trail" ? (way.figures.pool === "own" ? "own" : "main") : way.course.id;

const isCourseId = (v: unknown): v is CourseId => COURSE_IDS.some((id) => id === v);
const isPool = (v: unknown): v is Pool => POOLS.some((p) => p === v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 999;

/**
 * The way a log line or a fight's record says, as it says it now (`course`, `trail`, `pool`) or as
 * it once did: a record's `way` (`main`, `own`, `wilds`, `deep`) and `trail`; an activity line's
 * `own: true` and `endless: <course>`, whose trail is said only where the line had one (else null).
 * Null for anything else.
 */
export function wayOfLogged(v: Readonly<Record<string, unknown>>): Said | null {
  const trail = whole(v.trail) ? v.trail : null;
  if (v.course === undefined && v.pool === undefined) return saidBefore(v, trail);
  return isCourseId(v.course) && isPool(v.pool) ? { course: v.course, trail, pool: v.pool } : null;
}
/** A way as a line said it, its trail only where the line had one. */
type Said = Omit<WayLogged, "trail"> & { trail: number | null };
/** A way as a line said it before lines said their course and pool: a record's `way`, or an activity line's `own` and `endless`. */
function saidBefore(v: Readonly<Record<string, unknown>>, trail: number | null): Said | null {
  const old = v.way ?? (v.endless === "wilds" || v.endless === "deep" ? v.endless : v.own === true ? "own" : "main");
  if (old === "main" || old === "own") return { course: "trail", trail, pool: old === "own" ? "own" : "fair" };
  return old === "wilds" || old === "deep" ? { course: old, trail: trail ?? 0, pool: "fair" } : null;
}

// ---------- kept ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A way as a run keeps it, or null for anything else. A trail is a whole number; the roster is read as rosters are. */
export function readWay(v: unknown): Way | null {
  if (!isRecord(v) || !isRecord(v.course) || !isRecord(v.figures)) return null;
  const { course, figures } = v;
  const kept: Course | null =
    course.id === "trail"
      ? whole(course.trail)
        ? { id: "trail", trail: course.trail }
        : null
      : course.id === "wilds" || course.id === "deep"
        ? { id: course.id }
        : null;
  if (kept === null) return null;
  if (figures.pool === "fair") return wayOn(kept);
  const roster = figures.pool === "own" ? readRoster(figures.roster) : null;
  return roster ? wayOn(kept, roster) : null;
}

/**
 * The way of a run kept before runs kept one (a table before version 8, a sitting before version
 * 4), from the three fields it kept instead: an endless way (on the first trail, everyone's figures);
 * else its trail, with its roster when it kept one (`own`). Null for a way these could not have said.
 */
export function oldRunWay(trail: unknown, own: unknown, endless: unknown): Way | null {
  if (!whole(trail)) return null;
  const roster = own === undefined || own === null ? null : readRoster(own);
  if (roster === null && own !== undefined && own !== null) return null;
  if (endless === undefined || endless === null) return onTrail(trail, roster);
  return (endless === "wilds" || endless === "deep") && roster === null ? wayOn({ id: endless }) : null;
}
