/** The square round the fire: the fire and its seats, the quest board, the Tally and the banner pole. */

import type { Area } from "../rows.ts";

export const SQUARE: Area = {
  pieces: [
    { id: "quest-board", kind: "quest-board", x: 176, y: 160 },
    // The Tally, by the middle of its foot: across the fire from the quest board.
    { id: "tally", kind: "tally", x: 286, y: 294 },
    { id: "banner-pole", kind: "banner-pole", x: 300, y: 152 },
    { id: "post-fire-west", kind: "post", x: 204, y: 246 },
    { id: "post-fire-east", kind: "post", x: 310, y: 246 },
    { id: "post-south", kind: "post", x: 230, y: 306 },
    // The fire and its seats: a log behind it (the right end the member's), one in front, a stump each side.
    { id: "fire", kind: "fire", x: 256, y: 217 },
    { id: "fire-log-north", kind: "log", piece: "fire", x: 0, y: -17, face: 0, at: "fire", yours: 1 },
    { id: "fire-log-south", kind: "log", piece: "fire", x: 0, y: 23, face: 3, at: "fire" },
    { id: "fire-stump-west", kind: "stump", piece: "fire", x: -36, y: -1, face: 2, at: "fire" },
    { id: "fire-stump-east", kind: "stump", piece: "fire", x: 36, y: -1, face: 1, at: "fire" },
    {
      id: "flowers-board",
      kind: "flower",
      points: [
        [234, 170, 2],
        [240, 173, 0],
        [229, 174, 1],
        [236, 178, 2],
        [245, 169, 1],
      ],
    },
    {
      id: "flowers-pole",
      kind: "flower",
      points: [
        [326, 172, 0],
        [332, 175, 1],
        [321, 176, 2],
        [328, 180, 0],
        [337, 171, 2],
      ],
    },
    {
      id: "flowers-tally",
      kind: "flower",
      points: [
        [300, 316, 0],
        [306, 319, 1],
        [295, 320, 2],
        [302, 324, 0],
        [311, 315, 2],
      ],
    },
    {
      id: "flowers-south",
      kind: "flower",
      points: [
        [214, 328, 1],
        [220, 331, 2],
        [209, 332, 0],
        [216, 336, 1],
        [225, 327, 0],
      ],
    },
    {
      id: "bushes-square",
      kind: "bush",
      points: [
        [286, 334, 1],
        [176, 216, 2],
      ],
    },
    {
      id: "ferns-square",
      kind: "fern",
      points: [
        [240, 338, 0],
        [330, 340, 1],
      ],
    },
    { id: "rock-pole", kind: "rock", x: 312, y: 182, look: 1 },
  ],
  places: [
    {
      id: "quests",
      name: "Quest board",
      piece: "quest-board",
      stand: { x: 22, y: 8 },
      face: 3,
      prompt: { x: 22, y: -44 },
    },
    {
      id: "tally",
      name: "The Tally",
      about: "Leaderboards: who has done the most.",
      piece: "tally",
      stand: { x: 0, y: 8 },
      face: 3,
      prompt: { x: 0, y: -44 },
    },
    // The prompt is on the fire's own stones, under the flames: over the logs it covered the faces of whoever sat there.
    { id: "fire", name: "Campfire", piece: "fire", stand: { x: 0, y: -12 }, face: 0, prompt: { x: 0, y: 0 } },
  ],
  clearings: [{ piece: "fire", x: 0, y: -1, r: 45 }],
  paths: [
    [224, 152, 198, 168, 7], // to the quest board
    [256, 256, 248, 296, 7], // south, round to the garden
    [251, 290, 286, 302, 5], // off it to the Tally
  ],
};
