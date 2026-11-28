import { afterEach, describe, expect, test } from "bun:test";

import { type Reply, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";

import { gameContract } from "../../../contracts/game.ts";
import { type Camp, camps, fetchCamps, heldOrder, inOrder, like, named, nextAfter, readCamps } from "./camps.ts";
import { likedLine } from "./news.ts";

const GAME: unknown = gameContract();
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
/** Nobody at any camp. */
const NOBODY: ReadonlyMap<string, number> = new Map();

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
    expect(names(inOrder(ALL, "liked", NOBODY))).toEqual(["Pipwick", "Mossback", "sootpaw", "Wrenly", "Embertoe"]);
    expect(names(inOrder(ALL, "set", NOBODY))).toEqual(["Embertoe", "sootpaw", "Wrenly", "Pipwick", "Mossback"]);
  });

  test("are the most here first, a tie to more likes and then as Leaf lists them", () => {
    const here = new Map([
      ["embertoe", 1],
      ["sootpaw", 3],
      ["wrenly", 1],
    ]);
    expect(names(inOrder(ALL, "here", here))).toEqual(["sootpaw", "Wrenly", "Embertoe", "Mossback", "Pipwick"]);
    expect(names(inOrder(ALL, "here", NOBODY))).toEqual(["Mossback", "Pipwick", "Wrenly", "sootpaw", "Embertoe"]);
  });

  test("hold the order they were put in while somebody reads them, whoever comes and goes; a camp new to the list goes last", () => {
    const opened = inOrder(ALL, "here", new Map([["wrenly", 2]])).map((c) => c.id);
    expect(names(heldOrder(opened, ALL))).toEqual(["Wrenly", "Mossback", "Pipwick", "sootpaw", "Embertoe"]);
    // Three come to Embertoe's and Wrenly's empties while the list is open: the rows stay where they were.
    expect(inOrder(ALL, "here", new Map([["embertoe", 3]]))[0]?.name).toBe("Embertoe");
    expect(names(heldOrder(opened, ALL))).toEqual(["Wrenly", "Mossback", "Pipwick", "sootpaw", "Embertoe"]);
    // Leaf lists a new camp, and no longer lists Mossback's.
    const later = [...ALL.filter((c) => c.id !== "mossback"), camp("Fennel", 9, 9)];
    expect(names(heldOrder(opened, later))).toEqual(["Wrenly", "Pipwick", "sootpaw", "Embertoe", "Fennel"]);
  });

  test("are found by any part of the name, in any case", () => {
    expect(names(named(ALL, " PAW"))).toEqual(["sootpaw"]);
    expect(names(named(ALL, "o"))).toEqual(["Mossback", "sootpaw", "Embertoe"]);
    expect(named(ALL, "  ")).toEqual(ALL);
    expect(named(ALL, "greg")).toEqual([]);
  });

  test("go on to the next in the order chosen, never the member's own, and round from the last to the first", () => {
    // The member is Mossback.
    expect(nextAfter(ALL, "liked", "pipwick", "mossback", NOBODY)?.name).toBe("sootpaw");
    expect(nextAfter(ALL, "liked", "embertoe", "mossback", NOBODY)?.name).toBe("Pipwick");
    expect(nextAfter(ALL, "set", "sootpaw", "mossback", NOBODY)?.name).toBe("Wrenly");
    expect(nextAfter(ALL, "set", "pipwick", "mossback", NOBODY)?.name).toBe("Embertoe");
    expect(nextAfter(ALL, "here", "sootpaw", "mossback", new Map([["sootpaw", 2]]))?.name).toBe("Pipwick");
    // A camp no longer listed goes to the first.
    expect(nextAfter(ALL, "liked", "gone", "mossback", NOBODY)?.name).toBe("Pipwick");
    // Nowhere else to go.
    expect(nextAfter([camp("Wrenly", 0, 0), camp("Mossback", 0, 0)], "liked", "wrenly", "mossback", NOBODY)).toBeNull();
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

  test("keep a like Leaf answered over a list it was asked for before the like, and the list's word on the rest", async () => {
    // A camp the page has not listed yet (opened by its link), liked while the first list is on its way.
    const before = { camps: [{ id: "cy", name: "Cy", guest: true, set_out: 7, likes: 1, liked: false }] };
    const list = Promise.withResolvers<Reply>();
    world = standin({
      "GET /v1/game/camps": () => list.promise,
      "PUT /v1/game/camps/cy/like": { status: 200, body: { likes: 2, liked: true } },
    });
    const listed = fetchCamps();
    await like("cy", true);
    list.resolve({ status: 200, body: before });
    await listed;
    expect(camps()).toEqual([{ id: "cy", name: "Cy", guest: true, setOut: 7, likes: 2, liked: true }]);
    // A list asked for after the like is Leaf's word again.
    world.done();
    world = standin({ "GET /v1/game/camps": { status: 200, body: before } });
    await fetchCamps();
    expect(camps()).toEqual([{ id: "cy", name: "Cy", guest: true, setOut: 7, likes: 1, liked: false }]);
  });

  test("keep a like over a list asked for while the like was on its way, which Leaf may have read before it", async () => {
    const before = { camps: [{ id: "di", name: "Di", guest: false, set_out: 5, likes: 0, liked: false }] };
    world = standin({ "GET /v1/game/camps": { status: 200, body: before } });
    await fetchCamps();
    world.done();
    const put = Promise.withResolvers<Reply>();
    const list = Promise.withResolvers<Reply>();
    world = standin({ "GET /v1/game/camps": () => list.promise, "PUT /v1/game/camps/di/like": () => put.promise });
    const liking = like("di", true);
    const listed = fetchCamps();
    put.resolve({ status: 200, body: { likes: 1, liked: true } });
    await liking;
    list.resolve({ status: 200, body: before });
    await listed;
    expect(camps().find((c) => c.id === "di")).toEqual({
      id: "di",
      name: "Di",
      guest: false,
      setOut: 5,
      likes: 1,
      liked: true,
    });
  });

  test("tell the owner, in a line of the feed, who liked their camp", () => {
    expect(likedLine(event({ id: "x", username: "Mossback" }))).toEqual(["Mossback likes your camp.", "rose"]);
    expect(likedLine(event({ id: "x" }))).toBeNull();
    expect(likedLine(null)).toBeNull();
  });
});
