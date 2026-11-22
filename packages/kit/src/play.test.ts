import { afterEach, describe, expect, test } from "bun:test";

import { isRecord } from "./net.ts";
import { type Answer, openPlay, type Play, type PlayReader, waitingLook } from "./play.ts";
import { type Reply, type Sent, type Standin, standin } from "./standin.ts";

/** What Leaf's game routes really answer, from the contract its own tests write. */
const GAME: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
const contract = (name: string): unknown => {
  const exchange = isRecord(GAME) ? GAME[name] : null;
  return isRecord(exchange) ? exchange.body : null;
};

/** A counter, as a game: its view is a number, a command adds to it, and its notes say what was added. */
interface Count {
  n: number;
}
type Add = { do: "add"; by: number };
const COUNTER: PlayReader<Count, string> = {
  view: (v) => (isRecord(v) && typeof v.n === "number" ? { n: v.n } : null),
  notes: (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null),
};
const add =
  (by: number) =>
  (copy: Count): Count => ({ n: copy.n + by });

/** A stand-in Leaf for the counter: it adds what it is asked to, refusing anything over 100. */
function counterLeaf(start = 0) {
  const leaf = { n: start, rev: 0, seen: new Map<string, unknown>(), batches: [] as unknown[][] };
  const post = (sent: Sent): Reply => {
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    leaf.batches.push(commands);
    let changed = false;
    const results = commands.map((c: unknown) => {
      if (!isRecord(c) || typeof c.id !== "string" || typeof c.by !== "number") return { id: "?", refused: "bad" };
      const before = leaf.seen.get(c.id);
      if (before) return before;
      const result = c.by > 100 ? { id: c.id, refused: "too_much" } : { id: c.id, notes: [`added ${c.by}`] };
      if (c.by <= 100) {
        leaf.n += c.by;
        changed = true;
      }
      leaf.seen.set(c.id, result);
      return result;
    });
    if (changed) leaf.rev += 1;
    return { status: 200, body: { rev: leaf.rev, now: "2026-11-25T12:00:00.000Z", results, state: { n: leaf.n } } };
  };
  return {
    leaf,
    routes: {
      "GET /v1/game/play/raid": () => ({ status: 200, body: { rev: leaf.rev, now: "x", state: { n: leaf.n } } }),
      "POST /v1/game/play/raid": post,
    } satisfies Record<string, (sent: Sent) => Reply>,
  };
}

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
});

async function opened(routes: Record<string, (sent: Sent) => Reply>): Promise<Play<Count, Add, string>> {
  world = standin(routes);
  const play = await openPlay<Count, Add, string>("raid", COUNTER, { retry: { first: 1, most: 4 } });
  if ("trouble" in play) throw new Error(play.trouble);
  return play;
}
/** Waits until nothing is waiting for Leaf, a millisecond at a time. */
async function settled(play: Play<Count, Add, string>, tries = 200): Promise<void> {
  if (tries === 0 || !play.waiting()) return;
  await Bun.sleep(1);
  await settled(play, tries - 1);
}

describe("opening a game on Leaf", () => {
  test("reads what Leaf really answers for a new table", async () => {
    const shown = contract("GET /v1/game/play/{game}");
    world = standin({ "GET /v1/game/play/raid": { status: 200, body: shown } });
    const play = await openPlay("raid", {
      view: (v) => (isRecord(v) && "almanac" in v ? v : null),
      notes: () => [],
    });
    if ("trouble" in play) throw new Error(play.trouble);
    expect(play.rev).toBe(0);
    expect(play.state).toEqual(Object(Object(shown).state));
    expect(world.sent.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /v1/game/play/raid"]);
  });

  test("says why it cannot: signed out, or Leaf not answering or having trouble", async () => {
    const cases = [
      [{ status: 401, body: { code: "unauthorized" } }, "signedout"],
      ["offline", "closed"],
      [{ status: 503, body: { code: "identity_unavailable" } }, "closed"],
      [{ status: 404, body: { code: "no_such_game" } }, "closed"],
    ] as const;
    let answered = 0;
    world = standin({ "GET /v1/game/play/raid": () => cases[answered++]?.[0] ?? "offline" });
    // Asked one after another, each is answered in turn.
    const troubles = await Promise.all(cases.map(() => openPlay("raid", COUNTER)));
    expect(troubles).toEqual(cases.map(([, trouble]) => ({ trouble })));
  });

  test("loads the page again when Leaf's state will not read: its rules are newer than the page's", async () => {
    world = standin({ "GET /v1/game/play/raid": { status: 200, body: { rev: 3, now: "x", state: { v: 9 } } } });
    expect(await openPlay("raid", COUNTER)).toEqual({ trouble: "closed" });
    expect(world.reloaded.count).toBe(1);
  });
});

describe("sending commands", () => {
  test("returns at once, shows a prediction at once, and takes Leaf's state when it answers", async () => {
    const { routes, leaf } = counterLeaf(5);
    const play = await opened(routes);
    const heard: [Count, boolean][] = [];
    play.onState((state, differs) => heard.push([state, differs]));
    const answer = play.send({ do: "add", by: 2 }, add(2));
    expect(play.state).toEqual({ n: 7 });
    expect(play.waiting()).toBe(true);
    expect(await answer).toEqual({ notes: ["added 2"] });
    expect(play.state).toEqual({ n: 7 });
    expect(play.rev).toBe(1);
    expect(heard).toEqual([[{ n: 7 }, false]]);
    expect(leaf.n).toBe(7);
  });

  test("go in order, one request at a time, as many as are waiting in each, each with an id of its own", async () => {
    const { routes, leaf } = counterLeaf();
    const play = await opened(routes);
    const answers = [1, 2, 3, 4].map((by) => play.send({ do: "add", by }));
    await Promise.all(answers);
    expect(leaf.batches.map((b) => b.length)).toEqual([1, 3]);
    const ids = leaf.batches.flat().map((c) => (isRecord(c) ? c.id : null));
    expect(new Set(ids).size).toBe(4);
    expect(leaf.batches.flat().map((c) => (isRecord(c) ? c.by : null))).toEqual([1, 2, 3, 4]);
    expect(play.state).toEqual({ n: 10 });
  });

  test("are sent again with the same ids after a network failure or trouble, and done once", async () => {
    const { routes, leaf } = counterLeaf();
    let failures = 2;
    const flaky = {
      ...routes,
      "POST /v1/game/play/raid": (sent: Sent): Reply => {
        // The first time Leaf does the work but the answer is lost; then it is having trouble.
        if (failures === 2) {
          failures -= 1;
          routes["POST /v1/game/play/raid"](sent);
          return "offline";
        }
        if (failures === 1) {
          failures -= 1;
          return { status: 503, body: { code: "internal_error" } };
        }
        return routes["POST /v1/game/play/raid"](sent);
      },
    };
    const play = await opened(flaky);
    expect(await play.send({ do: "add", by: 3 }, add(3))).toEqual({ notes: ["added 3"] });
    expect(leaf.n).toBe(3);
    const sentIds = world?.sent
      .filter((s) => s.method === "POST")
      .map((s) =>
        isRecord(s.body) && Array.isArray(s.body.commands) && isRecord(s.body.commands[0])
          ? s.body.commands[0].id
          : null,
      );
    expect(sentIds?.length).toBe(3);
    expect(new Set(sentIds).size).toBe(1);
    expect(play.state).toEqual({ n: 3 });
  });

  test("a refused command is answered with its code, and Leaf's state shows the page where it guessed wrong", async () => {
    const { routes } = counterLeaf(1);
    const play = await opened(routes);
    const heard: boolean[] = [];
    play.onState((_, differs) => heard.push(differs));
    const answer: Answer<string> = await play.send({ do: "add", by: 500 }, add(500));
    expect(answer).toEqual({ refused: "too_much" });
    expect(play.state).toEqual({ n: 1 });
    expect(heard).toEqual([true]);
  });

  test("whatever the page did to its copy, Leaf's next answer puts back", async () => {
    const { routes } = counterLeaf(10);
    const play = await opened(routes);
    const heard: [Count, boolean][] = [];
    play.onState((state, differs) => heard.push([{ ...state }, differs]));
    // Somebody edits the number in the page's memory.
    play.state.n = 9999;
    await play.send({ do: "add", by: 1 });
    expect(play.state).toEqual({ n: 11 });
    expect(heard).toEqual([[{ n: 11 }, true]]);
  });

  test("another page's commands show on this one's next answer", async () => {
    const { routes, leaf } = counterLeaf(0);
    const play = await opened(routes);
    leaf.n = 40;
    leaf.rev = 7;
    const heard: boolean[] = [];
    play.onState((_, differs) => heard.push(differs));
    await play.send({ do: "add", by: 2 }, add(2));
    expect(play.state).toEqual({ n: 42 });
    expect(heard).toEqual([true]);
    await play.refresh();
    expect(play.state).toEqual({ n: 42 });
  });

  test("a prediction still waiting is worked out again on top of Leaf's newer state", async () => {
    const { routes, leaf } = counterLeaf(0);
    const play = await opened(routes);
    // Another page has added 100 meanwhile.
    leaf.n = 100;
    const first = play.send({ do: "add", by: 1 }, add(1));
    const second = play.send({ do: "add", by: 10 }, add(10));
    expect(play.state).toEqual({ n: 11 });
    await first;
    // Leaf's state (101), with the second worked out on top whether or not Leaf has answered it yet.
    expect(play.state).toEqual({ n: 111 });
    await second;
    expect(play.state).toEqual({ n: 111 });
  });

  test("signed out on the way: everything waiting is answered so, and the page is told", async () => {
    const { routes } = counterLeaf(0);
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 401, body: { code: "unauthorized" } }),
    });
    const troubles: string[] = [];
    play.onTrouble((why) => troubles.push(why));
    const a = play.send({ do: "add", by: 1 });
    const b = play.send({ do: "add", by: 1 });
    expect(await a).toEqual({ refused: "signedout" });
    expect(await b).toEqual({ refused: "signedout" });
    expect(troubles).toEqual(["signedout"]);
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "closed" });
  });

  test("commands Leaf will not read are answered invalid_command, and those after them still go", async () => {
    const { routes } = counterLeaf(0);
    let once = true;
    const picky = {
      ...routes,
      "POST /v1/game/play/raid": (sent: Sent): Reply => {
        if (once) {
          once = false;
          return { status: 400, body: { code: "invalid_command" } };
        }
        return routes["POST /v1/game/play/raid"](sent);
      },
    };
    const play = await opened(picky);
    const bad = play.send({ do: "add", by: 1 }, add(1));
    const good = play.send({ do: "add", by: 2 }, add(2));
    expect(await bad).toEqual({ refused: "invalid_command" });
    expect(await good).toEqual({ notes: ["added 2"] });
    expect(play.state).toEqual({ n: 2 });
  });

  test("an answer from rules newer than the page's loads the page again", async () => {
    const { routes } = counterLeaf(0);
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 200, body: { rev: 1, now: "x", results: [], state: { v: 2 } } }),
    });
    void play.send({ do: "add", by: 1 });
    await settled(play);
    await Bun.sleep(5);
    expect(world?.reloaded.count).toBe(1);
  });
});

describe("the waiting look", () => {
  test("shows only once Leaf takes more than a moment, and goes when the answer comes", async () => {
    const classes = new Set<string>();
    const element = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } };
    const { promise: slow, resolve: answer } = Promise.withResolvers<string>();
    void waitingLook(element, slow, 5);
    expect(classes.has("k-wait")).toBe(false);
    await Bun.sleep(15);
    expect(classes.has("k-wait")).toBe(true);
    answer("done");
    await slow;
    await Bun.sleep(0);
    expect(classes.has("k-wait")).toBe(false);
    // An answer quicker than the moment never shows it.
    await waitingLook(element, Promise.resolve(1), 5);
    await Bun.sleep(15);
    expect(classes.has("k-wait")).toBe(false);
  });
});
