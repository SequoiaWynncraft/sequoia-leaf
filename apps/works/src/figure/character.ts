/**
 * A figure as it moves (`Figure`), and the player's own (`Character`). Walking is the town's walking:
 * its pace, the length of its step, a start and a stop that take no time, a hop when it is put aside.
 * To that it adds a run for a figure that keeps going, and a figure at rest that breathes and blinks.
 * The numbers are in `feel.ts`. Carried over from Outworks (`apps/page/src/walker.ts`).
 *
 * The player's character is moved on the page at once, by the keys held or along a way found round
 * whatever is solid (`way.ts`, by the yard's own rule: `footing.ts` in the factory). Where it is, is
 * told a straight stretch at a time (`tell`), and it never takes a step the rule would not let stand
 * from where it was last told: before it moves, the stretch from there to where it would be is
 * checked (`blocked`); where a turn has made that stretch cross something, the turn is told first.
 * Nobody hears it yet; when visitors walk, Leaf will check those stretches by the same rule.
 */
import { blocked, freed, kept, type Place, RUN, type Solid, SUB, TILE_PX, unsound, WALK } from "@sequoia-leaf/factory";
import { type Dir, POSE, RUN as RUNNING, WALK as WALKING } from "@sequoia-leaf/kit/skin.ts";

import { GAIT, HOP, REST } from "./feel.ts";
import { findWay } from "./way.ts";

/** Frames of getting nowhere after which a way is looked for again, and after which it is given up. */
const LOST_AGAIN = 2;
const LOST_MOST = 12;
/**
 * The least a character moves in one go, in pixels: two of the parts a place is kept to. A frame too
 * short to walk that far is saved up for the next, so that on a screen that draws a thousand frames a
 * second the keeping of places to sixteenths does not round its walking away.
 */
const LEAST_STEP = 2 / SUB;
/** How often where it is, is told while it goes, in seconds; a turn is told at once. */
const TELL_EVERY = 0.05;

/** The ways a figure faces, as the kit's frames have them. */
const FACING = { down: 0, left: 1, right: 2, up: 3 } as const;

/** A figure, however it is moved: which way it faces, how its legs go, its hop, and how it rests. */
export class Figure {
  /** Where its feet are, in pixels of the art. */
  x: number;
  y: number;
  way: Dir = FACING.down;
  moving = false;
  running = false;
  /** How far its legs have gone, in poses of its walk or run. */
  #poses = 0;
  /** Seconds it has stood still. */
  #rested = 0;
  /** Seconds left of the hop it is in. */
  #hop = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /**
   * Turns to face the way a move goes. It keeps the way it faces until the other is further by
   * `GAIT.turnBy`, so that a way near the diagonal does not turn it back and forth.
   */
  protected turn(dx: number, dy: number): void {
    const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
    if (ax < 0.001 && ay < 0.001) return;
    const sideways = this.way === FACING.left || this.way === FACING.right;
    const across = sideways ? ax * GAIT.turnBy >= ay : ax > ay * GAIT.turnBy;
    this.way = across ? (dx < 0 ? FACING.left : FACING.right) : dy < 0 ? FACING.up : FACING.down;
  }

  /** Its legs go `gone` pixels in a frame of `dt` seconds, at a walk or a run. Gives back whether a foot came down. */
  protected legs(gone: number, running: boolean, dt: number): boolean {
    const was = this.moving;
    this.moving = gone > 0.001;
    this.running = this.moving && running;
    if (!this.moving) {
      this.#rested += dt;
      return false;
    }
    this.#rested = 0;
    // Setting off, the first foot comes down almost at once.
    if (!was) this.#poses = 0.7;
    const before = Math.floor(this.#poses);
    this.#poses += gone / (running ? GAIT.runPose : GAIT.walkPose);
    const now = Math.floor(this.#poses);
    return now !== before && now % 2 === 1;
  }

  /** Hops once; asked again while hopping, it finishes the hop it is in. */
  hop(): void {
    if (this.#hop <= 0) this.#hop = HOP.seconds;
  }

  /** What passes on a figure whatever moves it: its hop. */
  protected passing(dt: number): void {
    if (this.#hop > 0) this.#hop -= dt;
  }

  /** How far off the ground a hop has it, in pixels. */
  get lift(): number {
    return this.#hop > 0 ? Math.abs(Math.sin((1 - this.#hop / HOP.seconds) * Math.PI)) * HOP.high : 0;
  }

  /** The pose it is drawn in (the kit's `POSE`): a step of its walk or its run, or at rest a breath now and then and a blink. */
  get pose(): number {
    if (this.moving) return (this.running ? RUNNING : WALKING)[Math.floor(this.#poses) % 4] ?? POSE.stand;
    const rest = this.#rested - REST.after;
    if (rest < 0) return POSE.stand;
    if (rest % REST.blinkEvery < REST.blinkFor) return POSE.blink;
    return rest % REST.breathEvery < REST.breathFor ? POSE.breath : POSE.stand;
  }
}

/** What the player's feet did, for whoever makes the sounds and the dust. */
export interface Footing {
  /** A foot came down, at a walk or a run. */
  step(run: boolean): void;
  /** It pulled up out of a run. */
  pullUp(): void;
  /** It ran into something solid. */
  bump(): void;
  /** It was put aside from where something was built. */
  aside(): void;
}

/** The way a character is walking, found round whatever is solid: the points still to walk to, and where it was sent. */
interface Going {
  readonly points: Place[];
  readonly to: Place;
  /** Whether the points lead all the way; if not, the way is looked for again from their end. */
  readonly whole: boolean;
  /** Whether it is far enough to run. */
  readonly runs: boolean;
}

const length = (from: Place, points: readonly Place[]): number => {
  let far = 0;
  let at = from;
  for (const p of points) {
    far += Math.hypot(p.x - at.x, p.y - at.y);
    at = p;
  }
  return far;
};

/** The player's character. */
export class Character extends Figure {
  /** How fast it is going now, in pixels a second. */
  speed = 0;
  #steer = { dx: 0, dy: 0 };
  /** Seconds it has kept going by the keys. */
  #held = 0;
  #going: Going | null = null;
  /** The way it last went, a pixel long: a figure pulling up out of a run goes on that way. */
  #heading = { dx: 0, dy: 0 };
  /** Where it was last told it was, and the seconds since. */
  #told: Place;
  #since = 0;
  /** Whether it is up against something, so that a bump is told once. */
  #stopped = false;
  /** Frames in a row that walking its way has got it nowhere. */
  #lost = 0;
  /** Seconds of frames too short to move in, saved up. */
  #owed = 0;
  /**
   * The part of its going that was too small for the sixteenths places are kept to, carried to its
   * next step: without it every step would be rounded the same way, and the pace would be a little
   * slow or a little fast by how long a frame happens to be.
   */
  #restX = 0;
  #restY = 0;
  readonly #tell: (x: number, y: number) => void;
  readonly #feet: Footing;

  /** `tell` hears where it is, a stretch at a time; `feet` hears what the feet do. */
  constructor(x: number, y: number, tell: (x: number, y: number) => void, feet: Footing) {
    super(kept(x), kept(y));
    this.#told = { x: this.x, y: this.y };
    this.#tell = tell;
    this.#feet = feet;
  }

  /** The keys held say which way to go (0, 0 for none). Steering lets go of any place being walked to. */
  steer(dx: number, dy: number): void {
    this.#steer = { dx, dy };
    if (dx !== 0 || dy !== 0) this.#going = null;
  }

  /** Whether the keys are steering it. */
  get steered(): boolean {
    return this.#steer.dx !== 0 || this.#steer.dy !== 0;
  }

  /** Sets off for a place, round whatever is solid; as near as it can get where there is no way. Gives back whether there is anywhere to go. */
  goTo(solid: Solid, x: number, y: number): boolean {
    const way = findWay(solid, this, { x, y });
    const runs = length(this, way.points) > GAIT.runFar;
    this.#lost = 0;
    this.#going = way.points.length === 0 ? null : { points: way.points, to: { x, y }, whole: way.whole, runs };
    return this.#going !== null;
  }

  /** Whether it is walking to a place, and the place its way ends at. */
  get going(): boolean {
    return this.#going !== null;
  }
  get bound(): Place | null {
    return this.#going?.points.at(-1) ?? null;
  }

  /** It is put somewhere: it stands there. */
  put(x: number, y: number): void {
    this.x = kept(x);
    this.y = kept(y);
    this.#told = { x: this.x, y: this.y };
    this.#going = null;
    this.speed = 0;
    this.#restX = 0;
    this.#restY = 0;
  }

  /** Tells where it is, if that is not where it was last told. */
  #say(): void {
    this.#since = 0;
    if (this.x === this.#told.x && this.y === this.#told.y) return;
    this.#told = { x: this.x, y: this.y };
    this.#tell(this.x, this.y);
  }

  /**
   * Goes straight to a place if the rule would let it: the stretch from where it was last told must
   * be clear. Where only a turn stands in the way of that, the turn is told first.
   */
  #to(solid: Solid, x: number, y: number): boolean {
    const [wx, wy] = [x + this.#restX, y + this.#restY];
    const [tx, ty] = [kept(wx), kept(wy)];
    if (blocked(solid, this.#told.x, this.#told.y, tx, ty) !== null) {
      if (blocked(solid, this.x, this.y, tx, ty) !== null) return false;
      this.#say();
    }
    this.x = tx;
    this.y = ty;
    this.#restX = wx - tx;
    this.#restY = wy - ty;
    return true;
  }

  /** How fast it goes this frame, toward the pace wanted: a walk starts at once, a run is come up to and pulled up from. */
  #pace(want: number, dt: number): number {
    if (this.speed < WALK) this.speed = WALK;
    const up = ((RUN - WALK) / GAIT.runUp) * dt;
    const down = ((RUN - WALK) / GAIT.pullUp) * dt;
    this.speed = want > this.speed ? Math.min(want, this.speed + up) : Math.max(want, this.speed - down);
    return this.speed * dt;
  }

  /** A frame of going where the keys say, sliding along whatever is solid. Gives back how far it went. */
  #byKeys(solid: Solid, dx: number, dy: number, dt: number): number {
    this.#held += dt;
    const far = this.#pace(this.#held >= GAIT.runAfter ? RUN : WALK, dt);
    const reach = Math.hypot(dx, dy);
    const [sx, sy] = [(dx / reach) * far, (dy / reach) * far];
    const [x, y] = [this.x, this.y];
    // As the town has it: on a diagonal a figure faces across.
    this.way = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? FACING.left : FACING.right) : dy < 0 ? FACING.up : FACING.down;
    if (!this.#to(solid, x + sx, y + sy)) {
      const across = sx !== 0 && this.#to(solid, x + sx, y);
      const down = sy !== 0 && this.#to(solid, this.x, y + sy);
      // Right up against it: as near as half a step, or a quarter.
      if (!across && !down && !this.#to(solid, x + sx / 2, y + sy / 2)) this.#to(solid, x + sx / 4, y + sy / 4);
    }
    return Math.hypot(this.x - x, this.y - y);
  }

  /** The way is looked for again from here: it led only part of the way, or something has come to stand on it. */
  #again(solid: Solid): void {
    const going = this.#going;
    if (going === null) return;
    const [x, y] = [this.x, this.y];
    const next = findWay(solid, this, going.to);
    const end = next.points.at(-1);
    // A way that gets no nearer is the end of it.
    const nearer = end !== undefined && Math.hypot(end.x - x, end.y - y) > 4;
    this.#going = nearer ? { ...going, points: next.points, whole: next.whole } : null;
  }

  /**
   * A frame of walking the way found. Gives back how far it went. Where it cannot go straight on to
   * the next point (it is a hair off its line at a corner, or something has come to stand there), it
   * steps aside along whichever of across and down is clear; where that gets it nowhere the way is
   * looked for again, and after a few frames of nowhere it gives the way up, never stands going.
   */
  #byWay(solid: Solid, going: Going, dt: number): number {
    const left = length(this, going.points);
    let far = this.#pace(going.runs && left > GAIT.arriveWalking ? RUN : WALK, dt);
    const [x, y] = [this.x, this.y];
    while (far > 0) {
      const p = going.points[0];
      if (p === undefined) break;
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      this.turn(p.x - this.x, p.y - this.y);
      const all = d <= Math.max(far, GAIT.there);
      const k = all ? 1 : far / d;
      const [sx, sy] = [(p.x - this.x) * k, (p.y - this.y) * k];
      if (!this.#to(solid, this.x + sx, this.y + sy)) {
        this.#sidle(solid, sx, sy);
        break;
      }
      far -= d;
      if (all) going.points.shift();
    }
    const gone = Math.hypot(this.x - x, this.y - y);
    this.#lost = gone > 0.001 ? 0 : this.#lost + 1;
    if (this.#lost >= LOST_MOST) this.#going = null;
    else if (this.#lost === LOST_AGAIN) this.#again(solid);
    else if (going.points.length === 0) this.#arrived(solid, going);
    return gone;
  }

  /** A step aside toward where it was going, along whichever of across and down is clear. */
  #sidle(solid: Solid, sx: number, sy: number): void {
    const across = Math.abs(sx) > 0.01 && this.#to(solid, this.x + sx, this.y);
    if (!across && Math.abs(sy) > 0.01) this.#to(solid, this.x, this.y + sy);
  }

  /** The last point of a way is reached: it is there, or, where the way led only part of the way, it looks again from here. */
  #arrived(solid: Solid, going: Going): void {
    if (going.whole) this.#going = null;
    else this.#again(solid);
  }

  /** A frame with nowhere to go: a walk stops at once; a run is pulled up in a step or two, on the way it was going. */
  #pullUp(solid: Solid, dt: number): number {
    this.#held = 0;
    if (this.speed <= WALK) {
      this.speed = 0;
      this.#restX = 0;
      this.#restY = 0;
      return 0;
    }
    if (this.speed >= RUN) this.#feet.pullUp();
    const far = this.#pace(WALK, dt);
    const [x, y] = [this.x, this.y];
    if (!this.#to(solid, x + this.#heading.dx * far, y + this.#heading.dy * far)) this.speed = 0;
    return Math.hypot(this.x - x, this.y - y);
  }

  /** A frame of going wherever it is going, by the keys, along its way, or pulling up. Gives back how far it went. */
  #go(solid: Solid, dt: number): number {
    const [x, y] = [this.x, this.y];
    const { dx, dy } = this.#steer;
    const going = this.#going;
    const keyed = dx !== 0 || dy !== 0;
    let gone = 0;
    if (keyed) gone = this.#byKeys(solid, dx, dy, dt);
    else if (going !== null) gone = this.#byWay(solid, going, dt);
    else gone = this.#pullUp(solid, dt);
    if (gone > 0.001) this.#heading = { dx: (this.x - x) / gone, dy: (this.y - y) / gone };
    // Up against something: the run is lost, and a figure that ran into it says so once.
    if (keyed && gone <= 0.001) {
      if (!this.#stopped && this.speed > WALK + 8) this.#feet.bump();
      this.#stopped = true;
      this.#held = 0;
      this.speed = 0;
    } else this.#stopped = false;
    return gone;
  }

  /** A frame's moving, `dt` seconds of it, on ground where `solid` says what is solid. */
  step(dt: number, solid: Solid): void {
    this.passing(dt);
    if (dt <= 0) return;
    this.#owed += dt;
    if (this.#owed * WALK < LEAST_STEP) return;
    this.#moved(this.#owed, solid);
    this.#owed = 0;
  }

  /** So many seconds' moving, never fewer than move it `LEAST_STEP`. */
  #moved(dt: number, solid: Solid): void {
    // Something was built where it stands: it is put on the clear ground nearest.
    if (unsound(solid, this.x, this.y) !== null) {
      const out = freed(solid, this.x, this.y);
      if (out.x !== this.x || out.y !== this.y) this.aside(out.x, out.y);
    }
    const gone = this.#go(solid, dt);
    const was = this.moving;
    if (this.legs(gone, this.speed > (WALK + RUN) / 2, dt)) this.#feet.step(this.running);
    this.#since += dt;
    // Where it is, is told every so often while it goes, and at once when it stops.
    if (this.moving ? this.#since >= TELL_EVERY : was) this.#say();
  }

  /** Puts the character aside to a clear place, with a hop, and tells where. */
  aside(x: number, y: number): void {
    this.put(x, y);
    this.hop();
    this.#tell(this.x, this.y);
    this.#feet.aside();
  }

  /** The tile it stands on. */
  get tile(): { readonly x: number; readonly y: number } {
    return { x: Math.floor(this.x / TILE_PX), y: Math.floor(this.y / TILE_PX) };
  }
}
