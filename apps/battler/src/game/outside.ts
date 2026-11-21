/**
 * What lasts between runs: what a finished run pays in Coins, the almanac of what the member has
 * seen and done, the few figures that play opens, and which trails are open. All of it is worked
 * out from a run's summary, so nothing here needs the run itself, a clock or a calendar.
 */
import { BOSS_IDS, type BossId, FIGURE_IDS, type FigureId, isBossId, isFigureId } from "./content/figures.ts";
import { FINISHED_IDS, type FinishedId, isFinishedId } from "./content/items.ts";
import { type Milestone, MILESTONES, PAYOUT } from "./content/keepsakes.ts";
import { ROOM_COUNT, TRAIL_COUNT, TRAILS } from "./content/rooms.ts";
import { isTraitId, TRAIT_IDS, type TraitId, TRAITS } from "./content/traits.ts";
import type { RunSummary } from "./run.ts";

// ---------- Coins ----------

export interface Payout {
  coins: number;
  /** How it adds up, for showing. */
  lines: { why: "rooms" | "bosses" | "win" | "trail"; coins: number }[];
}
/** What a run pays, finished or abandoned: for the rooms it won and the bosses it beat, a bonus for winning, and the trail's share on top. */
export function payout(summary: RunSummary): Payout {
  const rooms = summary.cleared * PAYOUT.room;
  const bosses = summary.bosses.length * PAYOUT.boss;
  const win = summary.won ? PAYOUT.win : 0;
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
  /** Locked figures that have been opened. */
  opened: FigureId[];
  /** Runs finished or abandoned. */
  runs: number;
}
export function newAlmanac(): Almanac {
  return {
    fielded: [],
    threeStars: [],
    forged: [],
    topped: [],
    bosses: TRAILS.map(() => []),
    best: TRAILS.map(() => 0),
    opened: [],
    runs: 0,
  };
}

/** Whether a trail has been cleared: its last boss beaten. */
export const trailCleared = (almanac: Almanac, trail: number): boolean =>
  almanac.bosses[trail]?.includes("bigcrab") === true;
/** Whether a trail may be set out on: the first always, each next one once the one before is cleared. */
export const trailOpen = (almanac: Almanac, trail: number): boolean =>
  trail === 0 || (trail > 0 && trail < TRAIL_COUNT && trailCleared(almanac, trail - 1));

const metBy = (almanac: Almanac, m: Milestone): boolean => {
  switch (m.needs.kind) {
    case "boss": {
      const boss = m.needs.boss;
      return almanac.bosses.some((list) => list.includes(boss));
    }
    case "topped":
      return almanac.topped.some((trait) => TRAITS[trait].sort !== "own");
    case "threeStars":
      return almanac.threeStars.length > 0;
  }
};
/** Whether a figure starts out locked away. */
export const isLocked = (figure: FigureId): boolean => MILESTONES.some((m) => m.figure === figure);
/** The figures the stall may offer this member: everyone who was never locked, and whoever has been opened. */
export const openFigures = (almanac: Almanac): FigureId[] =>
  FIGURE_IDS.filter((id) => !isLocked(id) || almanac.opened.includes(id));
/** The locked figures, with what opens each and whether it is open yet. */
export const milestones = (almanac: Almanac): { milestone: Milestone; open: boolean }[] =>
  MILESTONES.map((milestone) => ({ milestone, open: almanac.opened.includes(milestone.figure) }));

/** Something new in the almanac, for the screen to make a small fuss of. */
export type News =
  | { t: "fielded"; figure: FigureId }
  | { t: "threeStars"; figure: FigureId }
  | { t: "forged"; item: FinishedId }
  | { t: "topped"; trait: TraitId }
  | { t: "boss"; boss: BossId; trail: number }
  | { t: "best"; trail: number; room: number }
  | { t: "trail"; trail: number }
  | { t: "opened"; figure: FigureId; text: string };

/** Writes a run into the almanac. Gives back a new almanac and what was new in it; the old one is not touched. */
export function recordRun(old: Almanac, summary: RunSummary): { almanac: Almanac; news: News[] } {
  const almanac: Almanac = {
    fielded: old.fielded.slice(),
    threeStars: old.threeStars.slice(),
    forged: old.forged.slice(),
    topped: old.topped.slice(),
    bosses: TRAILS.map((_, i) => (old.bosses[i] ?? []).slice()),
    best: TRAILS.map((_, i) => old.best[i] ?? 0),
    opened: old.opened.slice(),
    runs: old.runs + 1,
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
  for (const m of MILESTONES) {
    if (almanac.opened.includes(m.figure) || !metBy(almanac, m)) continue;
    almanac.opened.push(m.figure);
    news.push({ t: "opened", figure: m.figure, text: m.text });
  }
  return { almanac, news };
}

// ---------- keeping the almanac ----------

export const ALMANAC_VERSION = 1;
export const saveAlmanac = (almanac: Almanac): string =>
  JSON.stringify({ game: "little-raid-almanac", v: ALMANAC_VERSION, almanac });

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
/** An almanac from text. Text that is not a whole almanac of this version is no almanac. */
export function loadAlmanac(text: string): Almanac | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.game !== "little-raid-almanac" || raw.v !== ALMANAC_VERSION || !isRecord(raw.almanac)) {
    return null;
  }
  const a = raw.almanac;
  const fielded = uniqueList(a.fielded, isFigureId, FIGURE_IDS.length);
  const threeStars = uniqueList(a.threeStars, isFigureId, FIGURE_IDS.length);
  const forged = uniqueList(a.forged, isFinishedId, FINISHED_IDS.length);
  const topped = uniqueList(a.topped, isTraitId, TRAIT_IDS.length);
  const opened = uniqueList(a.opened, isFigureId, FIGURE_IDS.length);
  if (!fielded || !threeStars || !forged || !topped || !opened) return null;
  if (!opened.every(isLocked)) return null;
  if (!Array.isArray(a.bosses) || a.bosses.length !== TRAIL_COUNT) return null;
  const bosses: BossId[][] = [];
  for (const list of a.bosses) {
    const beaten = uniqueList(list, isBossId, BOSS_IDS.length);
    if (!beaten) return null;
    bosses.push(beaten);
  }
  if (!Array.isArray(a.best) || a.best.length !== TRAIL_COUNT) return null;
  const best: number[] = [];
  for (const room of a.best) {
    if (typeof room !== "number" || !Number.isInteger(room) || room < 0 || room > ROOM_COUNT) return null;
    best.push(room);
  }
  const runs = a.runs;
  if (typeof runs !== "number" || !Number.isInteger(runs) || runs < 0) return null;
  return { fielded, threeStars, forged, topped, bosses, best, opened, runs };
}
