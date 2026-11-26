// The names the games log what players did by: a module of its own, so that a game that logs
// does not use the staff's report (core's `rulesVersion` follows modules).

/**
 * What the games log that the report reads (`Done.log` in the play service); the games log them by
 * these names. A raid run is `raid_started` (`trail`), then a `raid_room` for each room fought
 * (`room`, `kind`, `won` true for one won, `resolve` left, the fight's `seconds`, and for a room
 * fought against another member's board `met`, their Leaf id), then `raid_ended`
 * (`trail`, `rooms_won`, `ended`: `won`, `lost` or `left`, and the `coins` it paid), each with `own`
 * true for a run with the member's own figures; and `raid_fight` for each fight decided, kept
 * whole for the staff's analysis in a table of its own (the raid's `FightRecord`); the Works logs
 * `works_plot` and `works_plan` for what was bought (`plot` or `plan`, and its `price`),
 * `works_order` for a standing order handed over (`order`, `title`, `pay`) and `works_story` for each
 * story order finished (`order`, its number in the story, `title`, `pay`); the town logs
 * `town_bought` and `town_pet`, `town_crab` for each sighting of the missing crab and
 * `town_greeted` for each caller greeted (`by`, who called); the pulls log `pulls_top`
 * for each top-tier prize won (`prize`, `pool`, and the pulls since the last one, `top`). The play
 * service itself logs `leaf_spent` for each Leaf a command took (`leaf`, and the `reason` it was taken for).
 */
export const LOGGED = {
  raidStarted: "raid_started",
  raidRoom: "raid_room",
  raidEnded: "raid_ended",
  raidFight: "raid_fight",
  worksPlot: "works_plot",
  worksPlan: "works_plan",
  worksOrder: "works_order",
  worksStory: "works_story",
  townBought: "town_bought",
  townPet: "town_pet",
  townCrab: "town_crab",
  townGreeted: "town_greeted",
  pullsTop: "pulls_top",
  leafSpent: "leaf_spent",
} as const;
