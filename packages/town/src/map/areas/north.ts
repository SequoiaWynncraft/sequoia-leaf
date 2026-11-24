/**
 * The north road, along the shop fronts: the Treasury, the gate out to the camps and the Works,
 * with the great trunks behind them and the bench by the Works' door.
 */

import type { Area } from "../rows.ts";

export const NORTH: Area = {
  pieces: [
    // The great trunks: in the corner, either side of the gate, and in the other corner.
    { id: "trunk-nw", kind: "trunk", x: 10, y: 106, look: 0 },
    { id: "trunk-gate-west", kind: "trunk", x: 196, y: 96, look: 1 },
    { id: "trunk-gate-east", kind: "trunk", x: 316, y: 96, look: 2 },
    { id: "trunk-ne", kind: "trunk", x: 502, y: 108, look: 3 },
    // The Treasury, by the left end of its foot; its counter, Cinfy's chest and two barrels.
    { id: "treasury", kind: "treasury", x: 56, y: 120 },
    { id: "counter", kind: "counter", piece: "treasury", x: 25, y: 0 },
    { id: "chest", kind: "chest", piece: "treasury", x: 104, y: 1 },
    {
      id: "barrels",
      kind: "barrel",
      piece: "treasury",
      points: [
        [6, 4],
        [-5, 2],
      ],
    },
    // The Works, by the left end of its foot; the belt out front, and the pile the belt feeds.
    { id: "works", kind: "works", x: 344, y: 120 },
    { id: "belt", kind: "belt", piece: "works", x: 58, y: 14 },
    { id: "pile", kind: "pile", piece: "works", x: 114, y: 15 },
    // The gate, by the middle of its foot, and the signpost that says where it goes.
    { id: "gate", kind: "gate", x: 256, y: 98 },
    { id: "signpost", kind: "signpost", piece: "gate", x: 35, y: 8 },
    { id: "post-road-west", kind: "post", x: 174, y: 126 },
    { id: "post-road-east", kind: "post", x: 334, y: 126 },
    // The bench by the Works' door, under the belt, clear of the lantern tree.
    { id: "works-bench", kind: "bench", piece: "works", x: 84, y: 32, face: 0, at: "works" },
    { id: "mushroom-road", kind: "mushroom", x: 150, y: 106, look: 0 },
    {
      id: "flowers-treasury",
      kind: "flower",
      points: [
        [44, 140, 1],
        [50, 143, 2],
        [39, 144, 0],
        [46, 148, 1],
        [55, 139, 0],
      ],
    },
    {
      id: "flowers-works-bench",
      kind: "flower",
      points: [
        [470, 158, 2],
        [476, 161, 0],
        [465, 162, 1],
        [472, 166, 2],
        [481, 157, 1],
      ],
    },
    {
      id: "ferns-road",
      kind: "fern",
      points: [
        [64, 128, 1],
        [162, 100, 0],
        [230, 104, 2],
        [348, 102, 0],
        [476, 150, 2],
      ],
    },
    // Shade where the shops meet the ground.
    { id: "treasury-shade", kind: "shade", piece: "treasury", x: 0, y: 0, look: 0 },
    { id: "works-shade", kind: "shade", piece: "works", x: 0, y: 0, look: 1 },
  ],
  places: [
    {
      id: "treasury",
      name: "Treasury",
      about: "Cinfy sells things for Leaf.",
      piece: "treasury",
      stand: { x: 48, y: 8 },
      face: 3,
      prompt: { x: 48, y: -58 },
    },
    {
      id: "works",
      name: "The Works",
      about: "Your yard. Coins are made here.",
      piece: "works",
      stand: { x: 29, y: 7 },
      face: 3,
      prompt: { x: 29, y: -58 },
    },
    {
      id: "camp",
      name: "Your camp",
      about: "Through the gate and down the trail.",
      piece: "gate",
      stand: { x: 0, y: 8 },
      face: 3,
      prompt: { x: 0, y: -54 },
    },
  ],
  clearings: [
    { piece: "treasury", x: 48, y: 10, r: 14 },
    { piece: "works", x: 36, y: 10, r: 13 },
  ],
  paths: [
    [92, 137, 424, 137, 9], // the north road, along the shop fronts
    // In from the gate.
    { piece: "gate", from: { x: 0, y: -40 }, to: { x: 0, y: 78 }, half: 10 },
  ],
};
