import { afterEach, describe, expect, test } from "bun:test";

import { type Reply, type Sent, type Standin, standin } from "@sequoia-leaf/kit/standin.ts";
import { RAID, type RaidCommand, type Table } from "@sequoia-leaf/raid";

import { ask, busy, doNow, onHeld, onRefused, openTable, S, waitingForLeaf } from "./state.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** What Leaf tells the game about each call. */
type Ctx = Parameters<typeof RAID.apply>[2];

/** A stand-in Leaf that plays the raid with the real rules, as the play service does. */
function fakeLeaf() {
  let rolled = 1;
  const ctx = (): Ctx => ({
    now: 0,
    player: { id: "p", guest: false },
    seed: (rolled = (rolled * 48_271) % 2_147_483_647),
    room: 1e9,
    awards: [],
    postcards: {},
  });
  const leaf = { state: RAID.create(ctx()), rev: 0, seen: new Map<string, unknown>(), posts: 0 };
  /** Does a command as Leaf would, from another page of the member's. */
  const elsewhere = (command: RaidCommand): void => {
    const done = RAID.apply(leaf.state, command, ctx());
    if ("refused" in done) throw new Error(done.refused);
    leaf.state = done.state;
    leaf.rev += 1;
  };
  const shown = (): unknown => RAID.view(leaf.state, ctx());
  const post = (sent: Sent): Reply => {
    leaf.posts += 1;
    const commands = isRecord(sent.body) && Array.isArray(sent.body.commands) ? sent.body.commands : [];
    const before = RAID.encode(leaf.state);
    const results = commands.map((c: unknown) => {
      const id = isRecord(c) && typeof c.id === "string" ? c.id : "";
      const answered = leaf.seen.get(id);
      if (answered) return answered;
      const command = RAID.command(c);
      const done: Table | string = command === null ? "invalid" : apply(command);
      const result = typeof done === "string" ? { id, refused: done } : { id, notes: lastNotes };
      leaf.seen.set(id, result);
      return result;
    });
    if (RAID.encode(leaf.state) !== before) leaf.rev += 1;
    return { status: 200, body: { rev: leaf.rev, now: "x", results, state: shown() } };
  };
  let lastNotes: unknown[] = [];
  const apply = (command: RaidCommand): Table | string => {
    const done = RAID.apply(leaf.state, command, ctx());
    if ("refused" in done) return done.refused;
    leaf.state = done.state;
    lastNotes = [...done.notes];
    return leaf.state;
  };
  const routes = {
    "GET /v1/game/play/raid": (): Reply => ({ status: 200, body: { rev: leaf.rev, now: "x", state: shown() } }),
    "POST /v1/game/play/raid": post,
  };
  return { leaf, routes, elsewhere };
}

let world: Standin | null = null;
afterEach(() => {
  world?.done();
  world = null;
  S.run = null;
  S.screen = { at: "front" };
});

/** Waits until a condition holds, a millisecond at a time. */
async function until(ok: () => boolean, tries = 300): Promise<void> {
  if (ok() || tries === 0) return;
  await Bun.sleep(1);
  await until(ok, tries - 1);
}

/** A table opened on the stand-in Leaf, with a run laid out and its first figure picked. */
async function seated() {
  const fake = fakeLeaf();
  world = standin(fake.routes);
  expect(await openTable("p", () => undefined)).toBeNull();
  expect((await ask({ do: "start", trail: 0 }))?.ok).toBe(true);
  expect((await ask({ do: "choose", option: 0 }))?.ok).toBe(true);
  return fake;
}

/** The places on the stall that hold a figure, as the page shows it. */
const offers = (): number[] => (S.run?.stall ?? []).flatMap((kind, i) => (kind === null ? [] : [i]));

describe("the table, on Leaf", () => {
  test("opens as Leaf has it, and nothing of the game is kept in the browser", async () => {
    const fake = await seated();
    expect(S.run?.stage.phase).toBe("plan");
    expect(S.runs).toBe(1);
    const offer = S.run?.stall.findIndex((k) => k !== null) ?? 0;
    expect(doNow({ do: "buy", offer })?.ok).toBe(true);
    doNow({ do: "hold", on: true });
    await until(() => fake.leaf.posts >= 4);
    const kept = [...(world?.store.map.keys() ?? [])];
    expect(kept.filter((k) => k.startsWith("raid."))).toEqual([]);
    expect(fake.leaf.state.run?.held).toBe(true);
  });

  test("with no Leaf answering, there is no table", async () => {
    world = standin({ "GET /v1/game/play/raid": "offline" });
    expect(await openTable("p", () => undefined)).toBe("closed");
  });

  test("moving, holding the stall and buying show at once, from the rules", async () => {
    const fake = await seated();
    const seat = S.run?.board.findIndex((p) => p !== null) ?? -1;
    const posts = fake.leaf.posts;
    const acorns = S.run?.acorns ?? 0;
    const [offer = 0] = offers();
    expect(doNow({ do: "move", from: { on: "board", at: seat }, to: { on: "board", at: 20 } })?.ok).toBe(true);
    expect(doNow({ do: "buy", offer })?.ok).toBe(true);
    // Shown before Leaf has even been asked.
    expect(S.run?.board[20]).not.toBeNull();
    expect(S.run?.acorns).toBeLessThan(acorns);
    expect(fake.leaf.posts).toBe(posts);
    await until(() => !waitingForLeaf());
    expect(fake.leaf.state.run?.board[20]).not.toBeNull();
    expect(fake.leaf.state.run?.acorns).toBe(S.run?.acorns ?? -1);
  });

  test("while Leaf answers a rustle, the table is busy: a tap on an offer still showing is turned away, not queued", async () => {
    const fake = await seated();
    let held = 0;
    onHeld(() => held++);
    const [offer = 0] = offers();
    // The stall is about to hold other figures: the purchase is dropped, not sent to land on whoever comes next.
    const rustled = ask({ do: "rustle" });
    expect(busy()).toBe(true);
    expect(doNow({ do: "buy", offer })).toBeNull();
    expect(held).toBe(1);
    expect((await rustled)?.ok).toBe(true);
    expect(busy()).toBe(false);
    expect(fake.leaf.state.run?.bought).toBe(0);
  });

  test("a purchase Leaf turns down is taken back, and the member hears why", async () => {
    const fake = await seated();
    const refusals: string[] = [];
    onRefused((why) => refusals.push(why));
    const acorns = S.run?.acorns ?? 0;
    const [offer = 0] = offers();
    // Another page of the member's has sent the party in: Leaf sells nothing now.
    fake.elsewhere({ do: "fight" });
    expect(doNow({ do: "buy", offer })?.ok).toBe(true);
    expect(S.run?.bench.some((p) => p !== null)).toBe(true);
    await until(() => !waitingForLeaf());
    expect(refusals).toHaveLength(1);
    expect(S.run?.stage.phase).toBe("fight");
    expect(S.run?.acorns).toBe(acorns);
    expect(S.run?.bench.some((p) => p !== null)).toBe(false);
  });

  test("a move the rules turn down is said so, and not sent", async () => {
    const fake = await seated();
    const refusals: string[] = [];
    onRefused((why) => refusals.push(why));
    const posts = fake.leaf.posts;
    expect(doNow({ do: "move", from: { on: "bench", at: 0 }, to: { on: "board", at: 1 } })).toEqual({
      ok: false,
      why: "Nobody is there.",
    });
    expect(refusals.at(-1)).toBe("Nobody is there.");
    await Bun.sleep(5);
    expect(fake.leaf.posts).toBe(posts);
  });

  test("whatever was changed in the page's copy by hand, Leaf's next answer puts back", async () => {
    const fake = await seated();
    const run = S.run;
    if (!run) throw new Error("no run");
    const acorns = run.acorns;
    const figure = run.board.find((p) => p !== null);
    run.acorns = 999;
    if (figure) figure.stars = 3;
    doNow({ do: "hold", on: true });
    await until(() => fake.leaf.state.run?.held === true && S.run?.acorns !== 999);
    expect(S.run?.acorns).toBe(acorns);
    expect(S.run?.board.find((p) => p !== null)?.stars).toBe(1);
  });

  test("what another page of the member's did shows on this page's next answer", async () => {
    const fake = await seated();
    const offer = fake.leaf.state.run?.stall.findIndex((k) => k !== null) ?? 0;
    fake.elsewhere({ do: "buy", offer });
    expect(S.run?.bench.some((p) => p !== null)).toBe(false);
    doNow({ do: "hold", on: true });
    await until(() => S.run?.bench.some((p) => p !== null) === true);
    expect(S.run?.bench.some((p) => p !== null)).toBe(true);
  });
});
