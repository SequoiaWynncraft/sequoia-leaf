/**
 * Teaching by doing. Looking at the yard as it stands, this says what the next small thing to try
 * is, and where: one nudge at a time, in the place it matters. The first few story orders are the
 * lesson; after them the yard is left to explain itself when something goes wrong.
 *
 * Nothing here draws anything or touches the yard.
 */

import { ahead, type Kind, power, refusal, status, type World } from "@sequoia-leaf/yard";

export interface Nudge {
  /** Which lesson this is; one that has been taken is not given again. */
  id: string;
  text: string;
  /** The tile it is about. */
  x: number;
  y: number;
  /** The tool it wants picked up, if any. */
  tool: Kind | null;
  /** Lessons that are learnt by doing stay until done; the rest are said for a while and then count as taken. */
  lasting: boolean;
}

const has = (w: World, kind: Kind): number => w.cells.findIndex((b) => b?.kind === kind);

/** The tile nearest the depot where something lies that power reaches (or does not). */
function nearest(w: World, test: (i: number) => boolean): { x: number; y: number } | null {
  const [cx, cy] = w.land.depot;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let i = 0; i < w.cells.length; i++) {
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

const owned = (w: World, i: number): boolean => {
  const plot = w.land.plots[w.land.plot[i] ?? -1];
  return plot !== undefined && w.plots.includes(plot.id);
};

/** The next thing worth saying, or nothing. `finger` words the belt lesson for taps rather than a drag. */
export function nudge(w: World, taught: ReadonlySet<string>, finger: boolean): Nudge | null {
  const [cx, cy] = w.land.depot;
  const told = (id: string): boolean => taught.has(id);

  if (w.story === 0) {
    const gatherer = has(w, "gatherer");
    if (gatherer < 0) {
      const spot = nearest(
        w,
        (i) => w.land.deposit[i] === "deadfall" && w.power[i] === 1 && owned(w, i) && !w.cells[i],
      );
      if (spot)
        return {
          id: "gatherer",
          text: "Start here. Pick the Gatherer, and stand it on the deadfall.",
          ...spot,
          tool: "gatherer",
          lasting: true,
        };
    }
    const mill = has(w, "mill");
    if (gatherer >= 0 && mill < 0) {
      const to = ahead(w, gatherer);
      if (to >= 0 && !w.cells[to])
        return {
          id: "mill",
          text: "Now a Mill, where the gatherer hands on. It saws deadfall into planks.",
          x: to % w.land.w,
          y: Math.floor(to / w.land.w),
          tool: "mill",
          lasting: true,
        };
    }
    if (mill >= 0 && (w.depot.plank ?? 0) === 0) {
      const to = ahead(w, mill);
      if (to >= 0 && !w.cells[to])
        return {
          id: "belt",
          text: finger
            ? "A Belt carries the planks in. Tap here, then tap the depot, then Build."
            : "A Belt carries the planks in. Drag from here to the depot.",
          x: to % w.land.w,
          y: Math.floor(to / w.land.w),
          tool: "belt",
          lasting: true,
        };
    }
    if ((w.depot.plank ?? 0) > 0 && !told("planks"))
      return {
        id: "planks",
        text: "Planks are going in. Twelve fill Cinfy's order: the bar up top counts them.",
        x: cx,
        y: cy - 1,
        tool: null,
        lasting: false,
      };
    return null;
  }

  if (w.story === 1 && has(w, "pylon") < 0 && !told("pylon")) {
    // A spot for the first pylon: a few tiles in from the nearest ore, back towards the depot.
    const ore = nearest(w, (i) => w.land.deposit[i] === "ore" && owned(w, i));
    if (ore) {
      const far = Math.hypot(ore.x - cx, ore.y - cy) || 1;
      for (let back = 3; back <= 5; back++) {
        const x = Math.round(ore.x - ((ore.x - cx) / far) * back);
        const y = Math.round(ore.y - ((ore.y - cy) / far) * back);
        if (refusal(w, "pylon", x, y, Infinity) === null)
          return {
            id: "pylon",
            text: "Ore and stone lie in the dark, past the lamplight. A Pylon carries the light, and the power, further.",
            x,
            y,
            tool: "pylon",
            lasting: true,
          };
      }
    }
  }

  if (w.story === 2 && has(w, "bench") < 0 && !told("bench")) {
    const spot = nearest(
      w,
      (i) =>
        w.power[i] === 1 &&
        !w.land.deposit[i] &&
        Math.hypot((i % w.land.w) - cx, Math.floor(i / w.land.w) - cy) > 3.2 &&
        refusal(w, "bench", i % w.land.w, Math.floor(i / w.land.w), Infinity) === null,
    );
    if (spot)
      return {
        id: "bench",
        text: "A Bench puts two things together, and takes them in at its back and both sides: planks one way, ingots another.",
        ...spot,
        tool: "bench",
        lasting: true,
      };
  }

  if (w.open.board && !told("board"))
    return {
      id: "board",
      text: "The board is up on the depot's wall: standing orders from the guild. Fill one, and somebody comes to the gate for it.",
      x: cx + 1,
      y: cy,
      tool: null,
      lasting: false,
    };

  // After the lessons, the yard speaks up only when something has gone wrong for the first time.
  if (!told("short") && power(w).pace < 1)
    return {
      id: "short",
      text: "The lamps are burning low: the yard is short of power, and everything slows together. The plaque up top says by how much.",
      x: cx,
      y: cy - 1,
      tool: null,
      lasting: false,
    };
  if (!told("starved")) {
    const stuck = w.cells.findIndex(
      (b, i) => (b?.kind === "bench" || b?.kind === "workshop") && status(w, i)?.state === "starved",
    );
    if (stuck >= 0)
      return {
        id: "starved",
        text: "This one has filled up with one part and is waiting for another. Tap it.",
        x: stuck % w.land.w,
        y: Math.floor(stuck / w.land.w),
        tool: null,
        lasting: false,
      };
  }
  return null;
}
