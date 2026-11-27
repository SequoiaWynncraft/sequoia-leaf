import { readLooks } from "./content/looks.ts";
/**
 * A table as Leaf stores it (`play_state`, the raid's row): written out whole as this version keeps
 * it (`encodeTable`), and read back from this version or any before it (`decodeTable`). Every
 * version once written is read for ever; a shape that gains, loses or re-means a field takes a new
 * one, and the goldens pin each version's keys (`review/golden.ts`).
 */
import { type Era, isEra, LEGACY_ERA } from "./content/releases.ts";
import { readApart, readWeek } from "./depths.ts";
import type { Table } from "./game.ts";
import { readAlmanac, trailOpen } from "./outside.ts";
import { isRecord, isWhole } from "./party.ts";
import type { Run } from "./run.ts";
import { checkRun } from "./save.ts";
import { type Slot, slotOf } from "./way.ts";

const UINT = 0xffffffff;

const GAME = "little-raid-table";
/**
 * 8: the table keeps its runs by slot (`held`) with the runs begun in each (`begun`), where it kept
 * `run` and `endless` beside `runs` and `ventures`; each run keeps how it set out as one value
 * (`Run.way`), where it kept `trail`, `own` and `endless`; and the deepest rooms won with the
 * member's own figures are kept apart (`apart`). 7: a fight's setup keeps what binds it by what the
 * rules set (`FightSetup.rules`) and the rules named, where it kept its one rule by id. 6: the
 * table, each run and each fight's setup keep their era (`releases.ts`). 5: what Greg has eaten is a
 * share of his health (`feed`), where it was meals of 3% each. 4: a run of the Wilds keeps the rule
 * picked for its wing (`Run.wing`), and a fight its rule. 3: the endless run beside the run in hand,
 * and the week's deepest rooms. 2: a run keeps where it stands as one value (`Stage`). A table of
 * versions 1 to 7 is read as well: one of versions 1 to 7 has its runs and their numbers read into
 * their slots, and each run's way read from its three fields; one of versions 4 to 6 has each
 * fight's rule read as that rule's row; one of versions 1 to 5 and its runs are of `LEGACY_ERA`, one
 * of versions 1 to 4 has Greg's meals at 3% each, and one of versions 1 to 3 has no rules, so a run
 * of the Wilds past room 5 picks one at its next boss.
 */
export const TABLE_VERSION = 8;
const READS = [1, 2, 3, 4, 5, 6, 7, TABLE_VERSION] as const;

export const encodeTable = (state: Table): string =>
  JSON.stringify({
    game: GAME,
    v: TABLE_VERSION,
    rng: state.rng,
    era: state.era,
    begun: state.begun,
    held: state.held,
    almanac: state.almanac,
    trail: state.trail,
    looks: state.looks,
    week: state.week,
    apart: state.apart,
  });

/**
 * A run as a table of a version keeps it in a slot, or none: one that does not read, or could not
 * have been kept (one over, one of another slot, one with no number of `begun`), is let go of.
 */
function keptRun(v: unknown, version: number, begun: number, slot: Slot): Run | null {
  const read = v === null || v === undefined ? null : checkRun(v, version === 1, version < 5);
  if (!read?.ok || read.run.stage.phase === "over" || begun <= 0) return null;
  return slotOf(read.run.way) === slot ? read.run : null;
}

const MOST_RUNS = 1_000_000_000;
/**
 * The runs a table kept in each slot and how many were begun there, or null for none that read. A
 * table before version 8 kept the run in hand and its count (`run`, `runs`), and from version 3 the
 * endless run beside it and its own (`endless`, `ventures`: none before).
 */
function keptSlots(raw: Record<string, unknown>, version: number): Pick<Table, "begun" | "held"> | null {
  const old = version < 8;
  const kept = old ? { main: raw.run, endless: raw.endless } : isRecord(raw.held) ? raw.held : null;
  const counted = old ? { main: raw.runs, endless: raw.ventures ?? 0 } : isRecord(raw.begun) ? raw.begun : null;
  if (kept === null || counted === null) return null;
  const { main, endless } = counted;
  if (!isWhole(main, 0, MOST_RUNS)) return null;
  const begun = { main, endless: isWhole(endless, 0, MOST_RUNS) ? endless : 0 };
  if (!old && begun.endless !== endless) return null;
  return {
    begun,
    held: {
      main: keptRun(kept.main, version, begun.main, "main"),
      endless: keptRun(kept.endless, version, begun.endless, "endless"),
    },
  };
}

/** A table's era as it kept it, or null for one that is none; a table kept before there were eras is of the era live then. */
const keptEra = (v: unknown): Era | null => (v === undefined ? LEGACY_ERA : isEra(v) ? v : null);

/**
 * A table from the text Leaf stored, or null for anything not of these versions' shape. Under
 * today's content and numbers it refuses nothing more: a trail picked that is not open is the
 * first, a run that does not read is let go of (`keptRun`), and what an older table did not keep
 * is none, so the almanac and the looks bought are never out of reach.
 */
export function decodeTable(text: string): Table | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const version = isRecord(raw) && raw.game === GAME ? READS.find((v) => v === raw.v) : undefined;
  if (!isRecord(raw) || version === undefined) return null;
  const { rng, trail } = raw;
  if (!isWhole(rng, 0, UINT) || !isWhole(trail, 0, 999)) return null;
  const slots = keptSlots(raw, version);
  const almanac = readAlmanac(raw.almanac);
  const looks = readLooks(raw.looks);
  const era = keptEra(raw.era);
  if (!slots || !almanac || !looks || era === null) return null;
  return {
    rng,
    era,
    ...slots,
    almanac,
    trail: trailOpen(almanac, trail) ? trail : 0,
    looks,
    week: readWeek(raw.week),
    apart: readApart(raw.apart),
  };
}
