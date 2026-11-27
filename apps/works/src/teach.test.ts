import { describe, expect, test } from "bun:test";

import {
  ALL_GOALS,
  at,
  BELT,
  BENCH,
  build,
  create,
  DEADFALL,
  deliver,
  FOLIOS,
  GATHERER,
  GOALS,
  highest,
  isNode,
  item,
  type ItemName,
  legPiece,
  litOf,
  MILL,
  NONE,
  PYLON,
  ready,
  recipeSays,
  refusal,
  route,
  SPLITTER,
  stand,
  step,
  STUDY,
  study,
  type Yard,
} from "@sequoia-leaf/factory";
import { near, xy } from "@sequoia-leaf/factory/test/near.ts";

import { NO_LESSONS, nudge, SAID_FOR, stepLessons } from "./teach.ts";

const none = new Set<string>();
const run = (w: Yard, ticks: number): void => {
  for (let k = 0; k < ticks; k++) step(w);
};
/** A new yard with its first lessons filled at the depot, as their deliveries would fill them. */
function past(lessons: number): Yard {
  const w = create({ seed: 3 });
  const wants: [ItemName, number][][] = [
    [["plank", 12]],
    [
      ["ingot", 12],
      ["brick", 12],
    ],
  ];
  for (const lesson of wants.slice(0, lessons)) for (const [name, n] of lesson) deliver(w, item(name), n);
  return w;
}

/** Lays `n` belts on the first clear tiles of a yard. */
const belts = (w: Yard, n: number): void => {
  const free = [...w.kind.keys()].flatMap((i) => {
    const [x, y] = [i % w.land.w, Math.floor(i / w.land.w)];
    return w.kind[i] === NONE && refusal(w, BELT, x, y, 999) === null ? [{ x, y }] : [];
  });
  for (const t of free.slice(0, n)) build(w, BELT, t.x, t.y, 0, 999);
};

describe("teaching", () => {
  test("a new yard is shown its first line a piece at a time, each where it goes", () => {
    const w = create();
    const first = nudge(w, none, false);
    expect(first?.id).toBe("gatherer");
    expect(first?.tool).toBe(GATHERER);
    // On deadfall, on the yard's own land, where the depot's power reaches.
    const i = at(w, first?.x ?? -1, first?.y ?? -1);
    expect(w.land.deposit[i]).toBe(DEADFALL);
    expect(litOf(w)[i]).toBe(1);

    build(w, GATHERER, first?.x ?? 0, first?.y ?? 0, 0, 0);
    const second = nudge(w, none, false);
    expect(second?.id).toBe("mill");
    expect([second?.x, second?.y]).toEqual([(first?.x ?? 0) + 1, first?.y]);

    build(w, MILL, second?.x ?? 0, second?.y ?? 0, 0, 0);
    const third = nudge(w, none, false);
    expect(third?.id).toBe("belt");
    expect(third?.tool).toBe(BELT);
    expect(third?.text).toContain("Drag");
    expect(nudge(w, none, true)?.text).toContain("Tap here");
    expect([third?.x, third?.y]).toEqual([(first?.x ?? 0) + 2, first?.y]);

    const legs = route(w, [third?.x ?? 0, third?.y ?? 0], w.land.depot);
    if (!legs) throw new Error("no way to the depot");
    expect(stand(w, legs.map(legPiece), 0).ok).toBe(true);
    // Until a plank has arrived the belt lesson has nothing more to point at, and says nothing.
    expect(nudge(w, none, false)).toBeNull();
    run(w, 120);
    const fourth = nudge(w, none, false);
    expect(fourth?.id).toBe("planks");
    expect(fourth?.lasting).toBe(false);
    expect(nudge(w, new Set(["planks"]), false)).toBeNull();
  });

  test("the second lesson points a pylon towards the ore, and the third a bench near the depot", () => {
    const w = past(1);
    const pylon = nudge(w, none, false);
    expect(pylon?.id).toBe("pylon");
    expect(pylon?.tool).toBe(PYLON);
    // Where it points, a pylon would carry power to ore.
    build(w, PYLON, pylon?.x ?? 0, pylon?.y ?? 0, 0, 99);
    const lit = litOf(w);
    expect(w.land.deposit.some((d, i) => d === item("ore") && lit[i] === 1)).toBe(true);
    expect(nudge(w, none, false)).toBeNull();

    const later = past(2);
    const bench = nudge(later, none, false);
    expect(bench?.id).toBe("bench");
    expect(litOf(later)[at(later, bench?.x ?? -1, bench?.y ?? -1)]).toBe(1);
    expect(nudge(later, new Set(["bench"]), false)).toBeNull();
  });

  test("later it speaks up once for the board, for a shortage of power, and for a machine that has jammed", () => {
    const w = create({ seed: 4, tier: 1 });
    expect(nudge(w, none, false)?.id).toBe("board");
    const taught = new Set(["board", "tier"]);
    expect(nudge(w, taught, false)).toBeNull();
    // Six benches beside the depot draw more than it gives.
    for (let k = 0; k < 6; k++) build(w, BENCH, ...xy(-3, -4 + k), 0, 999);
    expect(nudge(w, taught, false)?.id).toBe("short");
    taught.add("short");
    // Planks sawn straight into the second bench, and nothing else: it fills with planks.
    build(w, GATHERER, ...xy(-5, -3), 0, 999);
    build(w, MILL, ...xy(-4, -3), 0, 999);
    run(w, 600);
    const stuck = nudge(w, taught, false);
    expect(stuck?.id).toBe("starved");
    expect([stuck?.x, stuck?.y]).toEqual(xy(-3, -3));
    taught.add("starved");
    expect(nudge(w, taught, false)).toBeNull();
    deliver(w, item("plank"), 1);
    expect(nudge(w, taught, false)).toBeNull();
  });

  test("once the yard passes 60 pieces it says, once, what Select is for, but not before it has Select", () => {
    const taught = new Set(["board", "tier", "study"]);
    const early = create({ seed: 5, tier: 1 });
    belts(early, 61);
    expect(nudge(early, taught, false)).toBeNull();

    const w = create({ seed: 5, tier: 3 });
    belts(w, 60);
    expect(nudge(w, taught, false)).toBeNull();
    belts(w, 1);
    expect(nudge(w, taught, false)).toMatchObject({ id: "select", tool: "select", lasting: false });
    expect(nudge(w, new Set([...taught, "select"]), false)).toBeNull();
  });
});

describe("teaching each new idea, once, where it is met", () => {
  /** A yard of a tier with nothing of the first tiers left to say. */
  const quiet = new Set(["board", "select", "short", "starved"]);

  test("nothing new is said in tier 0; when tier 1 opens, where the tier's screen is, beside its button, after the board", () => {
    expect(nudge(past(2), new Set(["bench"]), false, { picked: -1, hand: BELT })).toBeNull();
    const w = create({ seed: 4, tier: 1 });
    expect(nudge(w, none, false)?.id).toBe("board");
    expect(nudge(w, quiet, false)).toMatchObject({ id: "tier", part: "tier", lasting: false });
    expect(nudge(w, new Set([...quiet, "tier"]), false)).toBeNull();
    // A card open on a machine and a kind in hand say nothing more while every recipe is one of each and there is one grade.
    build(w, BENCH, ...xy(-3, -4), 0, 999);
    expect(nudge(w, new Set([...quiet, "tier"]), false, { picked: at(w, ...xy(-3, -4)), hand: BELT })).toBeNull();
  });

  test("a tier with research alone, no project and no commission yet, has no nudge to its screen", () => {
    const w = create({ seed: 4, tier: 5 });
    expect(GOALS.some((g) => g.tier === 5 && g.kind === "research")).toBe(true);
    // Tier 5 has research alone so far; once it has a project or its commission, the nudge is back.
    const onScreen = GOALS.some((g) => g.tier === 5 && (g.kind === "project" || g.kind === "commission"));
    expect(nudge(w, new Set([...quiet, "study", "research", "first"]), false)?.id === "tier").toBe(onScreen);
  });

  test("a machine's numbers, the first time a card is open on one once the yard counts: over that machine", () => {
    const told = new Set([...quiet, "tier"]);
    const w = create({ seed: 4, tier: 2 });
    build(w, BENCH, ...xy(-3, -4), 0, 999);
    expect(nudge(w, told, false)).toBeNull();
    expect(nudge(w, told, false, { picked: at(w, ...xy(-3, -4)), hand: null })).toMatchObject({
      id: "numbers",
      ...near(-3, -4),
    });
    // Not for a card on anything that makes nothing, and not twice.
    build(w, BELT, ...xy(-2, -4), 0, 999);
    expect(nudge(w, told, false, { picked: at(w, ...xy(-2, -4)), hand: null })).toBeNull();
    expect(nudge(w, new Set([...told, "numbers"]), false, { picked: at(w, ...xy(-3, -4)), hand: null })).toBeNull();
  });

  test("a way put first, the first time a splitter's card is open once the yard may put one first: over that splitter", () => {
    const told = new Set([...quiet, "tier", "study", "research", "numbers"]);
    const early = create({ seed: 4, tier: 4 });
    build(early, SPLITTER, ...xy(-3, -4), 0, 999);
    expect(nudge(early, told, false, { picked: at(early, ...xy(-3, -4)), hand: null })).toBeNull();
    const w = create({ seed: 4, tier: 5 });
    build(w, SPLITTER, ...xy(-3, -4), 0, 999);
    expect(nudge(w, told, false)).toBeNull();
    expect(nudge(w, told, false, { picked: at(w, ...xy(-3, -4)), hand: null })).toMatchObject({
      id: "first",
      ...near(-3, -4),
      part: "ways",
    });
    expect(nudge(w, new Set([...told, "first"]), false, { picked: at(w, ...xy(-3, -4)), hand: null })).toBeNull();
  });

  test("the grades, the first time a kind that has two is in hand: beside the buttons that choose one, with the key for a mouse", () => {
    const told = new Set([...quiet, "tier", "study"]);
    const w = create({ seed: 4, tier: 3 });
    expect([highest(w.open, BELT), highest(w.open, MILL)]).toEqual([2, 1]);
    expect(nudge(w, told, false, { picked: -1, hand: MILL })).toBeNull();
    const said = nudge(w, told, false, { picked: -1, hand: BELT });
    expect(said).toMatchObject({ id: "grades", part: "grades", lasting: false });
    expect(said?.text).toContain("G");
    expect(nudge(w, told, true, { picked: -1, hand: BELT })?.text).not.toContain("press G");
    expect(nudge(w, new Set([...told, "grades"]), false, { picked: -1, hand: BELT })).toBeNull();
  });

  test("the Study, from when it may be built until one stands, beside its tool; then research, until something is studied", () => {
    const told = new Set([...quiet, "tier"]);
    expect(nudge(create({ seed: 4, tier: 2 }), told, false)).toBeNull();
    const w = create({ seed: 4, tier: 3 });
    const folio = FOLIOS[0];
    if (folio === undefined) throw new Error("no folio");
    const first = nudge(w, told, false);
    expect(first).toMatchObject({ id: "study", tool: STUDY, part: "tool", lasting: true });
    // It says how the folio is made, in the rules' own sentence for the recipe.
    expect(first?.text).toContain(recipeSays(folio).slice(2));
    expect(build(w, STUDY, ...xy(-3, -4), 0, Infinity).ok).toBe(true);
    expect(nudge(w, told, false)).toMatchObject({ id: "research", part: "research", lasting: true });
    const research = ALL_GOALS.find((g) => !isNode(g) && ready(w.open, g));
    if (research === undefined) throw new Error("no research may be studied");
    expect(study(w, research)).toBe(true);
    expect(nudge(w, told, false)).toBeNull();
  });
});

describe("lessons, step by step", () => {
  const quiet = new Set(["board", "select", "short", "starved", "tier"]);
  const looking = { picked: -1, hand: null };
  const when = (t: number, more: Partial<Parameters<typeof stepLessons>[3]> = {}) => ({
    t,
    hidden: false,
    finger: false,
    looking,
    ...more,
  });

  test("a lasting lesson is not taken while the letter about a time away hides it, and is said again after", () => {
    const w = create({ seed: 4, tier: 3 });
    let lessons = NO_LESSONS;
    const first = stepLessons(lessons, w, quiet, when(0));
    expect(first.show?.id).toBe("study");
    lessons = first.lessons;
    const hidden = stepLessons(lessons, w, quiet, when(1, { hidden: true }));
    expect([hidden.show, hidden.taken]).toEqual([null, []]);
    lessons = hidden.lessons;
    const back = stepLessons(lessons, w, quiet, when(2));
    expect([back.show?.id, back.taken]).toEqual(["study", []]);
  });

  test("a lasting lesson is not taken when another nudge is said in its place", () => {
    const w = create({ seed: 4, tier: 3 });
    let lessons = stepLessons(NO_LESSONS, w, quiet, when(0)).lessons;
    const grades = stepLessons(lessons, w, quiet, when(1, { looking: { picked: -1, hand: BELT } }));
    expect([grades.show?.id, grades.taken]).toEqual(["grades", []]);
    lessons = grades.lessons;
    expect(stepLessons(lessons, w, new Set([...quiet, "grades"]), when(2)).show?.id).toBe("study");
  });

  test("a lasting lesson is taken once what it asks for is done, whether or not it is being said then", () => {
    const w = create({ seed: 4, tier: 3 });
    let lessons = stepLessons(NO_LESSONS, w, quiet, when(0)).lessons;
    lessons = stepLessons(lessons, w, quiet, when(1, { hidden: true })).lessons;
    expect(build(w, STUDY, ...xy(-3, -4), 0, Infinity).ok).toBe(true);
    const built = stepLessons(lessons, w, quiet, when(2, { hidden: true }));
    expect(built.taken).toEqual(["study"]);
    // Taken, it is not said again even with no Study standing.
    expect(
      stepLessons(built.lessons, create({ seed: 4, tier: 3 }), new Set([...quiet, "study"]), when(3)).show,
    ).toBeNull();
  });

  test("a lesson not learnt by doing is said for a while and then taken", () => {
    const w = create({ seed: 4, tier: 1 });
    const told = new Set(["select", "short", "starved"]);
    let now = stepLessons(NO_LESSONS, w, told, when(0));
    expect([now.show?.id, now.fresh]).toEqual(["board", true]);
    now = stepLessons(now.lessons, w, told, when(SAID_FOR));
    expect([now.show?.id, now.fresh, now.taken]).toEqual(["board", false, []]);
    now = stepLessons(now.lessons, w, told, when(SAID_FOR + 0.5));
    expect([now.show, now.taken]).toEqual([null, ["board"]]);
  });
});
