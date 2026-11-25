import { Duration, Effect, Metric, Schedule, type Scope } from "effect";

import { live as metrics, liveRefused, readOnAsk } from "../metrics.ts";

/** How a connection closed: by its page itself, dropped (no closing at all), or by Leaf. */
export type Closed = "page" | "drop" | "leaf";

/** What Live counts of what it sends: rooms' snapshots (`motion`), and who is about (`about`). */
type Sent = "motion" | "about";

/**
 * What Live has done in the last minute, for its log line: connections opened and closed, frames in
 * and dropped, and openings turned away before their upgrade, by the code they were refused with.
 */
interface Minute {
  opened: number;
  closed: number;
  movesIn: number;
  textsIn: number;
  dropped: number;
  refused: Record<string, number>;
}

const noMinute = (): Minute => ({ opened: 0, closed: 0, movesIn: 0, textsIn: 0, dropped: 0, refused: {} });

/** The census of who is here now. */
export interface Census {
  readonly players: number;
  readonly connected: number;
  readonly rooms: Readonly<Record<string, number>>;
}

/** What a `live` log line says: who is here now, and what happened since the last line, with the frames Leaf told visits' rooms. */
export type LiveLine = Census & Readonly<Minute> & { readonly told: number };

/**
 * What Live counts as it goes: in the last minute, for its log line (`minute`), and since Leaf
 * started, for the metrics (`totals`).
 */
export class LiveCounts {
  minute = noMinute();
  readonly totals = {
    opened: 0,
    closed: { page: 0, drop: 0, leaf: 0 } satisfies Record<Closed, number>,
    dropped: 0,
    handoffs: 0,
    ticks: 0,
    /** Rooms whose tick sent a snapshot. */
    roomsFlushed: 0,
    /** Frames given to players' connections, and their bytes (a text's in UTF-16 code units). */
    sent: {
      motion: { frames: 0, bytes: 0 },
      about: { frames: 0, bytes: 0 },
    } satisfies Record<Sent, { frames: number; bytes: number }>,
  };

  opened(): void {
    this.minute.opened++;
    this.totals.opened++;
  }

  closed(how: Closed): void {
    this.minute.closed++;
    this.totals.closed[how]++;
  }

  dropped(): void {
    this.minute.dropped++;
    this.totals.dropped++;
  }

  /** An opening that handed a player over from one of their pages to another. */
  handedOver(): void {
    this.totals.handoffs++;
  }

  /** A tick, at which this many rooms sent a snapshot. */
  ticked(roomsFlushed: number): void {
    this.totals.ticks++;
    this.totals.roomsFlushed += roomsFlushed;
  }

  /** Frames of a kind given to players' connections, and their bytes together. */
  sent(kind: Sent, frames: number, bytes: number): void {
    this.totals.sent[kind].frames += frames;
    this.totals.sent[kind].bytes += bytes;
  }

  /** An opening turned away before its upgrade, by the code it was refused with. */
  refused(code: string): Effect.Effect<void> {
    return Effect.andThen(
      Effect.sync(() => {
        this.minute.refused[code] = (this.minute.refused[code] ?? 0) + 1;
      }),
      Metric.update(liveRefused({ reason: code }), 1),
    );
  }
}

/**
 * Live's figures for as long as the scope lasts: read when the metrics are asked for (who is here
 * now, from `census`, and the totals), and a log line a minute while anybody is about or anything
 * happened, refusals included. `told` is how many frames Leaf has told visits' rooms since it
 * started (`Watchers`). Gives what the next line would say, so far.
 */
export const reportLive = (
  counts: LiveCounts,
  census: () => Census,
  told: () => number,
): Effect.Effect<Effect.Effect<LiveLine>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { totals } = counts;
    yield* readOnAsk(
      [
        [metrics.players, () => census().players],
        [metrics.connections, () => census().connected],
        [metrics.rooms, () => Object.keys(census().rooms).length],
      ],
      [
        [metrics.opened, () => totals.opened],
        ...(["page", "drop", "leaf"] as const).map(
          (how) => [metrics.closed({ how }), () => totals.closed[how]] as const,
        ),
        [metrics.framesDropped, () => totals.dropped],
        [metrics.handoffs, () => totals.handoffs],
        [metrics.ticks, () => totals.ticks],
        [metrics.roomsFlushed, () => totals.roomsFlushed],
        ...(["motion", "about"] as const).flatMap((kind) => [
          [metrics.framesSent({ kind }), () => totals.sent[kind].frames] as const,
          [metrics.bytesSent({ kind }), () => totals.sent[kind].bytes] as const,
        ]),
      ],
    );
    /** How many frames Leaf had told visits' rooms when the last line was written. */
    let toldBefore = told();
    const line = Effect.sync((): LiveLine => ({
      ...census(),
      ...counts.minute,
      refused: { ...counts.minute.refused },
      told: told() - toldBefore,
    }));
    const report = Effect.flatMap(line, (said) => {
      counts.minute = noMinute();
      toldBefore += said.told;
      if (said.players === 0 && said.opened === 0 && Object.keys(said.refused).length === 0) return Effect.void;
      return Effect.logInfo("live").pipe(Effect.annotateLogs({ ...said }));
    });
    // A minute after Live starts and every minute after. Not at once: a reporter that ran late would
    // empty a minute the first openings had already been counted in.
    yield* Effect.forkScoped(Effect.repeat(Effect.delay(report, Duration.minutes(1)), Schedule.forever));
    return line;
  });
