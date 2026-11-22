/**
 * The Little Raid as the battler kept it in the browser before the game moved to Leaf, read the way
 * the battler read it then. Only the one-off import (`import-raid.ts`) reads it, and this file goes
 * with that tool once it has run.
 *
 * An old save slot holds `{ saved_at, keys: { <the browser's storage key>: <text> } }`: the `raid`
 * slot keeps the run in progress (`raid.run.v1`) and the almanac (`raid.almanac.v1`), and the
 * `purse` slot the Coins (`town.purse.v1`).
 */
import {
  type Almanac,
  checkRun,
  type FightSetup,
  FIGURES,
  isFigureId,
  loadAlmanac,
  MAX_LEVEL,
  partyOf,
  resolveFight,
  type Run,
} from "@sequoia-leaf/raid";
import { mix } from "@sequoia-leaf/raid/rng.ts";

export const OLD_KEYS = { run: "raid.run.v1", almanac: "raid.almanac.v1", purse: "town.purse.v1" } as const;

/**
 * Where the Works kept Coins of its own before the kit's purse held them: its grey-box purse (a
 * number, as text) and the yard before this one (`coins` in it). The page carried those into the
 * purse when it opened, so the purse's are the Coins; these are only printed beside them.
 */
export const OLD_WORKS_COINS = { greybox: "works.coins.v2", yard: "works.save.v1" } as const;

/** What play can reach, beyond which an old save is not taken without being asked to. */
export const REACH = { stars: 3, acorns: 200, coins: 100_000 } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/** The texts an old slot keeps, by their storage key; null for a slot that is not one. */
export function keysOf(data: string): Record<string, string> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.keys)) return null;
  const keys: Record<string, string> = {};
  for (const [key, text] of Object.entries(raw.keys)) if (typeof text === "string") keys[key] = text;
  return keys;
}

/** The Coins an old purse holds, as the kit's purse read them; null for one that does not say. */
export function oldCoins(text: string): number | null {
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) ? whole(raw.coins) : null;
  } catch {
    return null;
  }
}

/** The Coins the Works kept itself under each of its old keys found among `keys`, by key. */
export function oldWorksCoins(
  keys: Readonly<Record<string, string>>,
): { readonly key: string; readonly coins: number }[] {
  const out: { key: string; coins: number }[] = [];
  for (const key of [OLD_WORKS_COINS.greybox, OLD_WORKS_COINS.yard]) {
    const text = keys[key];
    if (text === undefined) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      continue;
    }
    const coins = key === OLD_WORKS_COINS.greybox ? whole(raw) : isRecord(raw) ? whole(raw.coins) : null;
    if (coins !== null) out.push({ key, coins });
  }
  return out;
}

/** The almanac as the battler kept it (its form has not changed since). */
export const oldAlmanac = (text: string): Almanac | null => loadAlmanac(text);

export type OldRun =
  | {
      readonly ok: true;
      readonly run: Run;
      /** What in the save is beyond what play can reach. */
      readonly warnings: readonly string[];
      /** What was brought within reach so that the rules can hold it at all. */
      readonly changed: readonly string[];
    }
  | { readonly ok: false; readonly why: string };

const nameOf = (kind: unknown): string => (isFigureId(kind) ? FIGURES[kind].name : String(kind));

/**
 * A run in progress as the battler saved it (version 1), with whatever in it play cannot reach
 * listed, and brought within reach where the rules could not hold it otherwise: a figure above
 * three stars at three, a figure more than the level fields on the bench (or, with no room there,
 * left out). A run saved mid-fight comes back at that fight, as the battler brought it back.
 */
export function oldRun(text: string): OldRun {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: "it is not JSON" };
  }
  if (!isRecord(raw) || raw.game !== "little-raid") return { ok: false, why: "it is not a saved raid" };
  if (raw.v !== 1) return { ok: false, why: `it was saved by version ${String(raw.v)}, not the battler's 1` };
  const r = raw.run;
  if (!isRecord(r)) return { ok: false, why: "it has no run in it" };
  const warnings: string[] = [];
  const changed: string[] = [];
  const board = Array.isArray(r.board) ? r.board : [];
  const bench = Array.isArray(r.bench) ? r.bench : [];
  for (const piece of [...board, ...bench]) {
    if (isRecord(piece) && typeof piece.stars === "number" && piece.stars > REACH.stars) {
      warnings.push(`${nameOf(piece.kind)} has ${piece.stars} stars; play reaches ${REACH.stars}`);
      changed.push(`${nameOf(piece.kind)} at ${REACH.stars} stars`);
      piece.stars = REACH.stars;
    }
  }
  const level = typeof r.level === "number" ? r.level : 1;
  const boons = Array.isArray(r.boons) ? r.boons : [];
  const cap = Math.min(MAX_LEVEL, level) + (boons.includes("extrachair") ? 1 : 0);
  const fielded = board.filter((p) => p !== null).length;
  if (fielded > cap) {
    warnings.push(`${fielded} figures on the board at level ${level}; play fields ${cap}`);
    for (let seat = board.length - 1; seat >= 0 && board.filter((p) => p !== null).length > cap; seat--) {
      const piece = board[seat];
      if (piece === null || piece === undefined) continue;
      const slot = bench.indexOf(null);
      board[seat] = null;
      if (slot >= 0) {
        bench[slot] = piece;
        changed.push(`${nameOf(isRecord(piece) ? piece.kind : "?")} to the bench`);
      } else changed.push(`${nameOf(isRecord(piece) ? piece.kind : "?")} left out: no room on the bench`);
    }
  }
  if (typeof r.acorns === "number" && r.acorns > REACH.acorns) {
    warnings.push(`${r.acorns} acorns; play reaches about ${REACH.acorns}`);
  }
  // The battler kept no fight in the save: one in progress was worked out again from the run's seed.
  const fighting = r.phase === "fight";
  r.fight = null;
  if (fighting) r.phase = "plan";
  const read = checkRun(r);
  if (!read.ok) return { ok: false, why: read.why };
  const run = read.run;
  if (fighting) {
    run.phase = "fight";
    const setup: FightSetup = { seed: mix(run.seed, 5000 + run.record.length), sides: [partyOf(run), run.foe] };
    run.fight = { setup, outcome: resolveFight(setup) };
  }
  return { ok: true, run, warnings, changed };
}
