import { SERVER_HZ } from "@sequoia-leaf/core";
import { Clock, Context, Duration, Effect, Schedule, type Scope } from "effect";

import type { LiveCounts } from "./counts.ts";
import { noTally, type Rooms, type Snapshot, type Tally } from "./room.ts";

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
 * connection they had then, as the room is when their turn comes (`Snapshot.for`): the fiber may
 * let others run between one write and the next, and a page in another room by then, or on another
 * connection, must never hear this one's, nor anybody hear of somebody they were told has left.
 * What became of each is counted in `tally`; says whether anybody was sent it.
 */
const tellRoom = (snapshot: Snapshot, tally: Tally): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const before = tally.direct + tally.queued;
    const writes = Effect.forEach(snapshot.to, (r) => r.connection.writeIf(() => snapshot.for(r), tally), {
      discard: true,
    });
    return Effect.map(writes, () => tally.direct + tally.queued > before);
  });

/**
 * Live's tick, every `TICK` for as long as the scope lasts: each room with work (`Rooms.busy`)
 * stops anybody shown walking whose game has gone quiet, and what changed goes to everyone in it,
 * written by this fiber (each pipe counts what it takes as motion sent); a room counts as told once
 * somebody in it was sent its snapshot. What each tick took goes to the `LiveMeter`, if anybody is
 * told, and is not timed otherwise.
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
        const snapshots: Snapshot[] = [];
        for (const room of rooms.busy()) {
          const snapshot = room.flush(tick, now);
          if (snapshot) snapshots.push(snapshot);
        }
        const tally = noTally();
        const writes = Effect.map(
          Effect.forEach(snapshots, (snapshot) => tellRoom(snapshot, tally)),
          (told) => told.filter(Boolean).length,
        );
        const counted = Effect.map(writes, (told) => {
          counts.ticked(told);
          return told;
        });
        if (meter === null) return Effect.asVoid(counted);
        const began = millis();
        const late = tickBegan === null ? 0 : began - tickBegan - Duration.toMillis(TICK);
        tickBegan = began;
        return Effect.map(counted, (told) => meter({ late, writing: millis() - began, rooms: told, ...tally }));
      }),
    );
    yield* Effect.forkScoped(Effect.repeat(flush, Schedule.fixed(TICK)));
  });
