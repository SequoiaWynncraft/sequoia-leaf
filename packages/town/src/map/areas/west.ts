/** The west: the Grove's standing stone on the lawn below the Treasury, and the market's three stalls. */

import type { Area } from "../rows.ts";

export const WEST: Area = {
  pieces: [
    { id: "trunk-west", kind: "trunk", x: -12, y: 204, look: 4 },
    { id: "grove", kind: "grove", x: 104, y: 180 },
    // The market's stalls, by the left end of their foot, and by their number in the catalogue: the
    // middle one is the market, and the others stand either side of it.
    { id: "stall-lamps", kind: "stall", piece: "stall-seats", x: -48, y: 0, look: 0 },
    { id: "stall-seats", kind: "stall", x: 88, y: 248, look: 1 },
    { id: "stall-plants", kind: "stall", piece: "stall-seats", x: 48, y: 0, look: 2 },
    { id: "post-market", kind: "post", x: 188, y: 276 },
    {
      id: "flowers-grove-west",
      kind: "flower",
      points: [
        [40, 196, 0],
        [46, 199, 1],
        [35, 200, 2],
        [42, 204, 0],
        [51, 195, 2],
      ],
    },
    {
      id: "flowers-grove-east",
      kind: "flower",
      points: [
        [128, 210, 2],
        [134, 213, 0],
        [123, 214, 1],
        [130, 218, 2],
        [139, 209, 1],
      ],
    },
    {
      id: "bushes-west",
      kind: "bush",
      points: [
        [46, 158, 1],
        [58, 206, 2],
      ],
    },
    {
      id: "ferns-west",
      kind: "fern",
      points: [
        [42, 214, 1],
        [34, 268, 0],
      ],
    },
  ],
  places: [
    {
      id: "grove",
      name: "The Grove",
      about: "Pull prizes for Leaf.",
      piece: "grove",
      stand: { x: 0, y: 15 },
      face: 3,
      prompt: { x: 0, y: -50 },
    },
    {
      id: "market",
      name: "Market",
      about: "Things for your camp, for Coins.",
      piece: "stall-seats",
      stand: { x: 20, y: 9 },
      face: 3,
      prompt: { x: 20, y: -48 },
    },
  ],
  clearings: [{ piece: "grove", x: 0, y: 15, r: 12 }],
  paths: [
    [222, 238, 190, 261, 8], // west to the market
    [190, 262, 50, 263, 8],
    [104, 144, 126, 166, 5], // down from the Treasury, round the Grove's stones
    [126, 166, 118, 190, 5],
  ],
};
