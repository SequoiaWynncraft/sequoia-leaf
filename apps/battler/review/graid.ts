/**
 * For looking at Graid and Seqwawa in a fight from outside (`window.graid`), beside the tours'
 * handle: `watch()` plays a fight on the table as `window.raid.watch` does and keeps its setup, so
 * that `moments()` can say, from a copy of the same fight played to its end, the steps a tour stops
 * at: each true form's fall (and in how many steps it is back up), each rise, and each of Seqwawa's
 * casts.
 */
import { catalogAt, type FightSetup, LAST_ERA, openFight, stepFight } from "@sequoia-leaf/raid";
import { isUnitKind, specOf } from "@sequoia-leaf/raid/content/figures.ts";
import { COLS } from "@sequoia-leaf/raid/hex.ts";

import { startFight } from "../src/screen/fightview.ts";
import { S } from "../src/screen/state.ts";

/** One thing a tour stops for: what it is, whose, the step it happens at, and for a fall the steps until it is back up. */
interface Moment {
  readonly t: string;
  readonly kind: string;
  readonly id: number;
  readonly at: number;
  readonly back?: number;
  readonly why?: string;
}

const kept: { setup: FightSetup | null } = { setup: null };

/** A party seated by reach, as the tours' handle seats one: reach 1 in front, 2 behind, the rest at the back. */
function seated(kinds: readonly string[], stars: 1 | 2 | 3): FightSetup["sides"][0] {
  const used = new Map<number, number>();
  const figures = kinds.filter(isUnitKind).map((kind) => {
    const range = specOf(catalogAt(LAST_ERA), kind).range;
    const row = range <= 1 ? 0 : range === 2 ? 1 : 3;
    const col = used.get(row) ?? 0;
    used.set(row, col + 1);
    return { kind, stars, seat: row * COLS + ([3, 2, 4, 1, 5, 0, 6][col % COLS] ?? 0), items: [], fed: 0 };
  });
  return { who: "watched", title: "", figures, boons: [], might: 100 };
}

const graid = {
  /** Plays a fight on the table between two parties of the figures named; the table must be planning. */
  watch(ours: string[], theirs: string[], stars: 1 | 2 | 3 = 1, seed = 1): string {
    if (S.screen.at !== "plan") return "not planning";
    const setup: FightSetup = { seed, era: LAST_ERA, sides: [seated(ours, stars), seated(theirs, stars)] };
    kept.setup = setup;
    startFight(setup, S.prefs.speed, S.looks.bases, () => undefined);
    document.body.dataset.mode = "fight";
    return "watching";
  },
  /** The steps a tour stops at in the fight being watched: true forms falling and rising, and Seqwawa's casts. */
  moments(): Moment[] {
    if (!kept.setup) return [];
    const f = openFight(kept.setup);
    const out: Moment[] = [];
    while (!f.over) {
      for (const ev of stepFight(f)) {
        const kind = "id" in ev ? (f.units[ev.id]?.kind ?? "") : "";
        if (ev.t === "fall" && ev.back) out.push({ t: "fall", kind, id: ev.id, at: f.tick, back: ev.back });
        else if (ev.t === "rise") out.push({ t: "rise", kind, id: ev.id, at: f.tick, why: ev.why });
        else if (ev.t === "cast" && ev.kind === "seqwawa") out.push({ t: "cast", kind, id: ev.id, at: f.tick });
      }
    }
    return out;
  },
};

declare global {
  interface Window {
    graid?: typeof graid;
  }
}

export function openGraid(): void {
  window.graid = graid;
}
