/**
 * When and where a page draws the other players in its room: the moment of Leaf's clock to draw them
 * at (`Playout`), and each one's motion as snapshots told it (`Track`). Pure: `realtime.ts` feeds
 * them what arrives, and a page asks it where somebody is to be drawn.
 */

import { INTERP_MS, type Motion } from "@sequoia-leaf/core";

// ---------- when to draw others ----------

/** How many of the latest snapshots' times on the way the playout goes by. */
const TRANSITS = 40;
/** The most the slowest snapshots lately may put the moment drawn back, in milliseconds, however uneven the network. */
const MOST_UNEVEN = 1500;
/** How much faster or slower than its own clock the moment drawn may run while it settles: a tenth. */
const SETTLE = 0.1;

/**
 * The moment of Leaf's clock to draw others at. A snapshot stamped `time` reaches this page some
 * while later by its own clock: the network's delay, and how far the two clocks differ, together.
 * The page draws at its own clock less the time most snapshots lately took (all but the slowest
 * tenth), less `INTERP_MS`, so that the moment drawn has a snapshot on either side of it however
 * slow and uneven the network is. Drawn behind Leaf's clock as it is instead, a page whose snapshots
 * take longer than `INTERP_MS` would have nothing past the newest to draw but a guess, and somebody
 * stopping or turning would be seen overshooting and coming back. The moment drawn settles towards
 * a new delay by at most a tenth of the time passing, so that nobody is ever drawn jumping or going
 * back when the network changes.
 */
export class Playout {
  private readonly transits: number[] = [];
  /** How far behind this page's clock the moment drawn is, and when that was last worked out. */
  private behind: number | null = null;
  private at = 0;

  /** A snapshot stamped `time` by Leaf's clock came at `now` by this page's. */
  heard(time: number, now: number): void {
    this.transits.push(now - time);
    if (this.transits.length > TRANSITS) this.transits.shift();
  }

  /** The moment of Leaf's clock to draw others at, at `now` by this page's clock; null before any snapshot came. */
  time(now: number): number | null {
    if (this.transits.length === 0) return null;
    const sorted = this.transits.toSorted((a, b) => a - b);
    const quickest = sorted[0] ?? 0;
    const most = sorted[Math.ceil((sorted.length - 1) * 0.9)] ?? quickest;
    const want = quickest + Math.min(most - quickest, MOST_UNEVEN) + INTERP_MS;
    if (this.behind === null) this.behind = want;
    else {
      const step = Math.max(0, now - this.at) * SETTLE;
      this.behind += Math.max(-step, Math.min(step, want - this.behind));
    }
    this.at = now;
    return now - this.behind;
  }
}

// ---------- somebody's track ----------

/** The longest a track keeps, in milliseconds of Leaf's clock. */
const KEEP_MS = 2500;

/** Somebody's motion as snapshots told it, and where they are to be drawn at any moment of Leaf's clock. */
export class Track {
  private readonly points: { time: number; m: Motion }[] = [];

  add(time: number, m: Motion): void {
    const last = this.points.at(-1);
    if (last && time < last.time) return;
    if (last && time === last.time) this.points.pop();
    this.points.push({ time, m });
    while (this.points.length > 2 && (this.points[1]?.time ?? 0) < time - KEEP_MS) this.points.shift();
  }

  /**
   * Where they are at `time`: between the snapshots either side of it, or where the newest has them
   * if none is newer yet: never anywhere they have not been. Between two snapshots with different
   * jumps they are drawn where they were, then where they jumped to, never on the way.
   */
  at(time: number): Motion | null {
    const pts = this.points;
    const first = pts[0];
    const last = pts.at(-1);
    if (!first || !last) return null;
    if (time <= first.time) return first.m;
    if (time >= last.time) return last.m;
    let i = pts.length - 1;
    while (i > 0 && (pts[i - 1]?.time ?? 0) > time) i--;
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) return last.m;
    if (a.m.jump !== b.m.jump) return a.m;
    const k = (time - a.time) / Math.max(1, b.time - a.time);
    return { ...a.m, x: a.m.x + (b.m.x - a.m.x) * k, y: a.m.y + (b.m.y - a.m.y) * k };
  }
}
