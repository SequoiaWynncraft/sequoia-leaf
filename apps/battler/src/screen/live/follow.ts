/**
 * A follower: keeps the page's copy of something of Leaf's (the member's sitting, the open tables) as
 * new as it has been told, one read at a time. Anything that says "read again" (Leaf's word, the live
 * room coming back, the page coming back, a deadline, a poll) asks for one (`want`), and `wanted` goes
 * up; `had` is the `wanted` that the last read to land started at. Whenever no read is on its way and
 * `wanted` is past `had`, one starts: `GATHER_MS` after the ask, so that asks close together make one
 * read, or after one that failed, on the kit's timer (`RETRY`), longer each time, until one lands.
 * Nothing else decides when to read.
 *
 * What a read gives back says how it went (`Went`): it landed (`had` is what it started at); it
 * failed (tried again on the timer); not now (it waits for its owner to say it may go, `kick`, which
 * may come while it is on its way); or stop, for good. Whether to take an answer is the reader's: it
 * takes it only if it is newer than what the page holds.
 */
import { backoff } from "@sequoia-leaf/kit/net.ts";
import { RETRY } from "@sequoia-leaf/kit/play.ts";
import type { Scope } from "@sequoia-leaf/kit/scope.ts";

/** How long after an ask the read starts, so that asks close together (one write's words, a deadline as one comes) make one read. */
export const GATHER_MS = 25;

/** How a read went: landed, failed, not now, or the end of following. */
export type Went = "landed" | "failed" | "later" | "stop";

export interface Follower {
  /** Something says read again: a read is owed until one that starts after this lands. */
  want(): void;
  /** The owner says a read put off (`later`) may go now; nothing if none is owed. */
  kick(): void;
  /** Whether a read is owed: asked for since the last one that landed started. */
  owed(): boolean;
  /** No more reads. */
  stop(): void;
}

/** Where a follower is: nothing to do, waiting to start a read, reading, or done. */
type At = "idle" | "waiting" | "reading" | "stopped";

/** Follows with `read`, its timers on `scope`. */
export function follower(scope: Scope, read: () => Promise<Went>): Follower {
  const f: { wanted: number; had: number; misses: number; at: At; kicked: boolean } = {
    wanted: 0,
    had: 0,
    misses: 0,
    at: "idle",
    kicked: false,
  };
  const went = (result: Went, started: number): void => {
    if (f.at === "stopped") return;
    f.at = "idle";
    if (result === "stop") {
      f.at = "stopped";
      return;
    }
    if (result === "landed") {
      f.had = Math.max(f.had, started);
      f.misses = 0;
    } else if (result === "failed") f.misses++;
    // Put off: only once its owner has said it may go, since it started or now.
    if (result !== "later" || f.kicked) pump();
  };
  const start = (): void => {
    if (f.at !== "waiting") return;
    f.at = "reading";
    f.kicked = false;
    const started = f.wanted;
    void read().then(
      (result) => went(result, started),
      () => went("failed", started),
    );
  };
  function pump(): void {
    if (f.at !== "idle" || f.wanted <= f.had) return;
    f.at = "waiting";
    scope.after(f.misses > 0 ? backoff(RETRY, f.misses - 1) : GATHER_MS, start);
  }
  return {
    want() {
      if (f.at === "stopped") return;
      f.wanted++;
      pump();
    },
    kick() {
      f.kicked = true;
      pump();
    },
    owed: () => f.wanted > f.had,
    stop() {
      f.at = "stopped";
    },
  };
}
