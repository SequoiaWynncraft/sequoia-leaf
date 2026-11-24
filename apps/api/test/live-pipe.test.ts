import { describe, expect, it } from "bun:test";

import { CLOSE, LIVE_VERSION } from "@sequoia-leaf/core";
import { Deferred, Effect, Fiber, References } from "effect";
import { Socket } from "effect/socket";

import { MOST_WAITING, Pipe } from "../src/live/pipe.ts";
import { noTally } from "../src/live/room.ts";

/** What a socket was written, in order: each text, each binary frame's first byte, and each close as `close <code> <reason>`. */
type Written = (string | number)[];

const said = (frame: string | Uint8Array | Socket.CloseEvent): string | number =>
  typeof frame === "string"
    ? frame
    : Socket.isCloseEvent(frame)
      ? `close ${frame.code} ${frame.reason}`
      : (frame[0] ?? -1);

/**
 * A socket's writer that keeps what it is written, and holds every write until `open` is done: a
 * socket that has stopped taking frames until then.
 */
const writerHeldBy = (written: Written, open: Deferred.Deferred<void>): Socket.Writer => ({
  write: (frame) =>
    Effect.andThen(
      Deferred.await(open),
      Effect.sync(() => void written.push(said(frame))),
    ),
  writeAll: (frames) =>
    Effect.andThen(
      Deferred.await(open),
      Effect.sync(() => void written.push(...frames.map(said))),
    ),
});

/**
 * Runs a race at every interleaving this test can reach: with fibers taking one to four of Effect's
 * steps before the others have a turn (`budget`), and its other side waiting none to six turns more
 * (`k`). Where Effect may let another fiber run falls on a different step for each, so a check
 * split from the act it guards is found by one of them.
 */
async function everyInterleaving(race: (budget: number, k: number) => Promise<void>): Promise<void> {
  for (let budget = 1; budget <= 4; budget++)
    for (let k = 0; k <= 6; k++) {
      // oxlint-disable-next-line no-await-in-loop -- one race after another
      await race(budget, k);
    }
}

/** Lets every fiber that can go on do so. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

const binary = (first: number) => new Uint8Array([first, 0, 0]);
/** Counts no motion: the tests here count what the socket is written. */
const noMotion = () => undefined;

describe("a connection's pipe", () => {
  it("writes what it is sent in the order sent, texts and binary frames alike, and closes after them", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          yield* Deferred.succeed(open, undefined);
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION, noMotion);
          yield* Effect.forkScoped(pipe.pump());
          pipe.send("welcome");
          pipe.send(binary(2));
          pipe.send("joined");
          yield* settle;
          pipe.send(binary(3));
          pipe.close(CLOSE.replaced, "replaced");
          pipe.send("after");
          yield* settle;
        }),
      ),
    );

    expect(written).toEqual(["welcome", 2, "joined", 3, "close 4001 replaced"]);
  });

  it(`closes a connection whose socket has stopped taking frames, once ${MOST_WAITING} wait unwritten, after them`, async () => {
    const written: Written = [];
    const closed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION, noMotion);
          const pump = yield* Effect.forkScoped(pipe.pump());
          // The first frame is taken, and its write held: the socket takes nothing more for now. It
          // waits unwritten with the rest.
          pipe.send("first");
          yield* settle;
          for (let i = 1; i < MOST_WAITING; i++) pipe.send(binary(2));
          expect(pipe.closedWith).toBeNull();
          pipe.send(binary(9));
          expect(pipe.closedWith).toBe(CLOSE.policy);
          pipe.send("never");
          yield* Deferred.succeed(open, undefined);
          yield* settle;
          yield* Fiber.interrupt(pump);
          return pipe;
        }),
      ),
    );

    expect(closed.closed).toBe(true);
    expect(written.length).toBe(MOST_WAITING + 1);
    expect(written.at(0)).toBe("first");
    expect(written.slice(1, -1).every((w) => w === 2)).toBe(true);
    expect(written.at(-1)).toBe(`close ${CLOSE.policy} too far behind`);
  });

  it("writes a frame from a fiber there and then when nothing waits, and behind whatever does, never waiting itself", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION, noMotion);
          yield* Effect.forkScoped(pipe.pump());
          // A text in the line, taken and its write held: a snapshot written meanwhile goes behind
          // it, and the fiber writing it goes on.
          pipe.send("joined");
          yield* settle;
          yield* pipe.writeIf(() => binary(2), noTally());
          expect(written).toEqual([]);
          yield* Deferred.succeed(open, undefined);
          yield* settle;
          expect(written).toEqual(["joined", 2]);
          // Nothing waiting: written by the fiber writing it, before the pump has had a turn.
          yield* pipe.writeIf(() => binary(3), noTally());
          expect(written).toEqual(["joined", 2, 3]);
          pipe.close(CLOSE.done, "done");
          yield* pipe.writeIf(() => binary(4), noTally());
          yield* settle;
        }),
      ),
    );

    expect(written).toEqual(["joined", 2, 3, `close ${CLOSE.done} done`]);
  });

  it("writes a frame no longer for the page not at all, and one being written before anything sent meanwhile", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          // The first snapshot's write is held: the socket takes a while over it.
          const writer: Socket.Writer = {
            write: (frame) =>
              frame instanceof Uint8Array && frame[0] === 2
                ? Effect.andThen(
                    Deferred.await(open),
                    Effect.sync(() => void written.push(said(frame))),
                  )
                : Effect.sync(() => void written.push(said(frame))),
            writeAll: (frames) => Effect.sync(() => void written.push(...frames.map(said))),
          };
          const pipe = yield* Pipe.make(writer, LIVE_VERSION, noMotion);
          yield* Effect.forkScoped(pipe.pump());
          yield* pipe.writeIf(() => null, noTally());
          const writing = yield* Effect.forkScoped(pipe.writeIf(() => binary(2), noTally()));
          yield* settle;
          // Sent while the snapshot is being written (the page's next room's welcome): after it.
          pipe.send("welcome");
          yield* settle;
          expect(written).toEqual([]);
          yield* Deferred.succeed(open, undefined);
          yield* Fiber.join(writing);
          yield* settle;
        }),
      ),
    );

    expect(written).toEqual([2, "welcome"]);
  });

  it(`counts a frame written from a fiber behind others as waiting, and closes past ${MOST_WAITING}`, async () => {
    const written: Written = [];
    const closed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION, noMotion);
          yield* Effect.forkScoped(pipe.pump());
          pipe.send("first");
          yield* settle;
          for (let i = 1; i < MOST_WAITING; i++) yield* pipe.writeIf(() => binary(2), noTally());
          expect(pipe.closedWith).toBeNull();
          yield* pipe.writeIf(() => binary(9), noTally());
          return pipe;
        }),
      ),
    );

    expect(closed.closedWith).toBe(CLOSE.policy);
  });

  it("puts a snapshot in the line, behind what waits, before anything sent once it was found still for the page", async () => {
    // The page's next room's welcome is sent as soon as the snapshot has been looked at, after
    // however many turns of the page's, with fibers taking turns as often as Effect lets them.
    await everyInterleaving(async (budget, k) => {
      const written: Written = [];
      await Effect.runPromise(
        Effect.provideService(
          Effect.scoped(
            Effect.gen(function* () {
              const writer: Socket.Writer = {
                write: (frame) => Effect.sync(() => void written.push(said(frame))),
                writeAll: (frames) => Effect.sync(() => void written.push(...frames.map(said))),
              };
              const pipe = yield* Pipe.make(writer, LIVE_VERSION, noMotion);
              // Something waits in the line, and nothing holds the socket.
              pipe.send("joined");
              let inTown = true;
              const looked = yield* Deferred.make<void>();
              const page = yield* Effect.forkScoped(
                Effect.gen(function* () {
                  yield* Deferred.await(looked);
                  for (let turn = 0; turn < k; turn++) yield* Effect.yieldNow;
                  inTown = false;
                  pipe.send("camp welcome");
                }),
              );
              const still = () => {
                Deferred.doneUnsafe(looked, Effect.void);
                return inTown;
              };
              yield* Fiber.join(yield* Effect.forkScoped(pipe.writeIf(() => (still() ? binary(2) : null), noTally())));
              yield* Fiber.join(page);
              yield* Effect.forkScoped(pipe.pump());
              yield* settle;
            }),
          ),
          References.MaxOpsBeforeYield,
          budget,
        ),
      );
      const welcome = written.indexOf("camp welcome");
      expect([budget, k, written.slice(welcome).includes(2)]).toEqual([budget, k, false]);
    });
  });

  it("writes nothing after closing at once, whatever its pump had taken and not yet written", async () => {
    await everyInterleaving(async (budget, k) => {
      const written: Written = [];
      await Effect.runPromise(
        Effect.provideService(
          Effect.scoped(
            Effect.gen(function* () {
              const writer: Socket.Writer = {
                write: (frame) => Effect.sync(() => void written.push(said(frame))),
                writeAll: (frames) => Effect.sync(() => void written.push(...frames.map(said))),
              };
              const pipe = yield* Pipe.make(writer, LIVE_VERSION, noMotion);
              pipe.send("a");
              pipe.send("b");
              yield* Effect.forkScoped(pipe.pump());
              for (let turn = 0; turn < k; turn++) yield* Effect.yieldNow;
              yield* pipe.closeNow(CLOSE.restart, "restart");
              pipe.send("c");
              yield* settle;
            }),
          ),
          References.MaxOpsBeforeYield,
          budget,
        ),
      );
      expect([budget, k, written.at(-1)]).toEqual([budget, k, `close ${CLOSE.restart} restart`]);
    });
  });

  it("closes at once when Leaf stops, ahead of anything waiting, and writes nothing after", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          yield* Deferred.succeed(open, undefined);
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION, noMotion);
          pipe.send("waiting");
          yield* pipe.closeNow(CLOSE.restart, "restart");
          pipe.send("after");
          pipe.close(CLOSE.done, "again");
          expect(pipe.closedWith).toBe(CLOSE.restart);
        }),
      ),
    );

    expect(written).toEqual([`close ${CLOSE.restart} restart`]);
  });
});
