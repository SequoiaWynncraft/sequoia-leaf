/** A tree's stage by its level, as the HUD, the GG card and the forest's tooltips name it (see the design's table). */

export type StageName = "seedling" | "sapling" | "young" | "mature" | "ancient" | "giant";

/** Levels 1 to 13. */
export const STAGE_OF_LEVEL: readonly StageName[] = [
  "seedling",
  "seedling",
  "sapling",
  "sapling",
  "young",
  "mature",
  "mature",
  "mature",
  "ancient",
  "ancient",
  "ancient",
  "ancient",
  "giant",
];

/** The stage's name as the GG card and the HUD show it. */
export const STAGE_TITLE: Record<StageName, string> = {
  seedling: "Seedling",
  sapling: "Sapling",
  young: "Young sequoia",
  mature: "Mature sequoia",
  ancient: "Ancient sequoia",
  giant: "Giant sequoia",
};

/** The stage at a level, kept to the table. */
export const stageOf = (level: number): StageName =>
  STAGE_OF_LEVEL[Math.max(0, Math.min(STAGE_OF_LEVEL.length - 1, Math.round(level) - 1))] ?? "seedling";
