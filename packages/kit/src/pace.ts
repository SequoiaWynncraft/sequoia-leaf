/**
 * A game's frames, paced by whether the member is at the page. While they are (its window is theirs
 * and they touched it in the last two minutes, or the pointer moved over it a moment ago) a frame is
 * drawn every time the screen shows one. While they are not (another program has the window, as
 * when they play Minecraft beside it, or nobody has touched it for two minutes) a frame comes
 * `REST_FPS` times a second: the game still moves, at a share of the work, and leaves the computer
 * to what the member is doing. A press, a key, the wheel, the pointer or the window coming back
 * wakes it at once. While the page is hidden the browser draws no frames at all.
 */

import type { Release, Scope } from "./scope.ts";

/** Frames a second while the member is not at the page: two for each of the Works' ten ticks a second. */
export const REST_FPS = 20;
/** Untouched this long, in milliseconds, the member has left the page, though its window is theirs. */
export const IDLE_MS = 120_000;
/** A pointer moved over the page this long ago, in milliseconds, keeps it awake in a window not the member's. */
export const HOVER_MS = 2000;
/** The longest step a frame is given while awake, in seconds, so that a stall is not a jump. */
const STEP_MOST = 0.05;
/** How much sooner than a rest's length the next frame is asked for, so that it is the screen's next after one. */
const EARLY_MS = 8;

/** What says whether the member is at the page. */
export interface Attention {
  /** When the member last touched the page: a press, a key, the wheel or the pointer moving over it. */
  readonly touched: number;
  /** Whether the page's window is theirs. */
  readonly focused: boolean;
}

/** Whether the member is at the page at `now`. */
export const isAt = (now: number, a: Attention): boolean => now - a.touched < (a.focused ? IDLE_MS : HOVER_MS);

/** What a loop hears and reads: the page's window and clock, unless a test gives its own. */
export interface Watched {
  readonly target: EventTarget;
  readonly focused: () => boolean;
  readonly now: () => number;
}

const page = (): Watched => ({ target: window, focused: () => document.hasFocus(), now: () => performance.now() });

/** What the member does that says they are at the page; and the window coming back, heard on the window alone. */
const TOUCHES = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

export interface Loop {
  /** Starts it, or, resting, has its next frame drawn at once: the member is at the page. */
  wake(): void;
  /** Asks for no more frames until it is woken. A touch does not wake a loop that was stopped. */
  stop(): void;
}

/**
 * Runs `frame` with the time and the step since the last frame, in seconds, paced as the header
 * says, from `wake` until `stop` or until `sc` closes. The next frame is asked for before this one
 * runs: a fault in one is told to the console and the game goes on.
 */
export function paced(sc: Scope, frame: (now: number, dt: number) => void, at: Watched = page()): Loop {
  let touched = at.now();
  let last = 0;
  let on = false;
  let resting = false;
  let next: Release | null = null;

  function drawNext(): void {
    next?.();
    resting = false;
    next = sc.frame(run);
  }
  function ask(): void {
    const t = at.now();
    resting = !isAt(t, { touched, focused: at.focused() });
    if (!resting) next = sc.frame(run);
    else next = sc.after(Math.max(0, 1000 / REST_FPS - (t - last) - EARLY_MS), () => (next = sc.frame(run)));
  }
  function run(t: number): void {
    const dt = Math.min(resting ? 1.5 / REST_FPS : STEP_MOST, Math.max(0, (t - last) / 1000));
    last = t;
    ask();
    frame(t, dt);
  }
  const touch = (): void => {
    touched = at.now();
    if (on && resting) drawNext();
  };
  for (const kind of TOUCHES) sc.on(at.target, kind, touch, { capture: true, passive: true });
  // Not on the way down: a thing in the page taking the focus is not the window coming back.
  sc.on(at.target, "focus", touch);

  return {
    wake() {
      touched = at.now();
      if (on && !resting) return;
      if (!on) last = touched;
      on = true;
      drawNext();
    },
    stop() {
      on = false;
      next?.();
      next = null;
    },
  };
}
