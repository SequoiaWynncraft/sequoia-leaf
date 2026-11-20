/** URL parameters, for screenshots and for trying the glade at any level, seed, light and season. */

import { type RankName, RANKS, type Season, type Time } from "./palette.ts";

export type Tool = "water" | "shears" | "mist";

export interface Params {
  level: number;
  seed: string;
  time: Time;
  season: Season;
  /** Freeze the clock (at `t` seconds) so a screenshot is the same every time. */
  still: boolean;
  t: number;
  scene: "glade" | "cone" | "cone10";
  /** Seconds into the cone opening, for stills of the reveal. */
  coneT: number;
  rank: RankName;
  verdant: boolean;
  tool: Tool | null;
  /** Draw the sprite sheet instead of the glade, for reviewing the hand-drawn art. */
  sheet: boolean;
  /** A care action already under way when the glade opens, `careT` seconds in, for stills. */
  care: Tool | null;
  careT: number;
  /** Guild raids finished today: the tree is rained on once for each ("groot"). 0 for none. */
  groot: number;
  /** Play the level-up ceremony, from `level - 1` to `level`. */
  levelup: boolean;
  /** Progress through the current level, 0 to 1, for the XP bar. */
  xp: number;
  /** Show the daily greeting. On by default when live; stills show it only when asked. */
  greet: boolean;
}

export function readParams(search: string): Params {
  const q = new URLSearchParams(search);
  const level = Math.max(1, Math.min(13, Math.round(Number(q.get("level") ?? 8)) || 8));
  const time = q.get("time");
  const season = q.get("season");
  const scene = q.get("scene");
  const rank = RANKS.find((r) => r.name.toLowerCase() === (q.get("rank") ?? "dryad").toLowerCase());
  const tool = q.get("tool");
  const still = q.has("still");
  const groot = q.get("groot");
  return {
    level: q.has("levelup") ? Math.max(2, level) : level,
    seed: q.get("seed") ?? "sequoia",
    time: time === "day" || time === "night" ? time : "dusk",
    season: season === "winter" ? "winter" : "normal",
    still,
    t: Number(q.get("t") ?? 2.6) || 0,
    scene: scene === "cone" || scene === "cone10" ? scene : "glade",
    coneT: Number(q.get("conet") ?? 3.4),
    rank: rank?.name ?? "Dryad",
    verdant: q.has("verdant"),
    tool: asTool(tool),
    sheet: q.has("sheet"),
    care: asTool(q.get("care")),
    careT: Number(q.get("caret") ?? 0.8),
    groot: groot === null ? 0 : Math.max(1, Math.min(9, Math.round(Number(groot)) || 3)),
    levelup: q.has("levelup"),
    xp: Math.max(0, Math.min(1, Number(q.get("xp") ?? 0.64) || 0)),
    greet: q.has("greet") || (!still && !q.has("nogreet")),
  };
}

function asTool(v: string | null): Tool | null {
  return v === "water" || v === "shears" || v === "mist" ? v : null;
}
