import { describe, expect, test } from "bun:test";

import {
  AWAKE,
  CLOSE_IN,
  type Cue,
  darkOf,
  DAYBREAK,
  inGame,
  LEAD,
  mayAct,
  next,
  NIGHTFALL,
  openOf,
  type Place,
  placeOf,
  type Screen,
} from "./screen.ts";

type To = { readonly place: Place; readonly of?: string };
type S = Screen<To, string>;

const DOOR = { x: 373, y: 104 };
const town: S = { at: "playing", place: "town" };
const camp: S = { at: "playing", place: "camp" };
const tick = (dt: number, near = false): Cue<To, string> => ({ kind: "tick", dt, near });
const walk = (place: Place, of?: string): Cue<To, string> => ({ kind: "walk", to: of ? { place, of } : { place } });
const door: Cue<To, string> = { kind: "door", game: "works", door: DOOR, visit: "frame" };
const back: Cue<To, string> = { kind: "back" };

/** The state after `secs` of ticks a thirtieth of a second each. */
function wait(s: S, secs: number, near = false): S {
  let at = s;
  for (let i = 0; i < Math.round(secs * 30); i++) at = next(at, tick(1 / 30, near));
  return at;
}

/** Every kind of state there is, each part-way through. */
const EVERY: readonly S[] = [
  town,
  camp,
  { at: "playing", place: "grove" },
  { at: "dusk", from: "town", to: { place: "camp" }, lead: 0.4, dark: 0 },
  { at: "dusk", from: "camp", to: { place: "town" }, lead: 0, dark: 0.5 },
  { at: "dawn", place: "camp", dark: 0.9 },
  { at: "dawn", place: "camp", dark: 0.2 },
  { at: "closing", place: "town", game: "works", door: DOOR, visit: "frame", open: 0.4 },
  { at: "inside", place: "town", game: "works", door: DOOR, visit: "frame" },
  { at: "opening", place: "town", game: "works", door: DOOR, open: 0.3, onward: null },
];

describe("walking from one place to another", () => {
  test("the member walks off for a while, night falls, the next place is put on in the dark, and night lifts", () => {
    const off = next(town, walk("camp"));
    expect(off).toEqual({ at: "dusk", from: "town", to: { place: "camp" }, lead: LEAD, dark: 0 });
    expect(placeOf(off)).toBe("town");
    expect(mayAct(off)).toBe(false);
    // Walking, before night begins: it stays light.
    const walking = wait(off, LEAD / 2);
    expect(walking.at).toBe("dusk");
    expect(darkOf(walking)).toBe(0);
    // Then night falls, still on the town.
    const falling = wait(walking, LEAD / 2 + NIGHTFALL / 2);
    expect(placeOf(falling)).toBe("town");
    expect(darkOf(falling)).toBeGreaterThan(0.3);
    // At its darkest the camp is on.
    const there = wait(falling, NIGHTFALL);
    expect(there.at).toBe("dawn");
    expect(placeOf(there)).toBe("camp");
    expect(mayAct(there)).toBe(false);
    // And it lifts.
    const home = wait(there, DAYBREAK + 0.1);
    expect(home).toEqual(camp);
  });

  test("night begins at once when the member is nearly out of sight, without walking the rest of the while", () => {
    const off = next(town, walk("camp"));
    const near = next(off, tick(1 / 30, true));
    expect(near).toMatchObject({ at: "dusk", lead: 0, dark: 0 });
    expect(darkOf(next(near, tick(0.1)))).toBeCloseTo(0.1 / NIGHTFALL);
  });

  test("the member may act again once night has lifted far enough, before it is quite gone", () => {
    const there: S = { at: "dawn", place: "camp", dark: 1 };
    expect(mayAct(wait(there, DAYBREAK * (1 - AWAKE) - 0.05))).toBe(false);
    const soon = wait(there, DAYBREAK * (1 - AWAKE) + 0.05);
    expect(soon.at).toBe("dawn");
    expect(mayAct(soon)).toBe(true);
  });

  // Bug A: the walk back asked in the last quarter second of arriving was refused, and the page
  // stayed with the member walking off and nothing ever falling. Whenever the member may act, a
  // walk off is taken.
  test("a walk off asked while night lifts turns into night falling from where it has got to", () => {
    const lifting: S = { at: "dawn", place: "camp", dark: 0.2 };
    expect(mayAct(lifting)).toBe(true);
    const turned = next(lifting, walk("town"));
    expect(turned).toEqual({ at: "dusk", from: "camp", to: { place: "town" }, lead: 0, dark: 0.2 });
    // Darkest a fifth sooner than from a lit place: it had a fifth of the way to go back.
    expect(wait(turned, NIGHTFALL * 0.8 - 0.05).at).toBe("dusk");
    expect(wait(turned, NIGHTFALL * 0.8 + 0.02)).toMatchObject({ at: "dawn", place: "town" });
  });

  test("a walk off asked whenever the member may act is always taken, from every state", () => {
    for (const s of EVERY.filter(mayAct)) {
      const to = placeOf(s) === "town" ? "camp" : "town";
      expect(next(s, walk(to)).at).toBe("dusk");
    }
  });

  test("a walk off asked while one is under way, or while a game is open or being gone into, changes nothing", () => {
    for (const s of EVERY.filter((e) => e.at === "dusk" || e.at === "closing" || e.at === "inside"))
      expect(next(s, walk("grove"))).toBe(s);
  });

  test("nobody walks off from a place to itself; from one camp to another, yes", () => {
    expect(next(town, walk("town"))).toBe(town);
    expect(next({ at: "playing", place: "grove" }, walk("grove")).at).toBe("playing");
    expect(next(camp, walk("camp", "someone"))).toMatchObject({ at: "dusk", from: "camp", to: { of: "someone" } });
  });
});

describe("through a game's door and back", () => {
  test("the view closes in on the door, the game is open, it is put away, and the view opens out", () => {
    const closing = next(town, door);
    expect(closing).toEqual({ at: "closing", place: "town", game: "works", door: DOOR, visit: "frame", open: 1 });
    expect(inGame(closing)).toBe(true);
    expect(mayAct(closing)).toBe(false);
    const inside = wait(closing, CLOSE_IN + 0.05);
    expect(inside).toEqual({ at: "inside", place: "town", game: "works", door: DOOR, visit: "frame" });
    expect(openOf(inside)).toBe(0);
    // Time passing inside changes nothing: the game has the page.
    expect(next(inside, tick(5))).toBe(inside);
    const opening = next(inside, back);
    expect(opening).toMatchObject({ at: "opening", open: 0, onward: null });
    expect(inGame(opening)).toBe(false);
    expect(wait(opening, CLOSE_IN + 0.05)).toEqual(town);
  });

  test("a game put away before the view has quite closed opens out from where it had got to", () => {
    const closing = wait(next(town, door), CLOSE_IN / 2);
    const opening = next(closing, back);
    expect(opening.at).toBe("opening");
    expect(openOf(opening)).toBeCloseTo(openOf(closing));
  });

  test("a door is gone through only while the member may act", () => {
    for (const s of EVERY) {
      const after = next(s, door);
      if (mayAct(s)) expect(after.at).toBe("closing");
      else expect(after).toBe(s);
    }
  });

  test("going into a game while night lifts leaves the night behind", () => {
    const after = next({ at: "dawn", place: "town", dark: 0.1 }, door);
    expect(after.at).toBe("closing");
    expect(darkOf(after)).toBe(0);
  });

  // Bug B's first half: "Visit camp" from inside a game is asked as the view opens out. The walk
  // waits until it is open, and then the member sets off from the door.
  test("a walk asked while the view opens out sets off once it is open", () => {
    const opening = next({ at: "inside", place: "town", game: "works", door: DOOR, visit: "frame" }, back);
    const asked = next(opening, walk("camp", "someone"));
    expect(asked).toMatchObject({ at: "opening", onward: { place: "camp", of: "someone" } });
    expect(wait(asked, CLOSE_IN / 2).at).toBe("opening");
    expect(wait(asked, CLOSE_IN + 0.02)).toMatchObject({
      at: "dusk",
      from: "town",
      to: { place: "camp", of: "someone" },
      dark: 0,
    });
  });

  test("a second walk asked while one waits for the view to open changes nothing: every walk taken is walked", () => {
    const opening = next({ at: "inside", place: "town", game: "works", door: DOOR, visit: "frame" }, back);
    const asked = next(opening, walk("camp", "someone"));
    expect(next(asked, walk("grove"))).toBe(asked);
  });

  test("being put away means nothing where no game is open", () => {
    for (const s of EVERY.filter((e) => e.at !== "closing" && e.at !== "inside")) expect(next(s, back)).toBe(s);
  });
});

test("no time passing changes nothing", () => {
  for (const s of EVERY) expect(next(s, tick(0))).toBe(s);
});
