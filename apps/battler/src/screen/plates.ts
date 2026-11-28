import { framesOf, hoverAt } from "@sequoia-leaf/figures/sprites.ts";
import { catalogOf, partyOf, type RackItem, type RunView, type Stars } from "@sequoia-leaf/raid";
/**
 * The plates on the table while planning (`plate.ts` draws them): each fielded figure's health full,
 * any shield it starts with and the mana it starts with, as the next fight would start them, so the
 * ticks show how big a figure is before the fight. Worked out once for each table (one fight opened,
 * `startPlates`), not each frame.
 */
import { isBossId, isSummonId, specOf, starScale, type UnitKind } from "@sequoia-leaf/raid/content/figures.ts";

import type { HeldAt } from "./held.ts";
import { type StartPlate, startPlates } from "./logic.ts";
import { type Plate, plateAt, shapeOf } from "./plate.ts";
import { V } from "./stage.ts";

/** The last table's plates, what that table was, and the frame it was last asked for (it is read once a frame). */
const PLANNED: { key: string; plates: ReadonlyMap<string, StartPlate>; run: RunView | null; t: number } = {
  key: "",
  plates: new Map(),
  run: null,
  t: -1,
};

function plannedOf(run: RunView): ReadonlyMap<string, StartPlate> {
  if (PLANNED.run === run && PLANNED.t === V.t) return PLANNED.plates;
  PLANNED.run = run;
  PLANNED.t = V.t;
  const ours = partyOf(run);
  const key = JSON.stringify([run.era, ours, run.foe]);
  if (key !== PLANNED.key) {
    PLANNED.key = key;
    PLANNED.plates = startPlates(run.era, ours, run.foe);
  }
  return PLANNED.plates;
}

/** What a figure's own sheet says, for one the fight has no seat for (a figure lifted, or no table yet). */
function ownPlate(run: RunView, kind: UnitKind, stars: Stars): StartPlate {
  const spec = specOf(catalogOf(run), kind);
  return { hp: Math.round(spec.hp * starScale(stars)), shield: 0, mana: spec.mana[0], manaFull: spec.mana[1] };
}

/** One figure's plate while planning: on the board (`seat`, its side's) with its numbers, on the bench (no seat) resting. */
export function planPlate(
  run: RunView,
  who: { kind: UnitKind; stars: Stars; items: readonly RackItem[] },
  side: 0 | 1,
  seat: number | null,
): Plate {
  const start = seat === null ? null : (plannedOf(run).get(`${side}:${seat}`) ?? ownPlate(run, who.kind, who.stars));
  const n = start ?? ownPlate(run, who.kind, who.stars);
  return {
    stars: isSummonId(who.kind) ? 0 : who.stars,
    ours: side === 0,
    hp: n.hp,
    maxHp: n.hp,
    shield: n.shield,
    mana: n.mana,
    manaFull: n.manaFull,
    items: who.items,
    big: isBossId(who.kind),
    resting: start === null,
  };
}

/** Where what a figure standing with its feet at `feet` holds is, on its plate over its head as it is drawn now, on the board or resting on the bench (for pointing at). */
export function heldOver(
  who: { kind: UnitKind; stars: Stars; items: readonly RackItem[] },
  resting: boolean,
  cx: number,
  feet: number,
  phase: number,
): readonly HeldAt[] {
  const shape = shapeOf({ summoned: isSummonId(who.kind), stars: who.stars, items: who.items, manaFull: 0 });
  const plate = { ...shape, big: isBossId(who.kind), resting };
  return plateAt(plate, cx, feet - 3 - hoverAt(who.kind, V.t, phase) - framesOf(who.kind).tall).held;
}
