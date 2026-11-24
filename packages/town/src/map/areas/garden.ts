/** The garden in the south-west corner: the bench, mushrooms and flowers, and the path round to it. */

import type { Area } from "../rows.ts";

export const GARDEN: Area = {
  pieces: [
    { id: "trunk-sw", kind: "trunk", x: -6, y: 344, look: 6 },
    { id: "post-garden", kind: "post", x: 92, y: 294 },
    { id: "garden-bench", kind: "bench", x: 120, y: 312, face: 0, at: "bench" },
    {
      id: "mushrooms",
      kind: "mushroom",
      points: [
        [46, 312, 1],
        [56, 322, 0],
        [38, 324, 0],
        [72, 332, 1],
      ],
    },
    {
      id: "flowers-garden",
      kind: "flower",
      points: [
        [84, 304, 0],
        [90, 307, 1],
        [79, 308, 2],
        [86, 312, 0],
        [95, 303, 2],
      ],
    },
    {
      id: "flowers-garden-south",
      kind: "flower",
      points: [
        [146, 328, 1],
        [152, 331, 2],
        [141, 332, 0],
        [148, 336, 1],
        [157, 327, 0],
      ],
    },
    {
      id: "ferns-garden",
      kind: "fern",
      points: [
        [50, 340, 1],
        [140, 340, 2],
      ],
    },
  ],
  places: [],
  clearings: [],
  paths: [
    [248, 296, 200, 318, 7], // on round to the garden
    [200, 318, 110, 322, 7],
  ],
};
