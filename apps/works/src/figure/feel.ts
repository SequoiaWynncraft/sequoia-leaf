/**
 * The numbers that tune how being somebody in the yard feels, together, each with what it is and its
 * unit. Paces themselves are the rules' (`WALK` and `RUN` in the factory's `footing.ts`); everything
 * here is the page's own. They were carried over from Outworks (`apps/page/src/feel.ts`), which took
 * most of them from the town.
 */

/** How a figure walks and runs. */
export const GAIT = {
  /** Pixels walked between two poses of a walk: a walk's four poses are 20 pixels, and a foot comes down every 10. */
  walkPose: 5,
  /** Pixels run between two poses of a run: a longer stride, so the legs go 8 steps a second where a walk's go 6.4. */
  runPose: 8,
  /** Seconds a figure keeps going by the keys before it breaks into a run. */
  runAfter: 0.7,
  /** Pixels of a tapped way beyond which the figure runs it: ten tiles. */
  runFar: 160,
  /** Pixels before the end of a run way at which it comes down to a walk, so it arrives walking. */
  arriveWalking: 24,
  /** Seconds from a walk up to a run. */
  runUp: 0.22,
  /** Seconds a figure takes to pull up out of a run when it is told to stop: two short steps, never a slide. */
  pullUp: 0.1,
  /** How much further one way must be than the other before a figure turns to face it: stops it flickering on a diagonal. */
  turnBy: 1.25,
  /** How near the end of a way counts as there, in pixels. */
  there: 0.75,
} as const;

/** A figure that is put aside hops: seconds a hop takes, and the pixels it rises. */
export const HOP = { seconds: 0.3, high: 5 } as const;

/** A figure at rest is not a statue. */
export const REST = {
  /** Seconds after stopping before it settles. */
  after: 0.5,
  /** Seconds from one breath to the next, and how long each is held. */
  breathEvery: 2.6,
  breathFor: 0.9,
  /** Seconds from one blink to the next, and how long its eyes stay shut. */
  blinkEvery: 3.7,
  blinkFor: 0.13,
} as const;

/** What one footfall, or one pull-up out of a run, raises: how many bits, how many of those two pixels across, how far they rise, and the seconds they live. */
export interface Raised {
  readonly bits: number;
  readonly big: number;
  readonly rise: number;
  readonly life: number;
}

/**
 * What feet raise from the ground, by what it is: bare ground (earth, sand, stone) gives dust, which
 * drifts up as it slows; grass gives blades, flicked up and falling back to the row they were raised
 * from, and nothing at a walk. Each is the colour of the ground it was raised from.
 */
export const UNDERFOOT: Readonly<Record<"bare" | "grass", { walk: Raised | null; run: Raised; pullUp: Raised }>> = {
  bare: {
    walk: { bits: 1, big: 0, rise: 3, life: 0.3 },
    run: { bits: 3, big: 1, rise: 4, life: 0.35 },
    pullUp: { bits: 4, big: 1, rise: 4, life: 0.35 },
  },
  grass: {
    walk: null,
    run: { bits: 1, big: 0, rise: 4, life: 0.25 },
    pullUp: { bits: 2, big: 0, rise: 4, life: 0.25 },
  },
};

/** The view, as it goes with the figure. */
export const VIEW = {
  /**
   * How fast the view closes on the figure, as a share of what is left each second. The town moves
   * its view 0.12 of the way each frame, which at 60 frames a second leaves it 7.8 pixels behind a
   * walk; this is that, worked out so that it is the same at any frame rate.
   */
  catchUp: 8.2,
  /** The most the view is left behind, in pixels: at a run it closes faster, to keep to this. */
  behindMost: 7.8,
  /**
   * A view that took hold of its figure from somewhere else closes what lies between them by this
   * share of what is left each second while the figure walks: half of it in about a third of a second.
   */
  gather: 2.2,
  /** The same when the player asked for the view back: all but there in a second. */
  home: 5,
  /** The same while the figure is off the screen: it is in sight within about half a second, by a glide. */
  bringIn: 7,
  /** How far inside the screen's edge a figure must be to count as in sight, in pixels: a figure and a half. */
  inSight: 36,
} as const;

/** The shade on the ground under a figure: its colour, the town's. */
export const SHADE = "rgba(20,10,28,0.34)";
