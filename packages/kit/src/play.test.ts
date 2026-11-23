import { afterEach, describe, expect, jest, test } from "bun:test";

import { isRecord } from "./net.ts";
import {
  type Answer,
  type Answered,
  NOT_YET,
  openPlay,
  type Play,
  type PlayReader,
  STILL_HERE,
  waitingLook,
} from "./play.ts";
import { type Reply, type Route, type Sent, type Standin, standin } from "./standin.ts";

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

/** The counter answered short: a batch's answer is only the number Leaf has, as `{ sum }`. */
interface Sum {
  sum: number;
}
const SHORT: PlayReader<Count, string, Sum> = {
  ...COUNTER,
  short: (v) => (isRecord(v) && typeof v.sum === "number" ? { sum: v.sum } : null),
};

/** A stand-in Leaf for the counter: it adds what it is asked to, refusing anything over 100; `short`, it answers a batch short. */
function counterLeaf(start = 0, short = false) {
  const leaf = {
    n: start,
    rev: 0,
    seen: new Map<string, unknown>(),
    batches: [] as unknown[][],
    /** The batches that came in a request that outlives its page. */
    away: [] as unknown[][],
  };
  const post = (sent: Sent): Reply => {
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    (sent.keepalive ? leaf.away : leaf.batches).push(commands);
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
    const state = short ? { sum: leaf.n } : { n: leaf.n };
    return { status: 200, body: { rev: leaf.rev, now: "2026-11-25T12:00:00.000Z", results, state } };
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

async function opened(routes: Record<string, Route>): Promise<Play<Count, Add, string>> {
  world = standin(routes);
  const play = await openPlay<Count, Add, string>("raid", COUNTER, {
    player: "p",
    retry: { first: 1, most: 4 },
    notYet: { every: 1, tries: 3 },
  });
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
    const play = await openPlay(
      "raid",
      {
        view: (v) => (isRecord(v) && "almanac" in v ? v : null),
        notes: () => [],
      },
      { player: "p" },
    );
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
    const troubles = await Promise.all(cases.map(() => openPlay("raid", COUNTER, { player: "p" })));
    expect(troubles).toEqual(cases.map(([, trouble]) => ({ trouble })));
  });

  test("a state Leaf cannot read itself is said so, and the page does not load again", async () => {
    world = standin({ "GET /v1/game/play/raid": { status: 409, body: { code: "state_unreadable", message: "Kept" } } });
    expect(await openPlay("raid", COUNTER, { player: "p" })).toEqual({ trouble: "unreadable" });
    expect(world.reloaded.count).toBe(0);
    expect(world.sent).toHaveLength(1);
  });

  test("a Leaf without the play service yet (a deploy half done) is asked again each second, for 30 seconds", async () => {
    expect(NOT_YET).toEqual({ every: 1000, tries: 30 });
    const notYet = { status: 404, body: { code: "not_found", message: "No such route" } };
    const { routes } = counterLeaf(4);
    let old = 2;
    world = standin({
      "GET /v1/game/play/raid": () => (old-- > 0 ? notYet : routes["GET /v1/game/play/raid"]()),
    });
    const play = await openPlay<Count, Add, string>("raid", COUNTER, { player: "p", notYet: { every: 1, tries: 3 } });
    expect("trouble" in play ? play.trouble : play.state).toEqual({ n: 4 });
    expect(world.sent).toHaveLength(3);
    world.done();
    world = standin({ "GET /v1/game/play/raid": notYet });
    expect(await openPlay("raid", COUNTER, { player: "p", notYet: { every: 1, tries: 3 } })).toEqual({
      trouble: "noserver",
    });
    expect(world.sent).toHaveLength(4);
  });

  test("loads the page again when Leaf's state will not read: its rules are newer than the page's", async () => {
    world = standin({ "GET /v1/game/play/raid": { status: 200, body: { rev: 3, now: "x", state: { v: 9 } } } });
    expect(await openPlay("raid", COUNTER, { player: "p" })).toEqual({ trouble: "closed" });
    expect(world.reloaded.count).toBe(1);
  });
});

describe("visiting somebody's game", () => {
  const BOB = "10000000-0000-0000-0000-000000000002";
  const OF = `/v1/game/play/works/of/${BOB}`;
  const yard: PlayReader<unknown, never> = { view: (v) => (isRecord(v) && "yard" in v ? v : null), notes: () => null };

  test("reads what Leaf really answers a visitor, sends nothing, refuses every command, and reads it again on refresh", async () => {
    const shown = contract("GET /v1/game/play/{game}/of/{player}");
    world = standin({ [`GET ${OF}`]: { status: 200, body: shown } });
    const play = await openPlay<unknown, Add, never>("works", yard, { player: "p", of: BOB });
    if ("trouble" in play) throw new Error(play.trouble);
    expect(play.state).toEqual(Object(Object(shown).state));
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "visiting" });
    expect(play.waiting()).toBe(false);
    play.flush();
    world.wake();
    await play.refresh();
    expect(world.sent.map((s) => `${s.method} ${s.path}`)).toEqual([`GET ${OF}`, `GET ${OF}`]);
  });

  test("says when there is nothing of theirs to visit", async () => {
    world = standin({
      [`GET ${OF}`]: { status: 404, body: contract("GET /v1/game/play/{game}/of/{player}, nothing to visit") },
    });
    expect(await openPlay("works", yard, { player: "p", of: BOB })).toEqual({ trouble: "nothing" });
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

  test("as the page goes, everything Leaf has not answered is sent at once, in order, and done once", async () => {
    const { routes, leaf } = counterLeaf();
    const play = await opened(routes);
    const answers = [1, 2, 3].map((by) => play.send({ do: "add", by }));
    // The first is on its way and two wait behind it: all three go in the one request that outlives the page.
    play.flush();
    await Promise.all(answers);
    expect(leaf.away.map((b) => b.map((c) => (isRecord(c) ? c.by : null)))).toEqual([[1, 2, 3]]);
    const sent = leaf.batches.flat().map((c) => (isRecord(c) ? c.id : null));
    expect(leaf.away.flat().map((c) => (isRecord(c) ? c.id : null))).toEqual(sent);
    expect(leaf.n).toBe(6);
    // With nothing waiting, the state is read instead, so that Leaf hears the page until it goes;
    // and read again as the page comes back.
    play.flush();
    await Bun.sleep(2);
    expect(leaf.away).toHaveLength(1);
    expect(world?.sent.at(-1)).toMatchObject({ method: "GET", path: "/v1/game/play/raid", keepalive: true });
    leaf.n = 40;
    world?.wake();
    await Bun.sleep(2);
    expect(world?.sent.at(-1)).toMatchObject({ method: "GET", path: "/v1/game/play/raid", keepalive: false });
    expect(play.state).toEqual({ n: 40 });
  });

  test("a few long commands go in more than one request, and a body Leaf will not read is not sent for ever", async () => {
    const { routes, leaf } = counterLeaf();
    const play = await opened(routes);
    // Each of these is about 5,000 characters: the first goes alone, and only two more fit a request.
    const long = { do: "add" as const, by: 1, pad: "x".repeat(5000) };
    await Promise.all([1, 2, 3, 4].map(() => play.send(long)));
    expect(leaf.batches.map((b) => b.length)).toEqual([1, 2, 1]);
    expect(leaf.n).toBe(4);
    // A body too large all the same: the command is answered as refused, and the next one goes.
    world?.done();
    world = standin({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 413, body: { code: "body_too_large" } }),
    });
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "invalid_command" });
    world.done();
    world = standin(routes);
    expect(await play.send({ do: "add", by: 2 })).toEqual({ notes: ["added 2"] });
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

  test("a refresh asked before a command, answered after it, does not take the page back", async () => {
    const { routes, leaf } = counterLeaf(5);
    const slow: { arrive?: () => void } = {};
    let reads = 0;
    const play = await opened({
      ...routes,
      // After the first, Leaf reads the state at once, but its answer is slow to arrive.
      "GET /v1/game/play/raid": () => {
        if (reads++ === 0) return routes["GET /v1/game/play/raid"]();
        const body = new TextEncoder().encode(JSON.stringify({ rev: leaf.rev, now: "x", state: { n: leaf.n } }));
        const stream = new ReadableStream({
          start(c) {
            slow.arrive = (): void => {
              c.enqueue(body);
              c.close();
            };
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    const refreshed = play.refresh();
    await Bun.sleep(1);
    await play.send({ do: "add", by: 2 });
    expect(play.state).toEqual({ n: 7 });
    slow.arrive?.();
    await refreshed;
    expect(play.state).toEqual({ n: 7 });
  });

  test("asking for the state again asks once at a time, and lets go of an answer from before a batch answered since", async () => {
    const { routes, leaf } = counterLeaf(0);
    // Once open, Leaf answers a question for the state only when the test says, with the state as it was asked.
    const held: (() => void)[] = [];
    let hold = false;
    const play = await opened({
      ...routes,
      "GET /v1/game/play/raid": () => {
        const reply = { status: 200, body: { rev: leaf.rev, now: "x", state: { n: leaf.n } } };
        return hold ? new Promise<Reply>((answer) => held.push(() => answer(reply))) : reply;
      },
    });
    hold = true;
    const first = play.refresh();
    const again = play.refresh();
    expect(await play.send({ do: "add", by: 5 }, add(5))).toEqual({ notes: ["added 5"] });
    expect(world?.sent.filter((s) => s.method === "GET")).toHaveLength(2);
    for (const answer of held) answer();
    await Promise.all([first, again]);
    expect([play.state, play.rev]).toEqual([{ n: 5 }, 1]);
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

  test("a state Leaf cannot read stops the page at once: nothing is sent again, and the page is told", async () => {
    const { routes } = counterLeaf(0);
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 409, body: { code: "state_unreadable", message: "Kept" } }),
    });
    const troubles: string[] = [];
    play.onTrouble((why) => troubles.push(why));
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "unreadable" });
    await Bun.sleep(10);
    expect(troubles).toEqual(["unreadable"]);
    expect(world?.sent.filter((s) => s.method === "POST")).toHaveLength(1);
    expect(world?.reloaded.count).toBe(0);
  });

  test("a batch that reaches a Leaf without the play service yet goes again in a moment, until it has given up for no server", async () => {
    const { leaf, routes } = counterLeaf(0);
    let old = 2;
    const notYet = { status: 404, body: { code: "not_found", message: "No such route" } };
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": (sent) => (old-- > 0 ? notYet : routes["POST /v1/game/play/raid"](sent)),
    });
    expect(await play.send({ do: "add", by: 2 })).toEqual({ notes: ["added 2"] });
    expect(leaf.n).toBe(2);
    old = 99;
    const troubles: string[] = [];
    play.onTrouble((why) => troubles.push(why));
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "noserver" });
    expect(troubles).toEqual(["noserver"]);
    // The first try and three more.
    expect(world?.sent.filter((s) => s.method === "POST")).toHaveLength(3 + 4);
  });

  test("asking for the state again when signed out tells the page so", async () => {
    const { routes } = counterLeaf();
    const play = await opened(routes);
    const told: string[] = [];
    play.onTrouble((why) => told.push(why));
    world?.done();
    world = standin({ "GET /v1/game/play/raid": () => ({ status: 401, body: { code: "unauthorized" } }) });
    await play.refresh();
    expect(told).toEqual(["signedout"]);
  });

  test("say who the page believes the member is, with every batch", async () => {
    const { leaf, routes } = counterLeaf(0);
    const play = await opened(routes);
    void play.send({ do: "add", by: 1 });
    void play.send({ do: "add", by: 2 });
    await settled(play);
    const posts = world?.sent.filter((s) => s.method === "POST") ?? [];
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((s) => isRecord(s.body) && s.body.player === "p")).toBe(true);
    expect(leaf.n).toBe(3);
  });

  test("signed in as somebody else since the page opened: nothing more is sent, and the page loads again", async () => {
    const { routes } = counterLeaf(0);
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 409, body: { code: "not_you", message: "Load it again" } }),
    });
    const a = play.send({ do: "add", by: 1 });
    const b = play.send({ do: "add", by: 1 });
    expect(await a).toEqual({ refused: "not_you" });
    expect(await b).toEqual({ refused: "not_you" });
    expect(world?.reloaded.count).toBe(1);
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "closed" });
    expect(world?.sent.filter((s) => s.method === "POST")).toHaveLength(1);
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

/** The counter, answered short, opened on a stand-in Leaf. */
async function shortly(routes: Record<string, Route>): Promise<Play<Count, Add, string, Sum>> {
  world = standin(routes);
  const play = await openPlay<Count, Add, string, Sum>("raid", SHORT, { player: "p", retry: { first: 1, most: 4 } });
  if ("trouble" in play) throw new Error(play.trouble);
  return play;
}

describe("a game answered short", () => {
  test("keeps the state as Leaf last gave it, and the page hears each batch's answer before anything more is sent", async () => {
    const { routes, leaf } = counterLeaf(10, true);
    const play = await shortly(routes);
    const heard: Answered<Add, string, Sum>[] = [];
    const sentBy: number[] = [];
    const states: Count[] = [];
    play.onState((state) => states.push(state));
    play.onAnswer((answered) => {
      heard.push(answered);
      sentBy.push(leaf.batches.length);
    });
    const one = play.send({ do: "add", by: 2 });
    const two = play.send({ do: "add", by: 200 });
    expect(await one).toEqual({ notes: ["added 2"] });
    expect(await two).toEqual({ refused: "too_much" });
    expect(heard).toEqual([
      { done: [{ command: { do: "add", by: 2 }, answer: { notes: ["added 2"] } }], short: { sum: 12 } },
      { done: [{ command: { do: "add", by: 200 }, answer: { refused: "too_much" } }], short: { sum: 12 } },
    ]);
    expect(sentBy).toEqual([1, 2]);
    expect([play.state, play.rev, states]).toEqual([{ n: 10 }, 1, []]);
  });

  test("reads the state when asked, with the tick a page found its copy not Leaf's", async () => {
    const { routes } = counterLeaf(0, true);
    const play = await shortly(routes);
    await play.send({ do: "add", by: 3 });
    expect(play.state).toEqual({ n: 0 });
    await play.refresh(1234);
    expect(play.state).toEqual({ n: 3 });
    expect(world?.sent.at(-1)?.path).toBe("/v1/game/play/raid?differs=1234");
    await play.refresh();
    expect(world?.sent.at(-1)?.path).toBe("/v1/game/play/raid");
  });

  test("a batch Leaf will not read, or answers with the state (a Leaf older than the page), is heard with no answer of Leaf's, and the state stays", async () => {
    const { routes } = counterLeaf(5);
    let readable = false;
    const play = await shortly({
      ...routes,
      "POST /v1/game/play/raid": (sent) =>
        readable ? routes["POST /v1/game/play/raid"](sent) : { status: 400, body: { code: "invalid_command" } },
    });
    const heard: Answered<Add, string, Sum>[] = [];
    const states: Count[] = [];
    play.onAnswer((answered) => heard.push(answered));
    play.onState((state) => states.push(state));
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "invalid_command" });
    readable = true;
    expect(await play.send({ do: "add", by: 2 })).toEqual({ notes: ["added 2"] });
    expect(heard).toEqual([
      { done: [{ command: { do: "add", by: 1 }, answer: { refused: "invalid_command" } }], short: undefined },
      { done: [{ command: { do: "add", by: 2 }, answer: { notes: ["added 2"] } }], short: undefined },
    ]);
    expect([play.state, states]).toEqual([{ n: 5 }, []]);
  });
});

describe("a page in view", () => {
  test("a read answered after a command sent meanwhile does not undo what the command showed", async () => {
    const { routes } = counterLeaf();
    const held: { read: ReadableStreamDefaultController<Uint8Array> | null } = { read: null };
    let reads = 0;
    const w = standin({
      ...routes,
      // The first read opens the page; the second is held until the test lets it go.
      "GET /v1/game/play/raid": () => {
        if (reads++ === 0) return routes["GET /v1/game/play/raid"]();
        const body = new ReadableStream<Uint8Array>({ start: (c) => void (held.read = c) });
        return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    world = w;
    const play = await openPlay<Count, Add, string>("raid", COUNTER, { player: "p" });
    if ("trouble" in play) throw new Error("not opened");
    w.wake();
    await Bun.sleep(1);
    await play.send({ do: "add", by: 3 });
    expect(play.state).toEqual({ n: 3 });
    if (!held.read) throw new Error("no read was held");
    const old = { rev: 0, now: "2026-11-25T12:00:00.000Z", state: { n: 0 } };
    held.read.enqueue(new TextEncoder().encode(JSON.stringify(old)));
    held.read.close();
    await Bun.sleep(1);
    expect(play.state).toEqual({ n: 3 });
  });

  test("reads its state after a minute without a call to Leaf, and not while hidden, put aside, or in a visit", async () => {
    jest.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const win = Object.assign(new EventTarget(), {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    });
    Object.defineProperty(globalThis, "window", { value: win, configurable: true });
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      const { routes } = counterLeaf();
      const w = standin({
        ...routes,
        "GET /v1/game/play/raid/of/bob": { status: 200, body: { rev: 0, state: { n: 1 } } },
      });
      world = w;
      let away = false;
      const play = await openPlay<Count, Add, string>("raid", COUNTER, { player: "p", away: () => away });
      const visit = await openPlay<Count, Add, string>("raid", COUNTER, { player: "p", of: "bob" });
      if ("trouble" in play || "trouble" in visit) throw new Error("not opened");
      const reads = (): number => w.sent.filter((s) => s.method === "GET").length;
      /** Whatever was set going settles. */
      const flushed = async (n = 10): Promise<void> => {
        if (n === 0) return;
        await Promise.resolve();
        await flushed(n - 1);
      };
      /** `n` quarters of a minute go by. */
      const ticks = async (n: number): Promise<void> => {
        if (n === 0) return;
        w.clock.now += STILL_HERE / 4;
        jest.advanceTimersByTime(STILL_HERE / 4);
        await flushed();
        await ticks(n - 1);
      };
      const before = reads();
      await ticks(3);
      expect(reads()).toBe(before);
      await ticks(1);
      expect(reads()).toBe(before + 1);
      // A command is a call: the minute counts from it.
      await ticks(1);
      await play.send({ do: "add", by: 1 });
      await ticks(3);
      expect(reads()).toBe(before + 1);
      await ticks(1);
      expect(reads()).toBe(before + 2);
      doc.hidden = true;
      await ticks(8);
      doc.hidden = false;
      away = true;
      await ticks(8);
      expect(reads()).toBe(before + 2);
      away = false;
      await ticks(1);
      expect(reads()).toBe(before + 3);
      expect(w.sent.filter((s) => s.path.endsWith("/of/bob"))).toHaveLength(1);
    } finally {
      jest.useRealTimers();
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "document");
    }
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
