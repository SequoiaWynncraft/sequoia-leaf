/**
 * Teaching by doing. Looking at the yard as it stands, this says what the next small thing to try
 * is, and where: one nudge at a time, in the place it matters. The lessons of the first tier are the
 * lesson, each nudge keyed on the lesson in hand; after them each new idea is said once, when its
 * thing first exists (the tier's screen, a machine's numbers, the grades, the Study, research, a
 * splitter's way put first), and otherwise the yard is left to explain itself when something goes
 * wrong.
 *
 * A nudge is about a tile of the yard, or about a part of the interface (`part`), beside which it is
 * then said. Nothing here draws anything or touches the yard.
 */

import {
  ALL_GOALS,
  BELT,
  BENCH,
  condition,
  DEADFALL,
  FIXED,
  FOLIOS,
  GATHERER,
  GATHERING,
  goal,
  GOALS,
  highest,
  isGraded,
  isMaker,
  isNode,
  item,
  type Kind,
  litOf,
  locked,
  MILL,
  nextOf,
  NONE,
  power,
  PYLON,
  ready,
  RECIPES_N,
  recipeSays,
  refusal,
  RULES,
  STATES,
  STUDY,
  STUDYING,
  TROUBLE,
  type Yard,
} from "@sequoia-leaf/factory";

import { WORKS_KEYS, type WorksAction } from "./keymap.ts";

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
  /**
   * The part of the interface it is about, and is said beside, in place of a tile: the tier's
   * button, research's, the grades over the toolbar, the slot of the tool it wants picked up, or
   * the ways out on a splitter's card.
   */
  part?: "tier" | "research" | "grades" | "tool" | "ways";
}

/** What the member has before them that the yard does not hold: the tile whose card is open (or -1), and the kind of piece in hand. */
export interface Looking {
  readonly picked: number;
  readonly hand: Kind | null;
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

/** Whether a kind has a way it may put first (a splitter). */
const putsFirst = (k: number): boolean => RULES[k]?.set.first !== undefined;

/** Whether the yard may make a recipe that takes more than 1 of a part: from then on a card says numbers. */
const counted = (w: Yard): boolean =>
  RECIPES_N.some((r) => r.need.some((n) => n > 1) && locked(w.open, { make: r.out }) === null);

/** ", or press G", for an action's key; nothing, where the player has left it with none. */
function orPress(act: WorksAction): string {
  const key = WORKS_KEYS.name(act);
  return key === null ? "" : `, or press ${key}`;
}

/**
 * The next thing worth saying, or nothing. `finger` words a lesson for taps rather than a mouse;
 * `at` is what the member has before them (a card open, a kind in hand), for the ideas that are
 * taught where they are met.
 */
export function nudge(
  w: Yard,
  taught: ReadonlySet<string>,
  finger: boolean,
  at: Looking = { picked: -1, hand: null },
): Nudge | null {
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

  // The grades, the first time a kind that has two is in hand: said beside the buttons that choose one.
  if (!told("grades") && at.hand !== null && isGraded(at.hand) && highest(w.open, at.hand) > 1)
    return {
      id: "grades",
      text: `Choose the grade to build here${finger ? "" : orPress("grade")}.`,
      x: cx,
      y: cy - 1,
      tool: null,
      lasting: false,
      part: "grades",
    };

  // A machine's numbers, the first time a card is opened once the yard counts.
  const picked = at.picked >= 0 ? (w.kind[at.picked] ?? NONE) : NONE;
  if (!told("numbers") && (isMaker(picked) || picked === GATHERING) && counted(w))
    return {
      id: "numbers",
      text: "Its card says what it makes and needs a minute: count the machines that feed it there.",
      x: at.picked % w.land.w,
      y: Math.floor(at.picked / w.land.w),
      tool: null,
      lasting: false,
    };

  // A way put first, the first time a splitter's card is opened once the yard may put one first: beside its ways.
  if (!told("first") && putsFirst(picked) && locked(w.open, { first: true }) === null)
    return {
      id: "first",
      text: "Press a way until it says First. Items go that way while it can take them; the rest go to the other ways.",
      x: at.picked % w.land.w,
      y: Math.floor(at.picked / w.land.w),
      tool: null,
      lasting: false,
      part: "ways",
    };

  if (w.open.board && !told("board"))
    return {
      id: "board",
      text: "Side orders are unlocked. Each asks for items and pays Coins. Fill one, then hand it over in Orders.",
      x: cx + 1,
      y: cy,
      tool: null,
      lasting: false,
    };

  // The tier's own screen, once there is more than lessons: what is on it is its projects, or from the
  // tier that has none, its commission and the research it waits on. A tier with nothing in it yet has no nudge.
  const inTier = GOALS.filter((g) => g.kind !== "lesson" && g.tier === w.open.tier);
  if (w.open.tier >= 1 && inTier.length > 0 && !told("tier"))
    return {
      id: "tier",
      text: inTier.some((g) => g.kind === "project")
        ? `Open Tier ${w.open.tier} here to take a project: each one unlocks something.`
        : `Open Tier ${w.open.tier} here to see what its commission waits on.`,
      x: cx,
      y: cy - 1,
      tool: null,
      lasting: false,
      part: "tier",
    };

  // The Study, once it may be built and until one stands; then research, until something is studied.
  if (locked(w.open, { build: STUDY }) === null) {
    const folio = FOLIOS.find((f) => locked(w.open, { make: f }) === null);
    if (has(w, STUDY) < 0 && !told("study") && folio !== undefined)
      return {
        id: "study",
        text: `Build a Study and bring it folios: ${recipeSays(folio).replace(/^A /, "a ")}`,
        x: cx,
        y: cy - 1,
        tool: STUDY,
        lasting: true,
        part: "tool",
      };
    const open = ALL_GOALS.some((g) => !isNode(g) && ready(w.open, g));
    if (has(w, STUDY) >= 0 && w.line.length === 0 && open && !told("research"))
      return {
        id: "research",
        text: "Choose here what the Study studies.",
        x: cx,
        y: cy - 1,
        tool: null,
        lasting: true,
        part: "research",
      };
  }

  // Select only once the yard has it.
  const pieces = w.kind.reduce((n, k) => n + (k !== NONE && FIXED[k] !== 1 ? 1 : 0), 0);
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
    // Only a machine of two parts or more can fill up with one while it waits for another.
    const stuck = w.kind.findIndex((k, i) => isMaker(k) && condition(w, i) === STARVED);
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

/**
 * What a lasting lesson said beside the interface asks for, done: it is taken then, and only then.
 * A lesson about a tile needs none, since what it asks for is what stops it being said.
 */
const LEARNT: Readonly<Record<string, (w: Yard) => boolean>> = {
  study: (w) => has(w, STUDYING) >= 0,
  research: (w) => w.line.length > 0,
};

/** Where the lessons stand between steps: the nudge being said and since when, and the lasting lessons said and not yet learnt. */
export interface Lessons {
  readonly said: { readonly id: string; readonly since: number } | null;
  readonly owed: readonly string[];
}
export const NO_LESSONS: Lessons = { said: null, owed: [] };
/** How long a lesson that is not learnt by doing is said, in seconds of the screen's clock, before it counts as taken. */
export const SAID_FOR = 14;

/** One step of the lessons: what is said now, whether it has just begun to be, and the lessons taken in this step. */
export interface LessonStep {
  readonly lessons: Lessons;
  readonly show: Nudge | null;
  readonly fresh: boolean;
  readonly taken: readonly string[];
}

/**
 * Moves the lessons on at a moment of the screen's clock (`t`). A lasting lesson is taken once its
 * own condition is met (`LEARNT`), whether or not it is being said; never because something hid it
 * (`hidden`: the letter about a time away, a visit) or another nudge was said in its place. One that
 * is not learnt by doing is taken once it has been said for `SAID_FOR` seconds.
 */
export function stepLessons(
  was: Lessons,
  w: Yard,
  taught: ReadonlySet<string>,
  at: { readonly t: number; readonly hidden: boolean; readonly finger: boolean; readonly looking: Looking },
): LessonStep {
  const learnt = was.owed.filter((id) => LEARNT[id]?.(w) === true);
  const owed = was.owed.filter((id) => !learnt.includes(id));
  const n = at.hidden
    ? null
    : nudge(w, learnt.length > 0 ? new Set([...taught, ...learnt]) : taught, at.finger, at.looking);
  if (!n) return { lessons: { said: null, owed }, show: null, fresh: false, taken: learnt };
  const fresh = was.said?.id !== n.id;
  const since = fresh || !was.said ? at.t : was.said.since;
  if (!n.lasting && at.t - since > SAID_FOR)
    return { lessons: { said: null, owed }, show: null, fresh: false, taken: [...learnt, n.id] };
  const kept = n.lasting && LEARNT[n.id] !== undefined && !owed.includes(n.id) ? [...owed, n.id] : owed;
  return { lessons: { said: { id: n.id, since }, owed: kept }, show: n, fresh, taken: learnt };
}
