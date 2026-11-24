import { describe, expect, it } from "bun:test";

import { CLOSE, LIVE_VERSION } from "@sequoia-leaf/core";
import { Deferred, Effect, Fiber } from "effect";
import { Socket } from "effect/socket";

import { MOST_WAITING, Pipe } from "../src/live/pipe.ts";

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

/** Lets every fiber that can go on do so. */
const settle = Effect.repeat(Effect.yieldNow, { times: 20 });

const binary = (first: number) => new Uint8Array([first, 0, 0]);

describe("a connection's pipe", () => {
  it("writes what it is sent in the order sent, texts and binary frames alike, and closes after them", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          yield* Deferred.succeed(open, undefined);
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION);
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
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION);
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

  it("writes a frame from a fiber there and then when nothing waits, and behind whatever does", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION);
          yield* Effect.forkScoped(pipe.pump());
          // A text in the line, taken and its write held: a snapshot written meanwhile waits behind it.
          pipe.send("joined");
          yield* settle;
          yield* pipe.write(binary(2));
          expect(written).toEqual([]);
          yield* Deferred.succeed(open, undefined);
          yield* settle;
          expect(written).toEqual(["joined", 2]);
          // Nothing waiting: written by the fiber writing it, before the pump has had a turn.
          yield* pipe.write(binary(3));
          expect(written).toEqual(["joined", 2, 3]);
          pipe.close(CLOSE.done, "done");
          yield* pipe.write(binary(4));
          yield* settle;
        }),
      ),
    );

    expect(written).toEqual(["joined", 2, 3, `close ${CLOSE.done} done`]);
  });

  it(`counts a frame written from a fiber behind others as waiting, and closes past ${MOST_WAITING}`, async () => {
    const written: Written = [];
    const closed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION);
          yield* Effect.forkScoped(pipe.pump());
          pipe.send("first");
          yield* settle;
          for (let i = 1; i < MOST_WAITING; i++) yield* pipe.write(binary(2));
          expect(pipe.closedWith).toBeNull();
          yield* pipe.write(binary(9));
          return pipe;
        }),
      ),
    );

    expect(closed.closedWith).toBe(CLOSE.policy);
  });

  it("closes at once when Leaf stops, ahead of anything waiting, and writes nothing after", async () => {
    const written: Written = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const open = yield* Deferred.make<void>();
          yield* Deferred.succeed(open, undefined);
          const pipe = yield* Pipe.make(writerHeldBy(written, open), LIVE_VERSION);
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
