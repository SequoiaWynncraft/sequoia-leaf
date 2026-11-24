import { SERVER_HZ } from "@sequoia-leaf/core";
import { Clock, Context, Duration, Effect, Schedule, type Scope } from "effect";

import type { LiveCounts } from "./counts.ts";
import { noTally, type Room, type Rooms, type Snapshot, type Tally } from "./room.ts";

/**
 * How long a tick is: `SERVER_HZ` a second, to the whole millisecond. A fixed schedule measures its
 * window by a clock in whole milliseconds, so with a fraction in the window its wait comes out under
 * a millisecond again and again at the window's end, which a test clock never moves past.
 */
export const TICK = Duration.millis(Math.floor(1000 / SERVER_HZ));

/**
 * What one of Live's ticks took, for the load test (`LiveMeter`): how much later than a tick after
 * the last it began (`late`), and how long from the first of its rooms' writes to the end of the
 * last (`writing`), in milliseconds; how many rooms sent a snapshot, and what became of each
 * snapshot written (`Tally`).
 */
export interface TickTimes extends Readonly<Tally> {
  readonly late: number;
  readonly writing: number;
  readonly rooms: number;
}

/** Told what each tick took (`TickTimes`), for the load test; nobody is, unless given. */
export const LiveMeter = Context.Reference<((times: TickTimes) => void) | null>("leaf/LiveMeter", {
  defaultValue: () => null,
});

/**
 * A room's snapshot written to everybody it was made for, from the fiber this runs in, each on the
 * connection they had then, and only if it is still for them as their connection is held for it
 * (`Room.reaches`): the fiber may let others run between one write and the next, and a page in
 * another room by then, or on another connection, must never hear this one's. What became of each
 * is counted in `tally`.
 */
const tellRoom = (room: Room, snapshot: Snapshot, tally: Tally) =>
  Effect.forEach(snapshot.to, (r) => r.connection.writeIf(() => room.reaches(r), snapshot.frame, tally), {
    discard: true,
  });

/**
 * Live's tick, every `TICK` for as long as the scope lasts: each room with work (`Rooms.busy`)
 * stops anybody shown walking whose game has gone quiet, and what changed goes to everyone in it,
 * written by this fiber; the snapshots written or put in line are counted as sent. What each tick
 * took goes to the `LiveMeter`, if anybody is told, and is not timed otherwise.
 */
export const ticking = (rooms: Rooms, counts: LiveCounts): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const meter = yield* LiveMeter;
    const clock = yield* Clock.Clock;
    const millis = () => Number(clock.monotonicTimeNanosUnsafe()) / 1e6;
    let tick = 0;
    /** When the last tick began, by the clock that only goes forward, while a meter is told. */
    let tickBegan: number | null = null;
    const flush = Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.suspend(() => {
        tick++;
        const told: [Room, Snapshot][] = [];
        for (const room of rooms.busy()) {
          const snapshot = room.flush(tick, now);
          if (snapshot) told.push([room, snapshot]);
        }
        counts.ticked(told.length);
        const tally = noTally();
        const writes = Effect.forEach(told, ([room, snapshot]) => tellRoom(room, snapshot, tally), { discard: true });
        const sent = Effect.sync(() => counts.sent("motion", tally.direct + tally.queued, tally.bytes));
        if (meter === null) return Effect.andThen(writes, sent);
        const began = millis();
        const late = tickBegan === null ? 0 : began - tickBegan - Duration.toMillis(TICK);
        tickBegan = began;
        return writes.pipe(
          Effect.andThen(sent),
          Effect.andThen(Effect.sync(() => meter({ late, writing: millis() - began, rooms: told.length, ...tally }))),
        );
      }),
    );
    yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(TICK)));
  });
