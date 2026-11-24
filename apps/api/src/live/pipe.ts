import { CLOSE } from "@sequoia-leaf/core";
import { Effect, Option, Queue, Semaphore } from "effect";
import { Socket } from "effect/socket";

import type { Connection } from "./room.ts";

/** How many frames may wait to go to one connection before it is taken to be stuck and closed. */
export const MOST_WAITING = 1024;

type Frame = string | Uint8Array | Socket.CloseEvent;

/**
 * One connection to a player's browser. Frames go out in the order they were sent, by one of two
 * ways: a frame sent from plain code (`send`) waits in the connection's line, and its own fiber
 * writes it (`pump`); a room's snapshot at its tick (`writeIf`) is written by the tick's fiber
 * there and then, with no hop to the connection's, unless anything sent before it is still
 * waiting, when it waits behind it. It is only a way through; everything about the player is on
 * the `Player`.
 */
export class Pipe implements Connection {
  /** The code it was closed with, once Leaf closed it. */
  closedWith: number | null = null;
  /** The code the page closed it with, once it did (1006 for a connection that dropped). */
  closedBy: number | null = null;
  /**
   * Frames sent and not yet written: in the line, or taken from it by `pump` and being written.
   * While there are any, a snapshot `writeIf` is given goes into the line behind them, so that no
   * frame overtakes one sent before it.
   */
  private waiting = 0;
  /**
   * The socket, held by whoever writes to it, one at a time: `pump` for what waits in the line, or
   * `writeIf`. What one has decided to write goes out before anything the other writes, however
   * the runtime takes turns between fibers, and however long the socket takes over a write.
   */
  private readonly socket = Semaphore.makeUnsafe(1);
  /** The version of the wire its page speaks (core's `LIVE_VERSION` when it opened, or an older one Leaf still speaks). */
  readonly speaks: number;
  private readonly out: Queue.Queue<Frame>;
  private readonly writer: Socket.Writer;

  constructor(out: Queue.Queue<Frame>, writer: Socket.Writer, speaks: number) {
    this.out = out;
    this.writer = writer;
    this.speaks = speaks;
  }

  /** A pipe writing to `writer`, for a page that speaks version `speaks` of the wire, with its line of frames waiting. */
  static make(writer: Socket.Writer, speaks: number): Effect.Effect<Pipe> {
    return Effect.map(Queue.unbounded<Frame>(), (out) => new Pipe(out, writer, speaks));
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  /** Puts a frame in the line, for `pump` to write. */
  send(frame: string | Uint8Array): void {
    if (this.closed) return;
    // The socket takes frames as fast as they come; a backlog this long means it is stuck.
    if (this.waiting >= MOST_WAITING) return this.close(CLOSE.policy, "too far behind");
    this.waiting++;
    Queue.offerUnsafe(this.out, frame);
  }

  /**
   * Writes a frame from the fiber this runs in, if `still()` says it is still for this connection,
   * so that nothing is written to the page between asking and writing. With the socket free, it is
   * held while asked and written: there and then when nothing sent before it is waiting, in the
   * line behind what is otherwise. With the socket held by `pump`, the frame is asked and put in the
   * line in one step, behind what the pump is writing: whoever writes never waits for a connection.
   * A write that fails is a socket already gone, which its reader hears of too: the frame is lost
   * with it.
   */
  writeIf(still: () => boolean, frame: Uint8Array): Effect.Effect<void> {
    const held = Effect.suspend(() => {
      if (this.closed || !still()) return Effect.void;
      if (this.waiting > 0) return Effect.sync(() => this.send(frame));
      return Effect.ignore(this.writer.write(frame));
    });
    const inLine = Effect.sync(() => {
      if (still()) this.send(frame);
    });
    return Effect.flatMap(this.socket.withPermitsIfAvailable(1)(held), (wrote) =>
      Option.isSome(wrote) ? Effect.void : inLine,
    );
  }

  /** Closes it after whatever is waiting, saying why by the code. */
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closedWith = code;
    this.waiting++;
    Queue.offerUnsafe(this.out, new Socket.CloseEvent(code, reason));
  }

  /** Writes what waits, in order, as soon as it does, holding the socket, for as long as the connection lasts. */
  pump(): Effect.Effect<never, Socket.SocketError> {
    return Effect.forever(
      Effect.flatMap(Queue.takeAll(this.out), (frames) =>
        this.socket.withPermits(1)(
          Effect.andThen(
            Effect.forEach(frames, (frame) => this.writer.write(frame), { discard: true }),
            Effect.sync(() => {
              this.waiting -= frames.length;
            }),
          ),
        ),
      ),
    );
  }

  /** Closes it at once, ahead of anything waiting: Leaf is stopping, and there is no time to wait. */
  closeNow(code: number, reason: string): Effect.Effect<void> {
    if (this.closed) return Effect.void;
    this.closedWith = code;
    return Effect.ignore(this.writer.write(new Socket.CloseEvent(code, reason)));
  }
}
