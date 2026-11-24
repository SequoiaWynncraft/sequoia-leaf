import { afterEach, describe, expect, test } from "bun:test";

import { type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { type Camp, camps, fetchCamps, inOrder, like, named, nextAfter, readCamps } from "./camps.ts";
import { likedLine } from "./news.ts";

const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
const answered = (key: string): unknown => (isObject(GAME) && isObject(GAME[key]) ? GAME[key]["body"] : undefined);
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const camp = (name: string, likes: number, setOut: number): Camp => ({
  id: name.toLowerCase(),
  name,
  guest: false,
  setOut,
  likes,
  liked: false,
});
const ALL = [
  camp("Wrenly", 2, 10),
  camp("Mossback", 4, 3),
  camp("sootpaw", 2, 10),
  camp("Embertoe", 0, 31),
  camp("Pipwick", 4, 9),
];
const names = (list: readonly Camp[]): string[] => list.map((c) => c.name);

/** A like of the member's camp as their stream sends it (`eventJsonText`): the event, its details in `data`. */
const event = (by: unknown) => ({ id: 9, type: "camp_liked", created_at: "x", data: { by } });

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

describe("the signpost's camps", () => {
  test("are read as Leaf lists them", () => {
    expect(readCamps(answered("GET /v1/game/camps"))).toEqual([
      { id: "10000000-0000-0000-0000-000000000001", name: "Alice", guest: false, setOut: 10, likes: 1, liked: false },
      { id: "10000000-0000-0000-0000-000000000002", name: "Bob", guest: false, setOut: 0, likes: 1, liked: true },
      { id: "10000000-0000-0000-0000-000000000003", name: "Visitor", guest: true, setOut: 0, likes: 0, liked: false },
    ]);
    expect(readCamps({ top: [] })).toBeNull();
  });

  test("are the most liked first, a tie to more set out and then by name; or the most set out first", () => {
    expect(names(inOrder(ALL, "liked"))).toEqual(["Pipwick", "Mossback", "sootpaw", "Wrenly", "Embertoe"]);
    expect(names(inOrder(ALL, "set"))).toEqual(["Embertoe", "sootpaw", "Wrenly", "Pipwick", "Mossback"]);
  });

  test("are found by any part of the name, in any case", () => {
    expect(names(named(ALL, " PAW"))).toEqual(["sootpaw"]);
    expect(names(named(ALL, "o"))).toEqual(["Mossback", "sootpaw", "Embertoe"]);
    expect(named(ALL, "  ")).toEqual(ALL);
    expect(named(ALL, "greg")).toEqual([]);
  });

  test("go on to the next in the order chosen, never the member's own, and round from the last to the first", () => {
    // The member is Mossback.
    expect(nextAfter(ALL, "liked", "pipwick", "mossback")?.name).toBe("sootpaw");
    expect(nextAfter(ALL, "liked", "embertoe", "mossback")?.name).toBe("Pipwick");
    expect(nextAfter(ALL, "set", "sootpaw", "mossback")?.name).toBe("Wrenly");
    expect(nextAfter(ALL, "set", "pipwick", "mossback")?.name).toBe("Embertoe");
    // A camp no longer listed goes to the first.
    expect(nextAfter(ALL, "liked", "gone", "mossback")?.name).toBe("Pipwick");
    // Nowhere else to go.
    expect(nextAfter([camp("Wrenly", 0, 0), camp("Mossback", 0, 0)], "liked", "wrenly", "mossback")).toBeNull();
  });

  test("hold Leaf's answer to a like, and say what Leaf said when it refuses", async () => {
    world = standin({
      "GET /v1/game/camps": {
        status: 200,
        body: { camps: [{ id: "bo", name: "Bo", guest: false, set_out: 3, likes: 1, liked: false }] },
      },
      "PUT /v1/game/camps/bo/like": { status: 200, body: { likes: 2, liked: true } },
      "PUT /v1/game/camps/me/like": { status: 409, body: { code: "own_camp", message: "That is your own camp" } },
    });
    await fetchCamps();
    expect(await like("bo", true)).toEqual({ id: "bo", name: "Bo", guest: false, setOut: 3, likes: 2, liked: true });
    expect(camps()).toEqual([{ id: "bo", name: "Bo", guest: false, setOut: 3, likes: 2, liked: true }]);
    expect(await like("me", true)).toBe("That is your own camp");
  });

  test("tell the owner, in a line of the feed, who liked their camp", () => {
    expect(likedLine(event({ id: "x", username: "Mossback" }))).toEqual(["Mossback likes your camp.", "rose"]);
    expect(likedLine(event({ id: "x" }))).toBeNull();
    expect(likedLine(null)).toBeNull();
  });
});
