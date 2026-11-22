import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { forgetStop } from "@sequoia-leaf/kit/keep.ts";
import { type Reply, type Sent, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { at, LEAD, refusal, WORKS, type WorksAct } from "@sequoia-leaf/yard";

/** What Leaf tells the game about each call. */
type Ctx = Parameters<typeof WORKS.apply>[2];

import { S } from "./state.ts";
import { doNow, letGo, openYard, runYard } from "./yard.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const ctx = (): Ctx => ({ now: 1_800_000_000_000, player: { id: "p", guest: false }, seed: 7, room: 1e9, awards: [] });

/**
 * A stand-in Leaf that keeps the yard with the real rules, as the play service does. It answers
 * `answers` batches, and finds no network after that until it is given more.
 */
function fakeLeaf() {
  const leaf = { yard: WORKS.create(ctx()), posts: 0, answers: Infinity };
  const shown = (): unknown => WORKS.view(leaf.yard, ctx());
  /** Does a command as Leaf would, from another page of the member's. */
  const elsewhere = (act: WorksAct): void => {
    const done = WORKS.apply(leaf.yard, { ...act, tick: leaf.yard.tick }, ctx());
    if ("refused" in done) throw new Error(done.refused);
  };
  const post = (sent: Sent): Reply => {
    if (leaf.posts >= leaf.answers) return "offline";
    leaf.posts += 1;
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    const results = commands.map((c: unknown) => {
      const id = isRecord(c) && typeof c.id === "string" ? c.id : "";
      const command = WORKS.command(c);
      const done = command ? WORKS.apply(leaf.yard, command, ctx()) : { refused: "invalid" };
      return "refused" in done ? { id, refused: done.refused } : { id, notes: done.notes };
    });
    return { status: 200, body: { rev: leaf.posts, now: "x", results, state: shown() } };
  };
  const routes = {
    "GET /v1/game/play/works": (): Reply => ({ status: 200, body: { rev: 0, now: "x", state: shown() } }),
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
  forgetStop();
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

async function opened() {
  const fake = fakeLeaf();
  world = standin(fake.routes);
  expect(await openYard("p", () => undefined)).toBeNull();
  return fake;
}

describe("the yard, on Leaf", () => {
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
    await until(() => fake.leaf.posts >= 1);
    runYard(1000);
    expect([kindAt(a), kindAt(b)]).toEqual(["belt", "mill"]);
  });

  test("a command sent and not answered yet is done again on top of Leaf's yard", async () => {
    const fake = await opened();
    const [a, b, c] = clear(3);
    if (!a || !b || !c) throw new Error("no room");
    fake.elsewhere({ do: "build", kind: "mill", dir: 0, ...c });
    // Leaf answers the first; the second finds no answer, and waits to be sent again.
    fake.leaf.answers = 1;
    doNow({ do: "build", kind: "belt", dir: 0, ...a });
    doNow({ do: "build", kind: "belt", dir: 1, ...b });
    await until(() => fake.leaf.posts >= 1);
    await Bun.sleep(20);
    runYard(1000);
    expect([kindAt(a), kindAt(b), kindAt(c)]).toEqual(["belt", "belt", "mill"]);
    expect(fake.leaf.yard.cells[at(fake.leaf.yard, b.x, b.y)]).toBeNull();
    // Once Leaf has it, the copy is Leaf's yard alone, and still shows it.
    fake.leaf.answers = Infinity;
    await until(() => fake.leaf.posts >= 2);
    await Bun.sleep(5);
    runYard(1000);
    expect(fake.leaf.yard.cells[at(fake.leaf.yard, b.x, b.y)]?.dir).toBe(1);
    expect(WORKS.encode(S.world)).toBe(WORKS.encode({ ...fake.leaf.yard, seed: null }));
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
