/** Starting a yard. */
import { BLUEPRINTS, CRATE, KIND, STARTERS } from "./content/machines.ts";
import { STORY } from "./content/story.ts";
import { LAND, type Land } from "./land.ts";
import { fillBoard } from "./orders.ts";
import { repower } from "./power.ts";
import { blank, type Building, reopen, WARM, type World } from "./world.ts";

export interface Fresh {
  readonly seed?: number;
  readonly land?: Land;
  /** Start with this many story orders already done: for trying later parts of the game. */
  readonly story?: number;
}

/** A new yard: the depot in the middle of the first plot, a few pieces to hand, and nothing else. */
export function create(opts: Fresh = {}): World {
  const land = opts.land ?? LAND;
  const cells: (Building | null)[] = Array.from({ length: land.w * land.h }, () => null);
  const [cx, cy] = land.depot;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) cells[(cy + dy) * land.w + cx + dx] = blank("depot", 0);
  const w: World = {
    land,
    cells,
    power: new Uint8Array(land.w * land.h),
    seed: (opts.seed ?? 1) >>> 0,
    tick: 0,
    at: 0,
    till: 0,
    bank: 0,
    told: 0,
    away: null,
    plots: ["yard"],
    plans: [],
    spare: { ...STARTERS },
    blueprints: Array.from({ length: BLUEPRINTS }, () => null),
    story: Math.max(0, Math.min(STORY.length, Math.floor(opts.story ?? 0))),
    filled: {},
    board: [],
    serial: 0,
    done: 0,
    swapAt: 0,
    depot: {},
    given: {},
    sold: 0,
    paid: 0,
    pace: { ticks: 0, warm: WARM, made: {} },
    rates: { gather: 1, belt: 1, craft: 1, reach: 1, crate: CRATE, depot: KIND.depot.gives, slots: 3 },
    open: { kinds: new Set(), plots: new Set(), plans: new Set(), board: false },
    supply: 0,
    demand: 0,
    wire: null,
    news: [],
  };
  reopen(w);
  repower(w);
  fillBoard(w);
  return w;
}
