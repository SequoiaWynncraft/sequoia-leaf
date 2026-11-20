/** URL parameters, for screenshots and for trying the forest in any light, season or moment. */

import type { Season, Time } from "../pixel/palette.ts";

export type EventKind = "raid" | "war" | "levelup";

export interface Params {
  time: Time;
  season: Season;
  /** Freeze the clock (at `t` seconds) so a screenshot is the same every time. */
  still: boolean;
  t: number;
  /** A guild moment that plays on load, and how far into it a still is (`et` seconds). */
  event: EventKind | null;
  et: number;
  /** Where the camera starts: a named place or a nominal world x. */
  at: string | null;
  /** The guild's birthday: the crabs throw a rave. */
  anniversary: boolean;
  /** The member whose tree "Find my tree" finds. */
  me: string;
  /** A member whose tooltip is open on load (for stills). */
  tip: string | null;
  /** A landmark whose tooltip is open on load (for stills). */
  look: string | null;
  /** The debug strip of event buttons. */
  debug: boolean;
  perf: boolean;
  /** Hide the HUD, for clean art reviews. */
  bare: boolean;
}

export function readParams(search: string): Params {
  const q = new URLSearchParams(search);
  const time = q.get("time");
  const season = q.get("season");
  const event = q.get("event");
  return {
    time: time === "day" || time === "night" ? time : "dusk",
    season: season === "winter" ? "winter" : "normal",
    still: q.has("still"),
    t: Number(q.get("t") ?? 2.6) || 0,
    event: event === "raid" || event === "war" || event === "levelup" ? event : null,
    et: Number(q.get("et") ?? -1),
    at: q.get("at"),
    anniversary: q.has("anniversary"),
    me: q.get("me") ?? "Wrenfeather",
    tip: q.get("tip"),
    look: q.get("look"),
    debug: q.has("debug"),
    perf: q.has("perf"),
    bare: q.has("bare"),
  };
}
