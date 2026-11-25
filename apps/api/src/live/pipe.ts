import { CLOSE } from "@sequoia-leaf/core";
import { Effect, Option, Queue, Semaphore } from "effect";
import { Socket } from "effect/socket";

import type { Connection, Tally } from "./room.ts";

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
 *
 * The socket's writer must not suspend a write: the tick writes every player's snapshot one after
 * another, and a write that waited would hold up everybody's. Bun's sends in the step it runs
 * (`ServerWebSocket.sendBinary`), and closes a socket a megabyte behind itself (`LIVE_SOCKETS`).
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
  /** Whether Leaf closed it at once (`closeNow`): nothing more is written to it, not even what waits. */
  private cut = false;
  /**
   * The socket, held by whoever writes to it, one at a time: `pump` for what waits in the line,
   * `writeIf`, or `closeNow`. What one has decided to write goes out before anything the others
   * write, however the runtime takes turns between fibers.
   */
  private readonly socket = Semaphore.makeUnsafe(1);
  /** The version of the wire its page speaks (core's `LIVE_VERSION` when it opened, or an older one Leaf still speaks). */
  readonly speaks: number;
  private readonly out: Queue.Queue<Frame>;
  private readonly writer: Socket.Writer;
  /** Told the bytes of each binary frame it takes, every one a room's snapshot: motion sent (`LiveCounts`). */
  private readonly motion: (bytes: number) => void;

  constructor(out: Queue.Queue<Frame>, writer: Socket.Writer, speaks: number, motion: (bytes: number) => void) {
    this.out = out;
    this.writer = writer;
    this.speaks = speaks;
    this.motion = motion;
  }

  /**
   * A pipe writing to `writer`, for a page that speaks version `speaks` of the wire, with its line
   * of frames waiting, telling `motion` of each snapshot it takes.
   */
  static make(writer: Socket.Writer, speaks: number, motion: (bytes: number) => void): Effect.Effect<Pipe> {
    return Effect.map(Queue.unbounded<Frame>(), (out) => new Pipe(out, writer, speaks, motion));
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  /** Puts a frame in the line, for `pump` to write; says whether it did (not on a connection closed, or closing as stuck). */
  send(frame: string | Uint8Array): boolean {
    if (this.closed) return false;
    // The socket takes frames as fast as they come; a backlog this long means it is stuck.
    if (this.waiting >= MOST_WAITING) {
      this.close(CLOSE.policy, "too far behind");
      return false;
    }
    this.waiting++;
    Queue.offerUnsafe(this.out, frame);
    if (typeof frame !== "string") this.motion(frame.byteLength);
    return true;
  }

  /**
   * Writes from the fiber this runs in what `take()` says to write, if anything, so that nothing is
   * written to the page between its saying and the writing. With the socket free, it is held:
   * `take()` is asked and the frame put in the line behind what waits in one step, or, with nothing
   * waiting, written there and then, before anything sent after the asking, which waits in the line
   * for the socket. With the socket held by another, `take()` is asked and the frame put in the line
   * in one step, behind what that one is writing: whoever writes never waits for a connection. A
   * frame written there and then counts as sent once the socket has taken it; a write that fails is
   * a socket already gone, which its reader hears of too, and the frame is lost with it.
   */
  writeIf(take: () => Uint8Array | null, tally: Tally): Effect.Effect<void> {
    const held = Effect.suspend(() => {
      // Asked, and put in the line or written next, in this one step.
      const frame = this.closed ? null : take();
      if (frame === null) {
        tally.passed++;
        return Effect.void;
      }
      if (this.waiting > 0) {
        this.queue(frame, tally);
        return Effect.void;
      }
      // Counted in the write's own step: a step more a write costs every player at every tick.
      return Effect.match(this.writer.write(frame), {
        onFailure: () => undefined,
        onSuccess: () => {
          tally.direct++;
          this.motion(frame.byteLength);
        },
      });
    });
    const inLine = Effect.sync(() => {
      const frame = this.closed ? null : take();
      if (frame === null) tally.passed++;
      else this.queue(frame, tally);
    });
    return Effect.flatMap(this.socket.withPermitsIfAvailable(1)(held), (wrote) =>
      Option.isSome(wrote) ? Effect.void : inLine,
    );
  }

  /** A frame put in the line (`send`), counted as `writeIf` counts it. */
  private queue(frame: Uint8Array, tally: Tally): void {
    if (this.send(frame)) tally.queued++;
    else tally.passed++;
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
            Effect.forEach(frames, (frame) => (this.cut ? Effect.void : this.writer.write(frame)), { discard: true }),
            Effect.sync(() => {
              this.waiting -= frames.length;
            }),
          ),
        ),
      ),
    );
  }

  /**
   * Closes it at once, ahead of anything waiting: Leaf is stopping, and there is no time to wait.
   * Holding the socket, it is cut off and its close written, and nothing after: not what waits in
   * the line, nor what `pump` took from it and had not written.
   */
  closeNow(code: number, reason: string): Effect.Effect<void> {
    return this.socket.withPermits(1)(
      Effect.suspend(() => {
        if (this.closed) return Effect.void;
        this.closedWith = code;
        this.cut = true;
        return Effect.ignore(this.writer.write(new Socket.CloseEvent(code, reason)));
      }),
    );
  }
}
