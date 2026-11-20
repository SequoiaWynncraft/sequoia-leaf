/**
 * URL parameters, for screenshots and for trying any scene at any level, seed, light, season or
 * moment. Every lab's parameters still work; each scene reads the ones it knows.
 */

import { type RankName, RANKS, type Season, type Time } from "../engine/palette.ts";
import { LEVEL_MAX } from "./rules.ts";

export type Tool = "water" | "shears" | "mist";
export type EventKind = "raid" | "war" | "levelup";
export type CampLayout = "normal" | "pip" | "phone";

export interface Params {
  // Everywhere.
  time: Time;
  /** `time=` was given; otherwise the glade follows the member's clock. */
  timeFromUrl: boolean;
  /** `season=`, or winter from December 1 to the end of February by the local date. */
  season: Season;
  /** Freeze the clock (at `t` seconds) so a screenshot is the same every time. */
  still: boolean;
  t: number;
  /** Mean and worst render time in `document.body.dataset`. */
  perf: boolean;
  /** No HUD or navigation, for clean art reviews. */
  bare: boolean;
  /** Event buttons, and `window.grove` for a test driver. */
  debug: boolean;
  /** Start the saved state afresh. */
  reset: boolean;

  // The glade.
  level: number;
  /** The player; varies the tree within its stage. */
  seed: string;
  /** `cone` opens a cone on load (`conet=` seconds in); `cone10` opens ten. */
  scene: "glade" | "cone" | "cone10";
  coneT: number;
  /** The cone's rarity (the best of ten), and its shiny mark. */
  rank: RankName;
  verdant: boolean;
  tool: Tool | null;
  /** A care action already under way, `careT` seconds in, for stills. */
  care: Tool | null;
  careT: number;
  /** Guild raids finished today: the tree is rained on once for each ("groot"). */
  groot: number;
  /** The ceremony from `level - 1` to `level`. */
  levelup: boolean;
  /** Progress through the level, 0 to 1, for the XP bar. */
  xp: number;
  /** The daily greeting: on by default when live, only with `greet` in a still. */
  greet: boolean;

  // The forest.
  /** A guild moment that plays on load, and how far into it a still is (`et` seconds). */
  event: EventKind | null;
  et: number;
  /** Where the camera starts: `heart`, `pond`, `gate`, `west`, `east` or a valley x. */
  at: string | null;
  /** The guild's birthday: the crabs throw a rave. */
  anniversary: boolean;
  /** The member whose tree "Find my tree" finds. */
  me: string;
  /** A member's or a landmark's tooltip open on load. */
  tip: string | null;
  look: string | null;

  // The campfire.
  /** Force a layout; by default the window's size picks it. */
  camp: CampLayout | null;
  /** A cone burning on load, this many seconds in. */
  burn: number | null;
  /** The cat's joke open on load. */
  joke: boolean;
}

/** Winter in December, January and February (the first of December to the end of February). */
export const seasonOn = (date: Date): Season => {
  const month = date.getMonth();
  return month === 11 || month === 0 || month === 1 ? "winter" : "normal";
};

export function readParams(search: string, today: Date = new Date()): Params {
  const q = new URLSearchParams(search);
  const level = Math.max(1, Math.min(LEVEL_MAX, Math.round(Number(q.get("level") ?? 8)) || 8));
  const time = q.get("time");
  const season = q.get("season");
  const scene = q.get("scene");
  const rank = RANKS.find((r) => r.name.toLowerCase() === (q.get("rank") ?? "dryad").toLowerCase());
  const still = q.has("still");
  const groot = q.get("groot");
  const event = q.get("event");
  const camp = q.get("camp");
  const burn = q.get("burn");
  return {
    time: time === "day" || time === "night" ? time : "dusk",
    timeFromUrl: time !== null,
    season: season === null ? seasonOn(today) : season === "winter" ? "winter" : "normal",
    still,
    t: Number(q.get("t") ?? 2.6) || 0,
    perf: q.has("perf"),
    bare: q.has("bare"),
    debug: q.has("debug"),
    reset: q.has("reset"),

    level: q.has("levelup") ? Math.max(2, level) : level,
    seed: q.get("seed") ?? "sequoia",
    scene: scene === "cone" || scene === "cone10" ? scene : "glade",
    coneT: Number(q.get("conet") ?? 3.4),
    rank: rank?.name ?? "Dryad",
    verdant: q.has("verdant"),
    tool: asTool(q.get("tool")),
    care: asTool(q.get("care")),
    careT: Number(q.get("caret") ?? 0.8),
    groot: groot === null ? 0 : Math.max(1, Math.min(9, Math.round(Number(groot)) || 3)),
    levelup: q.has("levelup"),
    xp: Math.max(0, Math.min(1, Number(q.get("xp") ?? 0.64) || 0)),
    greet: q.has("greet") || (!still && !q.has("nogreet")),

    event: event === "raid" || event === "war" || event === "levelup" ? event : null,
    et: Number(q.get("et") ?? -1),
    at: q.get("at"),
    anniversary: q.has("anniversary"),
    me: q.get("me") ?? "Wrenfeather",
    tip: q.get("tip"),
    look: q.get("look"),

    camp: camp === "normal" || camp === "pip" || camp === "phone" ? camp : null,
    burn: burn === null ? null : Math.max(0, Number(burn) || 0),
    joke: q.has("joke"),
  };
}

function asTool(v: string | null): Tool | null {
  return v === "water" || v === "shears" || v === "mist" ? v : null;
}
