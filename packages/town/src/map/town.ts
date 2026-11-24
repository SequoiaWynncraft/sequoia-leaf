/**
 * The Guild Town as one table: its areas (`areas/`), each with the pieces that stand in it, its
 * places, the trodden earth round its pieces and its paths; the town's edges; and the spots fixed
 * to pieces that are kept by what they are for. Moving a piece is changing its row: whatever is
 * fixed to it (a place's stand and prompt, the spots where people go, its ground, its seats, its
 * lights, its shadow, its clearing, its water) goes with it. A new area is a new file in `areas/`
 * and its name in `areas` here. Data only: what follows from it is worked out in `map.ts`, and
 * checked in `map.test.ts`. The shape of it all is `rows.ts`.
 */

import { EAST } from "./areas/east.ts";
import { GARDEN } from "./areas/garden.ts";
import { NORTH } from "./areas/north.ts";
import { SQUARE } from "./areas/square.ts";
import { WEST } from "./areas/west.ts";
import type { TownMap } from "./rows.ts";

export const TOWN_MAP: TownMap = {
  bounds: { x: 0, y: 0, w: 512, h: 352 },

  ground: {
    hedge: 58,
    walls: [
      // The far trees over the shops (the gate opens the way through them), the walls of bark left
      // and right, and the ferns along the bottom.
      { id: "far-trees", x: 0, y: 0, w: 512, h: 96 },
      { id: "bark-west", x: 0, y: 0, w: 32, h: 352 },
      { id: "bark-east", x: 480, y: 0, w: 32, h: 352 },
      { id: "ferns-south", x: 0, y: 336, w: 512, h: 16 },
    ],
  },

  areas: [NORTH, SQUARE, WEST, EAST, GARDEN],

  // At the Works, along its front and by the crate pile, side on, each with room for a crate on the
  // side they face, and none on the bench, in the doorway or where the town's own stand at the door;
  // at the stump, sitting round it over the board, none on the logs (the member's and the dozers'
  // seats) and one behind the board, where the string of lights only just clears a head; before the
  // Grove's stone, facing it, either side of where the member stands to go in.
  busy: {
    works: {
      middle: { piece: "works", x: 86, y: 25 },
      spots: [
        { piece: "works", x: 107, y: 19, dir: 2 },
        { piece: "works", x: 122, y: 31, dir: 1 },
        { piece: "works", x: 64, y: 18, dir: 1 },
        { piece: "works", x: 47, y: 33, dir: 2 },
        { piece: "works", x: 63, y: 40, dir: 1 },
      ],
    },
    table: {
      middle: { piece: "great-stump", x: 0, y: -15 },
      spots: [
        { piece: "great-stump", x: 0, y: 5, dir: 3 },
        { piece: "great-stump", x: 4, y: -29, dir: 0 },
        { piece: "great-stump", x: -29, y: -7, dir: 2 },
        { piece: "great-stump", x: 28, y: -7, dir: 1 },
      ],
    },
    grove: {
      middle: { piece: "grove", x: 0, y: 0 },
      spots: [
        { piece: "grove", x: -12, y: 17, dir: 3 },
        { piece: "grove", x: 12, y: 17, dir: 3 },
        { piece: "grove", x: -25, y: 15, dir: 2 },
        { piece: "grove", x: 25, y: 15, dir: 1 },
      ],
    },
  },

  errands: {
    crabs: [
      { piece: "pond", x: 4, y: -39, dir: 0 },
      { piece: "pond", x: -60, y: -16, dir: 2 },
    ],
    board: [
      { piece: "quest-board", x: 12, y: 6, dir: 3 },
      { piece: "quest-board", x: 32, y: 7, dir: 3 },
    ],
    gate: [{ piece: "gate", x: -16, y: 14, dir: 0 }],
    works: [
      { piece: "works", x: 43, y: 6, dir: 0 },
      { piece: "works", x: 54, y: 11, dir: 1 },
    ],
    fire: [
      { piece: "fire", x: 28, y: 9, dir: 1 },
      { piece: "fire", x: -26, y: 13, dir: 2 },
    ],
  },

  crabs: [
    { piece: "pond", x: -48, y: -8 },
    { piece: "pond", x: -16, y: -27 },
    { piece: "pond", x: 24, y: -32 },
    { piece: "pond", x: 60, y: -8 },
    { piece: "pond", x: 46, y: 21 },
    { piece: "pond", x: -4, y: 35 },
    { piece: "pond-rock-middle", x: 0, y: -5, perched: true },
    { piece: "pond-rock-east", x: 0, y: -5, perched: true },
  ],

  hides: [
    { piece: "quest-board", x: 22, y: -39, z: 1 },
    { piece: "treasury", x: 66, y: -84, z: 1 },
    { piece: "stall-seats", x: 20, y: -42, z: 1 },
    { piece: "gate", x: 0, y: -54, z: 1 },
    { piece: "lantern-tree", x: 0, y: -52, z: 1 },
    { piece: "fire-log-south", x: 16, y: -8, z: 1 },
    { piece: "pile", x: 10, y: -18, z: 0 },
    { piece: "garden-bench", x: 10, y: -11, z: 1 },
    { piece: "works", x: 60, y: -80, z: -1 },
  ],

  keepers: {
    counter: { piece: "counter", x: 23, y: -7, lift: 9 },
    stalls: [
      { piece: "stall-lamps", x: 20, y: -10, lift: 2, nap: { x: 20, y: 1, lift: 16 } },
      { piece: "stall-seats", x: 20, y: -10, lift: 2, nap: { x: 20, y: 1, lift: 16 } },
      { piece: "stall-plants", x: 20, y: -10, lift: 2, nap: { x: 20, y: 1, lift: 16 } },
    ],
  },

  trail: {
    out: { piece: "gate", x: 0, y: -14 },
    way: { piece: "gate", x: 0, y: 2 },
    in: { piece: "gate", x: 0, y: 54 },
    back: { piece: "gate", x: 0, y: 30 },
  },

  glints: { piece: "pond", x: -62, y: -31, w: 126, h: 64 },
  fireflies: [
    { piece: "pond", x: -58, y: -43, w: 120, h: 70 },
    { piece: "garden-bench", x: -80, y: -22, w: 120, h: 40 },
  ],

  strings: [
    // The Treasury's eave up to the trunk west of the gate, and that trunk to the gate's eave.
    { from: { piece: "treasury", x: 94, y: -48 }, to: { piece: "trunk-gate-west", x: -24, y: -38 }, sag: 5 },
    { from: { piece: "trunk-gate-west", x: 24, y: -42 }, to: { piece: "gate", x: -28, y: -48 }, sag: 2 },
    // Across the gate, trunk to trunk.
    { from: { piece: "trunk-gate-west", x: 26, y: -36 }, to: { piece: "trunk-gate-east", x: -26, y: -36 }, sag: 9 },
    // The gate's eave to the trunk east of it, and that trunk down to the Works' eave.
    { from: { piece: "gate", x: 28, y: -48 }, to: { piece: "trunk-gate-east", x: -24, y: -42 }, sag: 2 },
    { from: { piece: "trunk-gate-east", x: 24, y: -38 }, to: { piece: "works", x: 6, y: -50 }, sag: 3 },
    // From the west trunk along the market stalls to the arm of the post past the third.
    { from: { piece: "trunk-west", x: 46, y: -14 }, to: { piece: "post-market", x: 9, y: -33 }, sag: 8 },
    // The arm of the post over the stump's board to the east trunk.
    { from: { piece: "post-stump", x: 9, y: -33 }, to: { piece: "trunk-east", x: -36, y: -82 }, sag: 7 },
    // The south-west trunk to the arm of the post by the garden.
    { from: { piece: "trunk-sw", x: 40, y: -94 }, to: { piece: "post-garden", x: 8, y: -32 }, sag: 5 },
  ],
};
