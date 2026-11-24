import { afterEach, describe, expect, jest, test } from "bun:test";

import { isRecord } from "./net.ts";
import {
  type Answer,
  type Answered,
  type Line,
  type LineEvent,
  NOT_YET,
  openPlay,
  type Play,
  type PlayReader,
  stepLine,
  STILL_HERE,
  waitingLook,
} from "./play.ts";
import { balance, forgetLedger } from "./purse.ts";
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
  forgetLedger();
});

async function opened(routes: Record<string, Route>): Promise<Play<Count, Add, string>> {
  world = standin(routes);
  const play = await openPlay<Count, Add, string>("raid", COUNTER, {
    player: "p",
    retry: { first: 1, most: 4, jitter: 0 },
    notYet: { every: 1, tries: 3 },
  });
  if ("trouble" in play) throw new Error(play.trouble);
  return play;
}
/** An answer that never comes. */
const never = (): Promise<Reply> => new Promise<Reply>(() => undefined);

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

  test("a state Leaf still cannot read once waited for, each second for 30 seconds, is said so, and the page does not load again", async () => {
    expect(NOT_YET).toEqual({ every: 1000, tries: 30 });
    world = standin({ "GET /v1/game/play/raid": { status: 409, body: { code: "state_unreadable", message: "Kept" } } });
    expect(await openPlay("raid", COUNTER, { player: "p", notYet: { every: 1, tries: 3 } })).toEqual({
      trouble: "unreadable",
    });
    expect(world.reloaded.count).toBe(0);
    expect(world.sent).toHaveLength(4);
  });

  test("loads the page again when Leaf's state will not read: its rules are newer than the page's", async () => {
    world = standin({ "GET /v1/game/play/raid": { status: 200, body: { rev: 3, now: "x", state: { v: 9 } } } });
    expect(await openPlay("raid", COUNTER, { player: "p" })).toEqual({ trouble: "closed" });
    expect(world.reloaded.count).toBe(1);
  });
});

/** Leaf's counter, playing by rules of another version than this page's. */
const otherRules = (rev = 0) => ({ rev, now: "x", state: { n: 1 }, rules: "00000000000000" });

describe("rules other than Leaf's", () => {
  test("a page opened by rules other than Leaf's loads again, once for each version of Leaf's, rather than play by its own", async () => {
    world = standin({ "GET /v1/game/play/raid": { status: 200, body: otherRules() } });
    expect(await openPlay("raid", COUNTER, { player: "p" })).toEqual({ trouble: "closed" });
    expect(world.reloaded.count).toBe(1);
    // Loaded again, and still Leaf's rules are not the page's (a deploy half done): it says so, and does not go round.
    expect(await openPlay("raid", COUNTER, { player: "p" })).toEqual({ trouble: "closed" });
    expect(world.reloaded.count).toBe(1);
    // Long after, it may load again.
    world.clock.now += 60_000;
    expect(await openPlay("raid", COUNTER, { player: "p" })).toEqual({ trouble: "closed" });
    expect(world.reloaded.count).toBe(2);
  });

  test("an answer by rules other than the page's, as Leaf's change under an open page, loads it again: nothing is shown done by the old rules", async () => {
    const { routes } = counterLeaf(0);
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 200, body: { ...otherRules(1), results: [] } }),
    });
    const heard: Count[] = [];
    play.onState((state) => heard.push(state));
    expect(await play.send({ do: "add", by: 1 }, add(1))).toEqual({ refused: "outdated" });
    expect([world?.reloaded.count, heard]).toEqual([1, []]);
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
    // With nothing waiting, nothing is sent; and the state is read again as the page comes back.
    const before = world?.sent.length;
    play.flush();
    await Bun.sleep(2);
    expect(leaf.away).toHaveLength(1);
    expect(world?.sent.length).toBe(before);
    leaf.n = 40;
    world?.wake();
    await Bun.sleep(2);
    expect(world?.sent.at(-1)).toMatchObject({ method: "GET", path: "/v1/game/play/raid", keepalive: false });
    expect(play.state).toEqual({ n: 40 });
  });

  test("a flush that does not reach Leaf is not the page failing, and what it held is still sent if the page stays", async () => {
    const { routes, leaf } = counterLeaf();
    let away = 0;
    const post = routes["POST /v1/game/play/raid"];
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": (sent) => (sent.keepalive ? (away++, "offline") : post(sent)),
    });
    const unhandled: unknown[] = [];
    const hear = (why: unknown): void => void unhandled.push(why);
    process.on("unhandledRejection", hear);
    try {
      const answers = [1, 2].map((by) => play.send({ do: "add", by }));
      play.flush();
      expect(await Promise.all(answers)).toEqual([{ notes: ["added 1"] }, { notes: ["added 2"] }]);
      await Bun.sleep(2);
      expect([away, unhandled, leaf.n]).toEqual([1, [], 3]);
    } finally {
      process.off("unhandledRejection", hear);
    }
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
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "signedout" });
  });

  test("a state Leaf still cannot read once waited for stops the page: nothing is sent after, and the page is told", async () => {
    const { routes } = counterLeaf(0);
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": () => ({ status: 409, body: { code: "state_unreadable", message: "Kept" } }),
    });
    const troubles: string[] = [];
    play.onTrouble((why) => troubles.push(why));
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "unreadable" });
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "unreadable" });
    await Bun.sleep(10);
    expect(troubles).toEqual(["unreadable"]);
    // The first try and three more.
    expect(world?.sent.filter((s) => s.method === "POST")).toHaveLength(1 + 3);
    expect(world?.reloaded.count).toBe(0);
  });

  test("a state the other Leaf cannot read during a deploy is asked for again: opened, read again and sent to without trouble, each command with one id", async () => {
    const { routes, leaf } = counterLeaf(4);
    const kept = { status: 409, body: { code: "state_unreadable", message: "Kept" } };
    // Two of every three requests reach the old Leaf, which cannot read the state the new one wrote.
    let asked = 0;
    const old = (): boolean => asked++ % 3 < 2;
    const play = await opened({
      "GET /v1/game/play/raid": () => (old() ? kept : routes["GET /v1/game/play/raid"]()),
      "POST /v1/game/play/raid": (sent) => (old() ? kept : routes["POST /v1/game/play/raid"](sent)),
    });
    const troubles: string[] = [];
    play.onTrouble((why) => troubles.push(why));
    expect(play.state).toEqual({ n: 4 });
    leaf.n = 9;
    await play.refresh();
    expect(play.state).toEqual({ n: 9 });
    const answers = Promise.all([play.send({ do: "add", by: 2 }, add(2)), play.send({ do: "add", by: 3 }, add(3))]);
    expect(play.state).toEqual({ n: 14 });
    expect(await answers).toEqual([{ notes: ["added 2"] }, { notes: ["added 3"] }]);
    expect([play.state, leaf.n, troubles]).toEqual([{ n: 14 }, 14, []]);
    // Each question and each batch three times, a batch with the same ids each time.
    const sent = (world?.sent ?? []).map((s) =>
      isRecord(s.body) && Array.isArray(s.body.commands)
        ? s.body.commands.map((c) => (isRecord(c) ? c.id : null)).join()
        : s.method,
    );
    const [a = "", b = ""] = [sent[6], sent[9]];
    expect(sent).toEqual(["GET", "GET", "GET", "GET", "GET", "GET", a, a, a, b, b, b]);
    expect(a).not.toEqual(b);
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

  test("asking for the state again ends the page for what ends it at the opening, once waited for, and asks nothing after", async () => {
    // A state that does not read is asked for four times, as at the opening.
    const ends = [
      [{ status: 409, body: { code: "state_unreadable", message: "Kept" } }, "unreadable", 4],
      [{ status: 404, body: { code: "nothing_to_visit", message: "None" } }, "nothing", 1],
    ] as const;
    for (const [reply, why, asked] of ends) {
      const { routes } = counterLeaf();
      // oxlint-disable-next-line no-await-in-loop -- one page after another
      const play = await opened(routes);
      const told: string[] = [];
      play.onTrouble((trouble) => told.push(trouble));
      world?.done();
      world = standin({ "GET /v1/game/play/raid": reply });
      // oxlint-disable-next-line no-await-in-loop -- one page after another
      await play.refresh();
      // oxlint-disable-next-line no-await-in-loop -- one page after another
      await play.refresh();
      expect([why, told, world.sent.length]).toEqual([why, [why], asked]);
    }
  });

  test("a request that never settles is let go at its deadline: a batch goes again with the same ids, and a read can be asked again", async () => {
    const { routes, leaf } = counterLeaf();
    let hang = true;
    world = standin(
      {
        "GET /v1/game/play/raid": () => (hang ? never() : routes["GET /v1/game/play/raid"]()),
        "POST /v1/game/play/raid": (sent) => (hang ? never() : routes["POST /v1/game/play/raid"](sent)),
      },
      { deadline: 20 },
    );
    hang = false;
    const play = await openPlay<Count, Add, string>("raid", COUNTER, {
      player: "p",
      retry: { first: 1, most: 4, jitter: 0 },
    });
    if ("trouble" in play) throw new Error(play.trouble);
    hang = true;
    const answer = play.send({ do: "add", by: 3 });
    await Bun.sleep(1);
    hang = false;
    expect(await answer).toEqual({ notes: ["added 3"] });
    const ids = world.sent
      .filter((s) => s.method === "POST")
      .map((s) =>
        isRecord(s.body) && Array.isArray(s.body.commands)
          ? s.body.commands.map((c) => (isRecord(c) ? c.id : null))
          : [],
      );
    expect([ids.length, ids[1]]).toEqual([2, ids[0]]);
    expect(leaf.n).toBe(3);
    // A read that never settles is let go too, and the next is asked.
    hang = true;
    const reads = world.sent.length;
    await play.refresh();
    hang = false;
    await play.refresh();
    expect([world.sent.length - reads, play.state]).toEqual([2, { n: 3 }]);
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
    expect(await play.send({ do: "add", by: 1 })).toEqual({ refused: "not_you" });
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
  const play = await openPlay<Count, Add, string, Sum>("raid", SHORT, {
    player: "p",
    retry: { first: 1, most: 4, jitter: 0 },
  });
  if ("trouble" in play) throw new Error(play.trouble);
  return play;
}

/** A command as a line holds it, for the line's own tests. */
type P = { readonly id: string; readonly size: number };
const p = (id: string, size = 10): P => ({ id, size });
const sending = (batch: P[], queue: P[] = [], tries = 0): Line<P> => ({ at: "sending", batch, queue, tries });
const waiting = (batch: P[], queue: P[] = [], tries = 1): Line<P> => ({ at: "waiting", batch, queue, tries });

describe("where a play's line is", () => {
  const done = Promise.resolve();
  const [a, b, c] = [p("a"), p("b"), p("c")];
  const many = Array.from({ length: 40 }, (_, i) => p(`q${i}`));

  test.each<[string, Line<P>, LineEvent<P>, Line<P>]>([
    ["a command sent from idle goes at once", { at: "idle" }, { do: "send", p: a }, sending([a])],
    [
      "a command sent while reading goes at once, and the read is let go",
      { at: "reading", done },
      { do: "send", p: a },
      sending([a]),
    ],
    ["a command sent while one is on its way waits behind it", sending([a]), { do: "send", p: b }, sending([a], [b])],
    [
      "a command sent while a batch waits to go again waits behind it",
      waiting([a], [], 2),
      { do: "send", p: b },
      waiting([a], [b], 2),
    ],
    ["a batch answered makes way for those queued", sending([a], [b, c]), { do: "answered" }, sending([b, c])],
    [
      "as many as one request holds",
      sending([a], many),
      { do: "answered" },
      sending(many.slice(0, 32), many.slice(32)),
    ],
    [
      "a long one goes alone",
      sending([a], [p("long", 11_995), b]),
      { do: "answered" },
      sending([p("long", 11_995)], [b]),
    ],
    ["the last batch answered: idle", sending([a]), { do: "answered" }, { at: "idle" }],
    ["a batch that failed waits", sending([a], [b]), { do: "failed" }, waiting([a], [b], 1)],
    ["its wait over, it goes again", waiting([a], [], 1), { do: "again" }, sending([a], [], 1)],
    ["a read goes from idle", { at: "idle" }, { do: "read", done }, { at: "reading", done }],
    ["no read while a batch is on its way", sending([a]), { do: "read", done }, sending([a])],
    ["the read come: idle", { at: "reading", done }, { do: "answered" }, { at: "idle" }],
    ["a stop, from anywhere", sending([a], [b]), { do: "stop", why: "signedout" }, { at: "stopped", why: "signedout" }],
    [
      "nothing moves a stopped line",
      { at: "stopped", why: "put_away" },
      { do: "send", p: a },
      { at: "stopped", why: "put_away" },
    ],
  ])("%s", (_name, from, event, to) => {
    expect(stepLine(from, event)).toEqual(to);
  });
});

describe("the purse", () => {
  test("takes Leaf's word from the opening and each answer; a command's own Coins show at once, and go as Leaf answers it", async () => {
    let coins = 100;
    let version = 1;
    const purse = () => ({ coins, leaf: 5, version });
    const play = await opened({
      "GET /v1/game/play/raid": () => ({ status: 200, body: { rev: 0, now: "x", state: { n: 0 }, purse: purse() } }),
      "POST /v1/game/play/raid": (sent) => {
        const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
        const results = commands.map((c) => ({ id: isRecord(c) ? c.id : "?", notes: [] }));
        coins -= 30 * commands.length;
        version++;
        return { status: 200, body: { rev: 1, now: "x", results, state: { n: 0 }, purse: purse() } };
      },
    });
    expect(balance()).toEqual({ coins: 100, leaf: 5 });
    const first = play.send({ do: "add", by: 1 }, undefined, -30);
    const second = play.send({ do: "add", by: 2 }, undefined, -30);
    expect(balance().coins).toBe(40);
    await first;
    expect(balance().coins).toBe(40);
    await second;
    expect([balance().coins, coins]).toEqual([40, 40]);
  });
});

describe("a page going", () => {
  test("sends everything Leaf has not answered in one request, in order with its ids, however many are queued", async () => {
    const { routes, leaf } = counterLeaf();
    // The first batch never comes back: everything after it waits behind it.
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": (sent) => (sent.keepalive ? routes["POST /v1/game/play/raid"](sent) : never()),
    });
    for (let by = 1; by <= 40; by++) void play.send({ do: "add", by });
    play.flush();
    await Bun.sleep(2);
    const flying = world?.sent.find((s) => !s.keepalive && s.method === "POST");
    const first = isRecord(flying?.body) && Array.isArray(flying.body.commands) ? flying.body.commands : [];
    expect(leaf.away.map((b) => b.length)).toEqual([40]);
    expect(leaf.away.flat().map((c) => (isRecord(c) ? c.by : null))).toEqual(
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
    expect(leaf.away[0]?.[0]).toEqual(first[0]);
    expect(leaf.n).toBe(820);
  });

  test("put away, a play sends what is queued, hears the page no more, and does nothing after", async () => {
    const { routes, leaf } = counterLeaf();
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": (sent) => (sent.keepalive ? routes["POST /v1/game/play/raid"](sent) : never()),
    });
    const w = world;
    if (!w) throw new Error("no world");
    expect(w.hearing()).toBe(2);
    const a = play.send({ do: "add", by: 1 });
    const b = play.send({ do: "add", by: 2 });
    play.close();
    expect([await a, await b]).toEqual([{ refused: "put_away" }, { refused: "put_away" }]);
    expect(leaf.away.flat().map((c) => (isRecord(c) ? c.by : null))).toEqual([1, 2]);
    expect(w.hearing()).toBe(0);
    const asked = w.sent.length;
    w.wake();
    w.leave();
    play.flush();
    await play.refresh();
    expect(await play.send({ do: "add", by: 3 })).toEqual({ refused: "put_away" });
    await Bun.sleep(2);
    expect([w.sent.length, play.waiting()]).toEqual([asked, false]);
  });

  test("as the page is hidden or put away, or the town closes the game, what is waiting is sent", async () => {
    const { routes, leaf } = counterLeaf();
    const play = await opened({
      ...routes,
      "POST /v1/game/play/raid": (sent) => (sent.keepalive ? routes["POST /v1/game/play/raid"](sent) : never()),
    });
    void play.send({ do: "add", by: 4 });
    world?.leave();
    await Bun.sleep(2);
    expect(leaf.away.flat().map((c) => (isRecord(c) ? c.by : null))).toEqual([4]);
  });
});

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

  test("is not read as the page comes back: its page asks for its own reads", async () => {
    const { routes } = counterLeaf(0, true);
    await shortly(routes);
    world?.wake();
    await Bun.sleep(2);
    expect(world?.sent.map((s) => s.method)).toEqual(["GET"]);
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
