import { describe, expect, test } from "bun:test";

import { liking } from "./likes.ts";

const at = (was: Parameters<typeof liking>[0]["was"], on: boolean, now: number) =>
  liking({ liker: "ann", owner: "bo", hasCamp: true, was, on, now });

describe("a like of a camp", () => {
  test("is kept from the first time it is given, and only that time tells the owner", () => {
    const first = at(null, true, 10);
    expect(first).toEqual({ kept: { first: 10, at: 10, liked: true }, tell: true });
    const back = at({ first: 10, at: 10, liked: true }, false, 20);
    expect(back).toEqual({ kept: { first: 10, at: 10, liked: false }, tell: false });
    const again = at({ first: 10, at: 10, liked: false }, true, 30);
    expect(again).toEqual({ kept: { first: 10, at: 30, liked: true }, tell: false });
  });

  test("given when it stands, or taken back when it does not, changes nothing", () => {
    const standing = { first: 10, at: 10, liked: true };
    expect(at(standing, true, 40)).toEqual({ kept: standing, tell: false });
    const takenBack = { first: 10, at: 10, liked: false };
    expect(at(takenBack, false, 40)).toEqual({ kept: takenBack, tell: false });
    expect(at(null, false, 40)).toEqual({ kept: null, tell: false });
  });

  test("is refused for one's own camp, and for somebody with no camp", () => {
    expect(liking({ liker: "bo", owner: "bo", hasCamp: true, was: null, on: true, now: 1 })).toEqual({
      refused: "own_camp",
    });
    expect(liking({ liker: "ann", owner: "cy", hasCamp: false, was: null, on: true, now: 1 })).toEqual({
      refused: "no_camp",
    });
  });
});
