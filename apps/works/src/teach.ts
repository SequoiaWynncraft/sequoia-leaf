/**
 * Teaching by doing. Looking at the yard as it stands, this says what the next small thing to try
 * is, and where: one nudge at a time, in the place it matters. The lessons of the first tier are the
 * lesson, each nudge keyed on the lesson in hand; after them the yard is left to explain itself when
 * something goes wrong.
 *
 * Nothing here draws anything or touches the yard.
 */

import {
  BELT,
  BENCH,
  condition,
  DEADFALL,
  DEPOT,
  GATHERER,
  goal,
  item,
  type Kind,
  litOf,
  locked,
  MILL,
  nextOf,
  NONE,
  power,
  PYLON,
  refusal,
  STATES,
  TROUBLE,
  WORKSHOP,
  type Yard,
} from "@sequoia-leaf/factory";

export interface Nudge {
  /** Which lesson this is; one that has been taken is not given again. */
  id: string;
  text: string;
  /** The tile it is about. */
  x: number;
  y: number;
  /** The tool it wants picked up, if any. */
  tool: Kind | "select" | null;
  /** Lessons that are learnt by doing stay until done; the rest are said for a while and then count as taken. */
  lasting: boolean;
}

const has = (w: Yard, kind: Kind): number => w.kind.indexOf(kind);
const PLANKS = item("plank");
const ORE = item("ore");
const STARVED = STATES.indexOf("starved") + TROUBLE;
/** The lessons, in their order: a nudge is about the one in hand. */
const LESSON = { planks: goal("planks"), ingots: goal("ingots"), tools: goal("tools") } as const;

/** The tile nearest the depot where something lies that power reaches (or does not). */
function nearest(w: Yard, test: (i: number) => boolean): { x: number; y: number } | null {
  const [cx, cy] = w.land.depot;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < w.kind.length; i++) {
    if (!test(i)) continue;
    const x = i % w.land.w;
    const y = Math.floor(i / w.land.w);
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

const owned = (w: Yard, i: number): boolean => {
  const plot = w.land.plots[w.land.plot[i] ?? NONE];
  return plot !== undefined && w.plots.includes(plot.plot);
};

/** The next thing worth saying, or nothing. `finger` words the belt lesson for taps rather than a drag. */
export function nudge(w: Yard, taught: ReadonlySet<string>, finger: boolean): Nudge | null {
  const [cx, cy] = w.land.depot;
  const told = (id: string): boolean => taught.has(id);
  const lit = litOf(w);
  const empty = (i: number): boolean => w.kind[i] === NONE;

  if (w.hand === LESSON.planks) {
    const gatherer = has(w, GATHERER);
    if (gatherer < 0) {
      const spot = nearest(w, (i) => w.land.deposit[i] === DEADFALL && lit[i] === 1 && owned(w, i) && empty(i));
      if (spot)
        return {
          id: "gatherer",
          text: "Start here. Pick the Gatherer and place it on the deadfall.",
          ...spot,
          tool: GATHERER,
          lasting: true,
        };
    }
    const mill = has(w, MILL);
    if (gatherer >= 0 && mill < 0) {
      const to = nextOf(w, gatherer);
      if (to >= 0 && empty(to))
        return {
          id: "mill",
          text: "Now place a Mill here, where the Gatherer puts out its items. A Mill turns deadfall into planks.",
          x: to % w.land.w,
          y: Math.floor(to / w.land.w),
          tool: MILL,
          lasting: true,
        };
    }
    if (mill >= 0 && (w.depot[PLANKS] ?? 0) === 0) {
      const to = nextOf(w, mill);
      if (to >= 0 && empty(to))
        return {
          id: "belt",
          text: finger
            ? "A Belt carries the planks to the depot. Tap here, then tap the depot, then Build."
            : "A Belt carries the planks to the depot. Drag from here to the depot.",
          x: to % w.land.w,
          y: Math.floor(to / w.land.w),
          tool: BELT,
          lasting: true,
        };
    }
    if ((w.depot[PLANKS] ?? 0) > 0 && !told("planks"))
      return {
        id: "planks",
        text: "The depot is taking planks. Cinfy's order needs 12. The bar at the top counts them.",
        x: cx,
        y: cy - 1,
        tool: null,
        lasting: false,
      };
    return null;
  }

  if (w.hand === LESSON.ingots && has(w, PYLON) < 0 && !told("pylon")) {
    // A spot for the first pylon: a few tiles in from the nearest ore, back towards the depot.
    const ore = nearest(w, (i) => w.land.deposit[i] === ORE && owned(w, i));
    if (ore) {
      const far = Math.hypot(ore.x - cx, ore.y - cy) || 1;
      for (let back = 3; back <= 5; back++) {
        const x = Math.round(ore.x - ((ore.x - cx) / far) * back);
        const y = Math.round(ore.y - ((ore.y - cy) / far) * back);
        if (refusal(w, PYLON, x, y, Infinity) === null)
          return {
            id: "pylon",
            text: "Ore and stone are on dark tiles, and machines work only on lit tiles. Place a Pylon here: it lights the tiles around it.",
            x,
            y,
            tool: PYLON,
            lasting: true,
          };
      }
    }
  }

  if (w.hand === LESSON.tools && has(w, BENCH) < 0 && !told("bench")) {
    const spot = nearest(
      w,
      (i) =>
        lit[i] === 1 &&
        w.land.deposit[i] === NONE &&
        Math.hypot((i % w.land.w) - cx, Math.floor(i / w.land.w) - cy) > 3.2 &&
        refusal(w, BENCH, i % w.land.w, Math.floor(i / w.land.w), Infinity) === null,
    );
    if (spot)
      return {
        id: "bench",
        text: "A Bench combines two different items into one. It takes items in at its back and at both sides. Bring planks in on one side and ingots on another.",
        ...spot,
        tool: BENCH,
        lasting: true,
      };
  }

  if (w.open.board && !told("board"))
    return {
      id: "board",
      text: "Side orders are unlocked. Each asks for items and pays Coins. Fill one, then hand it over in Orders.",
      x: cx + 1,
      y: cy,
      tool: null,
      lasting: false,
    };

  // Select only once the yard has it.
  const pieces = w.kind.reduce((n, k) => n + (k !== NONE && k !== DEPOT ? 1 : 0), 0);
  if (!told("select") && locked(w.open, { use: "select" }) === null && pieces > 60)
    return {
      id: "select",
      text: "Select moves, copies or removes many pieces at once, and saves them as a blueprint.",
      x: cx,
      y: cy - 1,
      tool: "select",
      lasting: false,
    };

  // After the lessons, the yard speaks up only when something has gone wrong for the first time.
  if (!told("short") && power(w).pace < 1)
    return {
      id: "short",
      text: "The yard uses more power than it makes, so every machine works slower. The power bar at the top shows the speed.",
      x: cx,
      y: cy - 1,
      tool: null,
      lasting: false,
    };
  if (!told("starved")) {
    const stuck = w.kind.findIndex((k, i) => (k === BENCH || k === WORKSHOP) && condition(w, i) === STARVED);
    if (stuck >= 0)
      return {
        id: "starved",
        text: "This machine is full of one item and is waiting for another. Tap it to see which.",
        x: stuck % w.land.w,
        y: Math.floor(stuck / w.land.w),
        tool: null,
        lasting: false,
      };
  }
  return null;
}
