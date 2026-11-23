import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { type Reply, type Sent, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import {
  at,
  AWAY_MOST_MS,
  isFilled,
  LEAD,
  readAnswer,
  refusal,
  stepTo,
  TICK_MS,
  WORKS,
  type WorksAct,
  type World,
} from "@sequoia-leaf/yard";
import mid from "@sequoia-leaf/yard/yards/mid.json";

/** What Leaf tells the game about each call. */
type Ctx = Parameters<typeof WORKS.apply>[2];

import { S } from "./state.ts";
import { catchingUp, differences, doNow, letGo, onRefused, openYard, runYard } from "./yard.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const ctx = (): Ctx => ({ now: 1_800_000_000_000, player: { id: "p", guest: false }, seed: 7, room: 1e9, awards: [] });

/**
 * A stand-in Leaf that keeps the yard with the real rules, as the play service does, and answers a
 * batch as it does: short. It answers `answers` batches, and finds no network after that until it
 * is given more; it keeps the address of every read of the yard (`reads`), every command it is sent
 * (`commands`), and what came in what order (`calls`); and its clock stands `ms` past the tests' own.
 */
function fakeLeaf(yard: World = WORKS.create(ctx())) {
  const leaf = {
    yard,
    posts: 0,
    answers: Infinity,
    reads: [] as string[],
    commands: [] as unknown[],
    calls: [] as string[],
    ms: 0,
  };
  const now = (): Ctx => ({ ...ctx(), now: ctx().now + leaf.ms });
  const shown = (): unknown => WORKS.view(leaf.yard, now());
  /** Does a command as Leaf would, from another page of the member's. */
  const elsewhere = (act: WorksAct): void => {
    const done = WORKS.apply(leaf.yard, { ...act, tick: leaf.yard.tick }, ctx());
    if ("refused" in done) throw new Error(done.refused);
  };
  const post = (sent: Sent): Reply => {
    if (leaf.posts >= leaf.answers) return "offline";
    leaf.posts += 1;
    leaf.calls.push("batch");
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    leaf.commands.push(...commands);
    const results = commands.map((c: unknown) => {
      const id = isRecord(c) && typeof c.id === "string" ? c.id : "";
      const command = WORKS.command(c);
      const done = command ? WORKS.apply(leaf.yard, command, now()) : { refused: "invalid" };
      return "refused" in done ? { id, refused: done.refused } : { id, notes: done.notes };
    });
    return { status: 200, body: { rev: leaf.posts, now: "x", results, state: WORKS.answer?.(leaf.yard, now()) } };
  };
  const routes = {
    "GET /v1/game/play/works": (sent: Sent): Reply => {
      leaf.reads.push(sent.path);
      leaf.calls.push("read");
      return { status: 200, body: { rev: 0, now: "x", state: shown() } };
    },
    "POST /v1/game/play/works": post,
  };
  return { leaf, routes, elsewhere };
}

let world: Standin | null = null;
const clock = performance.now.bind(performance);
beforeEach(() => {
  // The page's own clock stands still, so that the yard runs on only when a test says so.
  performance.now = () => 1000;
});
afterEach(() => {
  world?.done();
  world = null;
  letGo();
  performance.now = clock;
});

/** Waits until a condition holds, a millisecond at a time. */
async function until(ok: () => boolean, tries = 1500): Promise<void> {
  if (ok() || tries === 0) return;
  await Bun.sleep(1);
  await until(ok, tries - 1);
}

/** The first tiles a belt could stand on. */
function clear(n: number): { x: number; y: number }[] {
  const w = S.world;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < w.cells.length && out.length < n; i++) {
    const x = i % w.land.w;
    const y = Math.floor(i / w.land.w);
    if (!w.cells[i] && refusal(w, "belt", x, y, Infinity) === null) out.push({ x, y });
  }
  return out;
}
const kindAt = (p: { x: number; y: number }) => S.world.cells[at(S.world, p.x, p.y)]?.kind;

async function opened(yard?: World) {
  const fake = fakeLeaf(yard);
  world = standin(fake.routes);
  expect(await openYard("p", () => undefined)).toBeNull();
  return fake;
}

describe("the yard, on Leaf", () => {
  test("reads what Leaf really answers a batch of the Works' commands", async () => {
    const contract: unknown = await Bun.file(new URL("../../../contracts/leaf-game-v1.json", import.meta.url)).json();
    const exchange = isRecord(contract) ? contract["POST /v1/game/play/{game}, the Works"] : null;
    const body = isRecord(exchange) ? exchange.body : null;
    const state = isRecord(body) ? body.state : null;
    expect(readAnswer(state)).toEqual({
      clock: expect.any(Number),
      tick: expect.any(Number),
      check: expect.any(Number),
      serial: 0,
    });
    expect(isRecord(body) && body.results).toEqual([{ id: "w-1", notes: [] }]);
  });

  test("opens as Leaf has it, and keeps nothing of the game in the browser", async () => {
    const fake = await opened();
    expect(S.world.seed).toBeNull();
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => fake.leaf.posts >= 1);
    expect([...(world?.store.map.keys() ?? [])].filter((k) => k.startsWith("works.save"))).toEqual([]);
  });

  test("with no Leaf answering, there is no yard", async () => {
    world = standin({ "GET /v1/game/play/works": "offline" });
    expect(await openYard("p", () => undefined)).toBe("closed");
  });

  test("a build shows at once, from the rules, before Leaf has even been asked", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    expect("refused" in doNow({ do: "build", kind: "belt", dir: 0, ...a })).toBe(false);
    expect(kindAt(a)).toBe("belt");
    expect(fake.leaf.posts).toBe(0);
    await until(() => fake.leaf.posts >= 1);
    expect(fake.leaf.yard.cells[at(fake.leaf.yard, a.x, a.y)]?.kind).toBe("belt");
    // One the rules turn down is said so, and not sent.
    const refused = doNow({ do: "remove", x: 0, y: 0 });
    expect("refused" in refused && refused.why).toBe("There is nothing here");
    await Bun.sleep(5);
    expect(fake.leaf.posts).toBe(1);
  });

  test("Leaf's yard, when it is not the copy, takes the copy's place", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    // Another page of the member's builds a mill.
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...b });
    expect(kindAt(b)).toBeUndefined();
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => kindAt(b) === "mill");
    expect([kindAt(a), kindAt(b)]).toEqual(["belt", "mill"]);
    expect(fake.leaf.reads).toHaveLength(2);
  });

  test("two commands in flight when the copy is found not Leaf's are both answered before Leaf's yard is asked for, and the copy is then exactly Leaf's", async () => {
    const fake = await opened();
    const [a, b, c] = clear(3);
    if (!a || !b || !c) throw new Error("no room");
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...c });
    // The second waits for the first, which Leaf answers; it finds no network at first, then is sent again.
    fake.leaf.answers = 1;
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    doNow({ do: "build", kind: "belt", dir: 1, ...b });
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(20);
    expect(fake.leaf.calls).toEqual(["read", "batch"]);
    fake.leaf.answers = Infinity;
    await until(() => kindAt(c) === "mill");
    expect(fake.leaf.calls).toEqual(["read", "batch", "batch", "read"]);
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
    expect(fake.leaf.yard.cells[at(fake.leaf.yard, b.x, b.y)]?.dir).toBe(1);
  });

  test("a command Leaf answers alike leaves the copy as it is: the same yard, not read again", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    const [copy, rev] = [S.world, S.rev];
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    runYard(1000);
    expect([S.world, S.rev, fake.leaf.reads.length, differences()]).toEqual([copy, rev, 1, 0]);
  });

  test("two commands unanswered at once are each compared at the tick the copy did it, though it has run on", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    const copy = S.world;
    fake.leaf.ms = 6000;
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    // Five seconds on the copy before the second; Leaf's clock is as the page reckons it.
    runYard(1000 + 5000);
    doNow({ do: "build", kind: "mill", dir: 0, ...b });
    runYard(1000 + 6000);
    expect(S.world.tick).toBe(60);
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect([S.world, fake.leaf.reads.length, differences()]).toEqual([copy, 1, 0]);
  });

  test("an answer whose check is not the copy's is counted, and Leaf's yard is asked for once, with the tick, and taken as it is", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    // The copy goes astray, as a fault in the rules would make it.
    S.world.till += 5;
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => fake.leaf.reads.length >= 2);
    await Bun.sleep(5);
    expect(fake.leaf.reads).toEqual(["/v1/game/play/works", "/v1/game/play/works?differs=0"]);
    expect([differences(), S.world.till, kindAt(a)]).toEqual([1, 0, "belt"]);
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
    // In step again: the next is answered alike.
    doNow({ do: "build", kind: "belt", dir: 0, ...b });
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect([fake.leaf.reads.length, differences()]).toEqual([2, 1]);
  });

  test("a read of Leaf's yard that fails sends nothing meanwhile, and asks again a couple of seconds on", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    let fails = true;
    world?.done();
    world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": (sent) => (fails ? "offline" : fake.routes["GET /v1/game/play/works"](sent)),
    });
    S.world.till += 5;
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    // What the member does meanwhile is neither done to the copy nor sent.
    doNow({ do: "build", kind: "belt", dir: 0, ...b });
    runYard(1000 + 1000);
    await Bun.sleep(5);
    expect([fake.leaf.posts, kindAt(b)]).toEqual([1, undefined]);
    fails = false;
    runYard(1000 + 2000);
    await until(() => kindAt(b) === "belt");
    await until(() => fake.leaf.posts >= 2);
    expect([fake.leaf.calls, differences()]).toEqual([["read", "batch", "read", "batch"], 1]);
  });

  test("what the member does while Leaf's yard comes is done once, after it, at the yard's tick then", async () => {
    const fake = await opened();
    const [a, b] = clear(2);
    if (!a || !b) throw new Error("no room");
    const held: (() => void)[] = [];
    world?.done();
    world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": (sent) =>
        new Promise<Reply>((answer) => held.push(() => answer(fake.routes["GET /v1/game/play/works"](sent)))),
    });
    S.world.till += 5;
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => held.length >= 1);
    expect("refused" in doNow({ do: "build", kind: "belt", dir: 0, ...b })).toBe(false);
    expect([kindAt(b), fake.leaf.posts]).toEqual([undefined, 1]);
    // Nothing says so for a second; after that, the line over the dock does.
    expect([catchingUp(1000 + 900), catchingUp(1000 + 1100)]).toEqual([false, true]);
    // Leaf's yard has run on two seconds by the time it comes.
    fake.leaf.ms = 2000;
    stepTo(fake.leaf.yard, 20);
    held.shift()?.();
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    expect([kindAt(b), catchingUp(1000 + 1100), differences()]).toEqual(["belt", false, 1]);
    const built = fake.leaf.commands.filter((c) => isRecord(c) && c.do === "build" && c.x === b.x && c.y === b.y);
    expect(built).toEqual([expect.objectContaining({ tick: 20 })]);
    expect(fake.leaf.yard.cells[at(fake.leaf.yard, b.x, b.y)]?.kind).toBe("belt");
  });

  test("a copy run ahead of Leaf's clock takes Leaf's yard, once, and stays in step under steady building", async () => {
    const fake = await opened();
    const [a, b, ...more] = clear(8);
    if (!a || !b) throw new Error("no room");
    // Ten seconds ahead by the page's reckoning; Leaf's clock has not moved.
    runYard(1000 + 10_000);
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => fake.leaf.reads.length >= 2);
    await Bun.sleep(5);
    // Leaf did it at its clock and LEAD ticks ahead, and the copy is Leaf's yard, there.
    expect([S.world.tick, kindAt(a)]).toEqual([LEAD, "belt"]);
    doNow({ do: "build", kind: "belt", dir: 0, ...b });
    for (const t of more) doNow({ do: "build", kind: "belt", dir: 0, ...t });
    await until(() => fake.leaf.commands.length >= 8);
    await Bun.sleep(5);
    expect([fake.leaf.reads.length, differences(), more.map(kindAt)]).toEqual([2, 0, more.map(() => "belt")]);
  });

  test("a command Leaf turns down: the member is told, and the copy becomes Leaf's yard, with no difference counted", async () => {
    const fake = await opened();
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    const told: string[] = [];
    onRefused((why) => told.push(why));
    // Another page of the member's put a mill where this one sets a belt down.
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...a });
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => kindAt(a) === "mill");
    expect([told, fake.leaf.reads.length, differences()]).toEqual([["That could not be done after all"], 2, 0]);
  });

  test("an order only Leaf can hang comes with Leaf's yard, asked for at once, and is no difference", async () => {
    // A yard with the board up and its first order filled, at Leaf's clock.
    const yard = WORKS.decode(JSON.stringify(mid));
    const first = yard?.board[0];
    if (!yard || !first) throw new Error("no board");
    yard.at = ctx().now;
    first.filled = { ...first.want };
    const fake = await opened(yard);
    doNow({ do: "handOver", order: first.id });
    // The copy, which has no seed, leaves the place empty until Leaf's order comes.
    expect(S.world.board).toHaveLength(2);
    await until(() => S.world.board.length === 3);
    expect(S.world.board.map((o) => o.id)).toEqual(fake.leaf.yard.board.map((o) => o.id));
    expect(S.world.board.some((o) => isFilled(o.want, o.filled))).toBe(false);
    expect([fake.leaf.reads.length, differences()]).toEqual([2, 0]);
  });

  test("what a frame's steps made known is told even when that frame also collects", async () => {
    const fake = await opened();
    const done = { kind: "story", index: 3, title: "Planks for the Treasury", pay: 80 } as const;
    runYard(1000 + 30_000);
    S.world.news.push(done);
    // A minute after the yard opened, this frame collects; the collection must not swallow the news.
    expect(runYard(1000 + 60_000)).toEqual([done]);
    await until(() => fake.leaf.posts >= 1);
  });

  test("a tab that comes back asks Leaf for its yard once every two seconds, however often it draws", async () => {
    const fake = await opened();
    let asked = 0;
    world?.done();
    world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": () => {
        asked += 1;
        return "offline";
      },
    });
    // Ten minutes on, with no network: ten frames in a row ask once, and a frame two seconds later asks again.
    const back = 1000 + 600_000;
    for (let frame = 0; frame < 10; frame++) runYard(back + frame * 16);
    await Bun.sleep(5);
    expect(asked).toBe(1);
    runYard(back + 2000);
    await Bun.sleep(5);
    expect(asked).toBe(2);
  });

  test("a frame that runs the yard to where it stands still holds its clock there, and its owner's next command starts it from then", async () => {
    const fake = await opened();
    // Leaf answers nothing more: the copy is the page's own.
    fake.leaf.answers = 0;
    // Its owner was last there ten seconds short of eight hours ago.
    S.world.seen = { ...S.world.seen, tick: S.world.tick - AWAY_MOST_MS / TICK_MS + 100 };
    // A tab back after fifty seconds runs the copy ten, to where it stands still.
    runYard(1000 + 50_000);
    expect(S.world.tick).toBe(100);
    doNow({ do: "collect" });
    runYard(1000 + 50_016);
    expect(S.world.tick).toBe(100);
    runYard(1000 + 51_000);
    expect(S.world.tick).toBe(110);
  });

  test("a tab that comes back shows its letter once: an answer from before the collect does not bring it back", async () => {
    const fake = await opened();
    // While the tab was away, Leaf ran the yard ten minutes: it has a letter for its owner.
    stepTo(fake.leaf.yard, 6000);
    fake.leaf.yard.at = ctx().now;
    // Leaf takes its time to answer a question for the yard, with the yard as it was asked.
    const held: (() => void)[] = [];
    world?.done();
    world = standin({
      ...fake.routes,
      "GET /v1/game/play/works": () => {
        const reply = {
          status: 200,
          body: { rev: fake.leaf.posts, now: "x", state: WORKS.view(fake.leaf.yard, ctx()) },
        };
        return new Promise<Reply>((answer) => held.push(() => answer(reply)));
      },
    });
    const back = 1000 + 600_000;
    performance.now = () => back;
    runYard(back);
    runYard(back + 2000);
    await Bun.sleep(5);
    expect(held).toHaveLength(1);
    held.shift()?.();
    await Bun.sleep(5);
    runYard(back + 16);
    expect(S.world.away).not.toBeNull();
    doNow({ do: "collect" });
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    runYard(back + 32);
    expect(S.world.away).toBeNull();
    for (const answer of held) answer();
    await Bun.sleep(5);
    runYard(back + 48);
    expect(S.world.away).toBeNull();
  });

  test("runs the copy on by Leaf's clock, and takes a yard put in place of another as it stands", async () => {
    const fake = await opened();
    // Fifty seconds, and fifty more: the copy runs on by itself, five hundred ticks each time.
    runYard(1000 + 50_000);
    runYard(1000 + 100_000);
    expect(S.world.tick).toBe(1000);
    // Leaf's yard is replaced by a new one, back at its first tick.
    fake.leaf.yard = WORKS.create(ctx());
    performance.now = () => 1000 + 100_000;
    const [a] = clear(1);
    if (!a) throw new Error("no room");
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(5);
    runYard(1000 + 100_000);
    // The build, made at the old yard's tick, was done as far ahead of the new one's clock as Leaf does one.
    expect(S.world.tick).toBe(LEAD);
    expect(kindAt(a)).toBe("belt");
  });
});
