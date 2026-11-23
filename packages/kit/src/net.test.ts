import { afterEach, describe, expect, jest, test } from "bun:test";

import { ask, backoff, listen, type Listening, STREAM_BACKOFF, STREAM_QUIET } from "./net.ts";
import { balance, forgetLedger, said } from "./purse.ts";
import { keptOpen, type Reply, type Standin, standin } from "./standin.ts";

let world: Standin | null = null;
let ears: Listening | null = null;
afterEach(() => {
  ears?.stop();
  ears = null;
  jest.useRealTimers();
  world?.done();
  world = null;
});

async function settle(): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- one turn after another
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("trying again", () => {
  test("waits `first`, twice as long after each failure up to `most`, with up to `jitter` more by chance", () => {
    const b = { first: 100, most: 1000, jitter: 0.5 };
    expect([0, 1, 2, 3, 4, 60].map((tries) => backoff(b, tries, 0))).toEqual([100, 200, 400, 800, 1000, 1000]);
    expect([backoff(b, 0, 1), backoff(b, 9, 0.5)]).toEqual([150, 1250]);
  });
});

/** An answer with `word` beside it, where Leaf says its word on the purse. */
const beside = (word: string): Response =>
  new Response("{}", { status: 200, headers: { "Content-Type": "application/json", "Leaf-Purse": word } });

describe("an answer", () => {
  test("with Leaf's word on the purse beside it gives the purse that word; one with none, or not Leaf's, gives nothing", async () => {
    forgetLedger();
    const words = [
      '{"coins":300,"leaf":2350,"version":7}',
      '{"coins":-1,"leaf":0,"version":9}',
      "lots",
      '{"coins":300,"leaf":9,"version":5}',
    ];
    world = standin({ "POST /v1/x": () => beside(words.shift() ?? "{}"), "GET /v1/y": { status: 200, body: {} } });
    await ask("/v1/x", { method: "POST" });
    expect(balance()).toEqual({ coins: 300, leaf: 2350 });
    for (let n = 0; n < 3; n++) {
      // oxlint-disable-next-line no-await-in-loop -- one after another
      await ask("/v1/x", { method: "POST" });
    }
    await ask("/v1/y");
    expect([balance(), said()?.version]).toEqual([{ coins: 300, leaf: 2350 }, 7]);
    forgetLedger();
  });
});

describe("a stream", () => {
  test("not answering by the deadline, or quiet too long once open, is let go and opened again from where it got to", async () => {
    jest.useFakeTimers();
    const stream = keptOpen();
    let opened = 0;
    world = standin(
      {
        "GET /v1/s": (): Reply | Promise<Reply> =>
          ++opened === 1 ? new Promise<never>(() => undefined) : stream.open(),
      },
      { deadline: 1000 },
    );
    const heard: number[] = [];
    ears = listen("/v1/s", (e) => heard.push(e.id), { after: 5 });
    await settle();
    jest.advanceTimersByTime(1000);
    await settle();
    jest.advanceTimersByTime(backoff(STREAM_BACKOFF, 0, 1));
    await settle();
    expect(opened).toBe(2);
    stream.say("id: 6\nevent: x\ndata: {}\n\n: a comment, as Leaf writes to keep the line open\n\n");
    await settle();
    expect(heard).toEqual([6]);
    jest.advanceTimersByTime(STREAM_QUIET - 10);
    await settle();
    expect(opened).toBe(2);
    jest.advanceTimersByTime(10);
    await settle();
    // It opened, so its tries start again: the first wait.
    jest.advanceTimersByTime(backoff(STREAM_BACKOFF, 0, 1));
    await settle();
    expect(world.sent.map((s) => s.path)).toEqual(["/v1/s?after=5", "/v1/s?after=5", "/v1/s?after=6"]);
  });
});
