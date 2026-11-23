/**
 * Where the stage is, as one value: a place being played in, night falling on the member walking
 * off to another, night lifting on them walking in, or the view closing in on a game's door, the
 * game open over the town, and the view opening out again. Only `next` moves it, so every way from
 * one to another is a transition with a test (`screen.test.ts`); `main.ts` holds it and does what
 * each change means, in one place.
 */

import type { Pt } from "@sequoia-leaf/kit/util.ts";

import type { GameId } from "./games.ts";

/** A place that can be on the stage. */
export type Place = "town" | "camp" | "grove";

/** How long the view takes to close in on a door, and to open out again, in seconds. */
export const CLOSE_IN = 0.55;
/** How long night takes to close in on somebody walking off to another place, and to lift on them walking in. */
export const NIGHTFALL = 0.6;
export const DAYBREAK = 0.75;
/** How long the member walks off, at most, before night begins to fall, in seconds. */
export const LEAD = 0.9;
/** Night lifting has got this light when the member may move about again. */
export const AWAKE = 0.35;

/**
 * The stage's state. `T` is where a walk is to (a place, and whatever setting out there needs);
 * `V` is a game's open door. `lead` is how long the member walks off before night begins to fall;
 * `onward` is a walk asked for while the view opens out, set off on once it is open.
 */
export type Screen<T extends { readonly place: Place }, V> =
  | { readonly at: "playing"; readonly place: Place }
  | { readonly at: "dusk"; readonly from: Place; readonly to: T; readonly lead: number; readonly dark: number }
  | { readonly at: "dawn"; readonly place: Place; readonly dark: number }
  | {
      readonly at: "closing";
      readonly place: Place;
      readonly game: GameId;
      readonly door: Pt;
      readonly visit: V;
      readonly open: number;
    }
  | { readonly at: "inside"; readonly place: Place; readonly game: GameId; readonly door: Pt; readonly visit: V }
  | {
      readonly at: "opening";
      readonly place: Place;
      readonly game: GameId;
      readonly door: Pt;
      readonly open: number;
      readonly onward: T | null;
    };

/**
 * What moves it: time passing (`near`, the member's walk off has as little left as night begins
 * at); a walk off to another place; a game's door gone through; the game put away.
 */
export type Cue<T, V> =
  | { readonly kind: "tick"; readonly dt: number; readonly near: boolean }
  | { readonly kind: "walk"; readonly to: T }
  | { readonly kind: "door"; readonly game: GameId; readonly door: Pt; readonly visit: V }
  | { readonly kind: "back" };

/** The place on the stage: the one being walked off from, until night has closed in. */
export const placeOf = (s: Screen<{ readonly place: Place }, unknown>): Place => (s.at === "dusk" ? s.from : s.place);

/** How far night has closed in: 0 for not at all, 1 for dark. */
export const darkOf = (s: Screen<{ readonly place: Place }, unknown>): number =>
  s.at === "dusk" || s.at === "dawn" ? s.dark : 0;

/** How open the view is round a game's door: 1 for the whole view, 0 for shut. */
export const openOf = (s: Screen<{ readonly place: Place }, unknown>): number =>
  s.at === "closing" || s.at === "opening" ? s.open : s.at === "inside" ? 0 : 1;

/** Whether a game is open, or being gone into: the town is not where the member is meanwhile. */
export const inGame = (s: Screen<{ readonly place: Place }, unknown>): boolean =>
  s.at === "closing" || s.at === "inside";

/** Whether the member may move about and act: in a place, and not walking off or still in the dark of walking in. */
export const mayAct = (s: Screen<{ readonly place: Place }, unknown>): boolean =>
  s.at === "playing" || (s.at === "dawn" && s.dark < AWAKE);

/** Whether a walk off asked now is taken: at once, from a place or while night lifts on it; or once the view has opened out of a door. */
export const takesWalk = (s: Screen<{ readonly place: Place }, unknown>): boolean =>
  s.at === "playing" || s.at === "dawn" || s.at === "opening";

/** A walk somewhere from a place: anywhere but the place itself, unless it is a camp, which may be another camp. */
const elsewhere = (from: Place, to: Place): boolean => to !== from || to === "camp";

/** The stage after a cue. One it has no use for where it is leaves it as it was (the same value). */
export function next<T extends { readonly place: Place }, V>(s: Screen<T, V>, cue: Cue<T, V>): Screen<T, V> {
  switch (cue.kind) {
    case "tick":
      return tick(s, cue.dt, cue.near);
    case "walk":
      if (!takesWalk(s) || !elsewhere(placeOf(s), cue.to.place)) return s;
      if (s.at === "playing") return { at: "dusk", from: s.place, to: cue.to, lead: LEAD, dark: 0 };
      // Asked while night lifts: it falls again from where it has got to.
      if (s.at === "dawn") return { at: "dusk", from: s.place, to: cue.to, lead: 0, dark: s.dark };
      // Asked while the view opens out of a door: set off on once it is open; the first asked, so
      // that every walk taken is walked.
      if (s.at === "opening") return s.onward === null ? { ...s, onward: cue.to } : s;
      return s;
    case "door":
      if (!mayAct(s)) return s;
      return { at: "closing", place: placeOf(s), game: cue.game, door: cue.door, visit: cue.visit, open: 1 };
    case "back":
      if (s.at === "closing" || s.at === "inside")
        return { at: "opening", place: s.place, game: s.game, door: s.door, open: openOf(s), onward: null };
      return s;
  }
}

function tick<T extends { readonly place: Place }, V>(s: Screen<T, V>, dt: number, near: boolean): Screen<T, V> {
  if (dt <= 0) return s;
  switch (s.at) {
    case "playing":
    case "inside":
      return s;
    case "dusk": {
      if (s.lead > 0) return { ...s, lead: near ? 0 : Math.max(0, s.lead - dt) };
      const dark = Math.min(1, s.dark + dt / NIGHTFALL);
      return dark >= 1 ? { at: "dawn", place: s.to.place, dark: 1 } : { ...s, dark };
    }
    case "dawn": {
      const dark = Math.max(0, s.dark - dt / DAYBREAK);
      return dark <= 0 ? { at: "playing", place: s.place } : { ...s, dark };
    }
    case "closing": {
      const open = Math.max(0, s.open - dt / CLOSE_IN);
      return open <= 0 ? { at: "inside", place: s.place, game: s.game, door: s.door, visit: s.visit } : { ...s, open };
    }
    case "opening": {
      const open = Math.min(1, s.open + dt / CLOSE_IN);
      if (open < 1) return { ...s, open };
      return s.onward === null
        ? { at: "playing", place: s.place }
        : { at: "dusk", from: s.place, to: s.onward, lead: LEAD, dark: 0 };
    }
  }
}
