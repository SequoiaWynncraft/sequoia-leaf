/** The east: the great stump where The Little Raid is played, the lantern tree, and the crab pond. */

import type { Area } from "../rows.ts";

export const EAST: Area = {
  pieces: [
    { id: "trunk-east", kind: "trunk", x: 524, y: 236, look: 5 },
    { id: "trunk-se", kind: "trunk", x: 520, y: 348, look: 7 },
    { id: "post-pond", kind: "post", x: 398, y: 246 },
    // The great stump; the lantern post over its board, and its two logs, the west one the member's.
    { id: "post-stump", kind: "post", piece: "great-stump", x: -20, y: -19 },
    { id: "great-stump", kind: "great-stump", x: 444, y: 200 },
    {
      id: "great-stump-log-west",
      kind: "short-log",
      piece: "great-stump",
      x: -13,
      y: 17,
      face: 3,
      at: "table",
      yours: 0,
    },
    { id: "great-stump-log-east", kind: "short-log", piece: "great-stump", x: 13, y: 17, face: 3, at: "table" },
    { id: "lantern-tree", kind: "lantern-tree", x: 352, y: 200 },
    // The crab pond, by the middle of its water, and what is in it and at its edge.
    { id: "pond", kind: "pond", x: 400, y: 293 },
    {
      id: "pond-rocks",
      kind: "rock",
      piece: "pond",
      points: [
        [-60, -1, 0],
        [64, 9, 2],
        [32, 29, 1],
        [-18, 33, 1],
      ],
    },
    // The two rocks crabs perch on.
    { id: "pond-rock-middle", kind: "rock", piece: "pond", x: 4, y: 4, look: 1 },
    { id: "pond-rock-east", kind: "rock", piece: "pond", x: 32, y: -4, look: 1 },
    {
      id: "pond-reeds",
      kind: "reeds",
      piece: "pond",
      points: [
        [-52, 9],
        [56, 3],
        [22, 27],
        [-24, 29],
        [-36, -17],
      ],
    },
    {
      id: "lily-pads",
      kind: "lily",
      piece: "pond",
      points: [
        [-10, -5, 0],
        [18, 11, 1],
        [44, -13, 0],
        [-28, 15, 1],
        [10, -15, 0],
        [24, 7, 0],
      ],
    },
    { id: "mushroom-stump", kind: "mushroom", x: 476, y: 220, look: 0 },
    {
      id: "flowers-great-stump",
      kind: "flower",
      points: [
        [470, 240, 1],
        [476, 243, 2],
        [465, 244, 0],
        [472, 248, 1],
        [481, 239, 0],
      ],
    },
    {
      id: "flowers-pond",
      kind: "flower",
      points: [
        [356, 334, 2],
        [362, 337, 0],
        [351, 338, 1],
        [358, 342, 2],
        [367, 333, 1],
      ],
    },
    {
      id: "bushes-east",
      kind: "bush",
      points: [
        [404, 172, 0],
        [476, 176, 2],
        [330, 296, 2],
      ],
    },
    {
      id: "ferns-east",
      kind: "fern",
      points: [
        [468, 244, 0],
        [462, 336, 1],
      ],
    },
  ],
  places: [
    {
      id: "table",
      name: "The Little Raid",
      about: "The guild's board game.",
      piece: "great-stump",
      stand: { x: 0, y: 6 },
      face: 3,
      prompt: { x: 0, y: -60 },
    },
    {
      id: "pond",
      name: "Crab pond",
      about: "Nine crabs. Eight at roll call.",
      piece: "pond",
      stand: { x: -20, y: -39 },
      face: 0,
      prompt: { x: 0, y: -23 },
    },
  ],
  clearings: [
    { piece: "lantern-tree", x: 0, y: 14, r: 11 }, // under the lantern tree
    { piece: "great-stump", x: 0, y: 5, r: 27 }, // round the stump, where people stand to watch
  ],
  paths: [
    [290, 236, 340, 247, 7], // east to the pond
    [340, 247, 382, 250, 7],
    [362, 211, 414, 206, 6], // east to the great stump
  ],
};
