/**
 * What lasts between runs: what a finished run pays in Coins, the almanac of what the member has
 * seen and done, and which trails are open. All of it is worked out from a run's summary, so
 * nothing here needs the run itself, a clock or a calendar. None of it changes what the stall
 * offers: every figure is there for everyone.
 */
import { everyFigure } from "./content/catalog.ts";
import { BOSS_IDS, type BossId, type FigureId, isBossId, isFigureId } from "./content/figures.ts";
import { FINISHED_IDS, type FinishedId, isFinishedId } from "./content/items.ts";
import { PAYOUT } from "./content/keepsakes.ts";
import { ROOM_COUNT, TRAIL_COUNT, TRAILS } from "./content/rooms.ts";
import { isTraitId, renamedTraits, TRAIT_IDS, type TraitId } from "./content/traits.ts";
import { type Depths, noDepths, readDepths } from "./depths.ts";
import type { RunSummary } from "./run.ts";

// ---------- Coins ----------

export interface Payout {
  coins: number;
  /** How it adds up, for showing. A last line `full`, of nothing, when the purse could not take it all. */
  lines: { why: "rooms" | "bosses" | "win" | "trail" | "full"; coins: number }[];
}
/** What a run pays, finished or abandoned: for the rooms it won and the bosses it beat, a bonus for winning, and the trail's share on top. */
export function payout(summary: RunSummary): Payout {
  const rooms = summary.cleared * PAYOUT.room;
  const bosses = summary.bosses.length * PAYOUT.boss;
  const win = summary.ending === "won" ? PAYOUT.win : 0;
  const base = rooms + bosses + win;
  const coins = Math.round((base * (TRAILS[summary.trail]?.pays ?? 100)) / 100);
  const lines: Payout["lines"] = [];
  if (rooms > 0) lines.push({ why: "rooms", coins: rooms });
  if (bosses > 0) lines.push({ why: "bosses", coins: bosses });
  if (win > 0) lines.push({ why: "win", coins: win });
  if (coins !== base) lines.push({ why: "trail", coins: coins - base });
  return { coins, lines };
}

// ---------- the almanac ----------

export interface Almanac {
  /** Figures that have stood on the board in a fight. */
  fielded: FigureId[];
  /** Figures taken to three stars. */
  threeStars: FigureId[];
  /** Finished items made. */
  forged: FinishedId[];
  /** Kins and callings switched on at their top step. */
  topped: TraitId[];
  /** For each trail: the bosses beaten on it, and the furthest room met (0 for never set out). */
  bosses: BossId[][];
  best: number[];
  /** Runs finished or abandoned. */
  runs: number;
  /** The deepest room won in each endless way, ever, counting from 1 (`depths.ts`). */
  deepest: Depths;
}
export function newAlmanac(): Almanac {
  return {
    fielded: [],
    threeStars: [],
    forged: [],
    topped: [],
    bosses: TRAILS.map(() => []),
    best: TRAILS.map(() => 0),
    runs: 0,
    deepest: noDepths(),
  };
}

/** The bosses beaten on any trail, each once: what the bosses beaten count, and what a trophy is carved of. */
export const beatenBosses = (almanac: Almanac): ReadonlySet<BossId> => new Set(almanac.bosses.flat());

/** Whether a trail has been cleared: its last boss beaten. */
export const trailCleared = (almanac: Almanac, trail: number): boolean =>
  almanac.bosses[trail]?.includes("bigcrab") === true;
/** Whether a trail may be set out on: the first always, each next one once the one before is cleared. */
export const trailOpen = (almanac: Almanac, trail: number): boolean =>
  trail === 0 || (trail > 0 && trail < TRAIL_COUNT && trailCleared(almanac, trail - 1));

/** Something new in the almanac, for the screen to make a small fuss of. */
export type News =
  | { t: "fielded"; figure: FigureId }
  | { t: "threeStars"; figure: FigureId }
  | { t: "forged"; item: FinishedId }
  | { t: "topped"; trait: TraitId }
  | { t: "boss"; boss: BossId; trail: number }
  | { t: "best"; trail: number; room: number }
  | { t: "trail"; trail: number };

/** Writes a run into the almanac. Gives back a new almanac and what was new in it; the old one is not touched. */
export function recordRun(old: Almanac, summary: RunSummary): { almanac: Almanac; news: News[] } {
  const almanac: Almanac = {
    fielded: old.fielded.slice(),
    threeStars: old.threeStars.slice(),
    forged: old.forged.slice(),
    topped: old.topped.slice(),
    bosses: TRAILS.map((_, i) => (old.bosses[i] ?? []).slice()),
    best: TRAILS.map((_, i) => old.best[i] ?? 0),
    runs: old.runs + 1,
    deepest: { ...old.deepest },
  };
  const news: News[] = [];
  const trail = Math.min(TRAIL_COUNT - 1, Math.max(0, summary.trail));
  const wasOpen = TRAILS.map((_, i) => trailOpen(almanac, i));
  for (const figure of summary.fielded) {
    if (almanac.fielded.includes(figure)) continue;
    almanac.fielded.push(figure);
    news.push({ t: "fielded", figure });
  }
  for (const figure of summary.threeStars) {
    if (almanac.threeStars.includes(figure)) continue;
    almanac.threeStars.push(figure);
    news.push({ t: "threeStars", figure });
  }
  for (const item of summary.forged) {
    if (almanac.forged.includes(item)) continue;
    almanac.forged.push(item);
    news.push({ t: "forged", item });
  }
  for (const trait of summary.topped) {
    if (almanac.topped.includes(trait)) continue;
    almanac.topped.push(trait);
    news.push({ t: "topped", trait });
  }
  const beaten = almanac.bosses[trail] ?? [];
  for (const boss of summary.bosses) {
    if (beaten.includes(boss)) continue;
    beaten.push(boss);
    news.push({ t: "boss", boss, trail });
  }
  almanac.bosses[trail] = beaten;
  if (summary.reached > (almanac.best[trail] ?? 0)) {
    almanac.best[trail] = Math.min(ROOM_COUNT, summary.reached);
    news.push({ t: "best", trail, room: almanac.best[trail] ?? 0 });
  }
  TRAILS.forEach((_, i) => {
    if (!wasOpen[i] && trailOpen(almanac, i)) news.push({ t: "trail", trail: i });
  });
  return { almanac, news };
}

// ---------- reading the almanac ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A list with nothing in it twice, every entry passing a check. */
function uniqueList<T>(v: unknown, is: (x: unknown) => x is T, most: number): T[] | null {
  if (!Array.isArray(v) || v.length > most) return null;
  const out: T[] = [];
  for (const x of v) {
    if (!is(x) || out.includes(x)) return null;
    out.push(x);
  }
  return out;
}

/**
 * An almanac from plain data, as `JSON.parse` gives it back. Anything that is not a whole almanac
 * is none; one kept with another number of trails has one for each trail now, and a furthest room
 * no further than there are rooms.
 */
export function readAlmanac(a: unknown): Almanac | null {
  if (!isRecord(a)) return null;
  const fielded = uniqueList(a.fielded, isFigureId, everyFigure().length);
  const threeStars = uniqueList(a.threeStars, isFigureId, everyFigure().length);
  const forged = uniqueList(a.forged, isFinishedId, FINISHED_IDS.length);
  const topped = uniqueList(renamedTraits(a.topped), isTraitId, TRAIT_IDS.length);
  // An almanac kept while some figures were locked lists those it opened; that list means nothing now.
  if (!fielded || !threeStars || !forged || !topped) return null;
  if (!Array.isArray(a.bosses) || a.bosses.length > 99 || !Array.isArray(a.best) || a.best.length > 99) return null;
  const bosses: BossId[][] = [];
  for (const list of a.bosses) {
    const beaten = uniqueList(list, isBossId, BOSS_IDS.length);
    if (!beaten) return null;
    bosses.push(beaten);
  }
  const best: number[] = [];
  for (const room of a.best) {
    if (typeof room !== "number" || !Number.isInteger(room) || room < 0) return null;
    best.push(room);
  }
  const runs = a.runs;
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs < 0) return null;
  return {
    fielded,
    threeStars,
    forged,
    topped,
    bosses: TRAILS.map((_, i) => bosses[i] ?? []),
    best: TRAILS.map((_, i) => Math.min(ROOM_COUNT, best[i] ?? 0)),
    runs,
    deepest: readDepths(a.deepest),
  };
}
