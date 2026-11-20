/**
 * Hand-placed pixel art for the forest and the Campfire: the Chickaree and the cone and its opening.
 * One character per pixel; the legends map characters to palette indices.
 */

import { ix, R } from "../engine/palette.ts";
import { fromRows } from "../engine/raster.ts";

// ---------------------------------------------------------------------------------------------
// The Chickaree: a Douglas squirrel sitting up, hugging a sequoia cone. Dark olive-brown back, a
// rusty belly, a pale eye ring and the tail's pale fringe, as the real ones have.

const SQ = {
  K: ix(R.INK, 3),
  D: ix(R.FUR, 1),
  M: ix(R.FUR, 2),
  L: ix(R.FUR, 3),
  l: ix(R.FUR, 4),
  O: ix(R.FUR, 5),
  o: ix(R.FUR, 6),
  c: ix(R.FUR, 7),
  E: ix(R.INK, 0),
  W: ix(R.CREAM, 7),
  T: ix(R.CREAM, 2),
  t: ix(R.CREAM, 1),
  n: ix(R.CONE, 2),
  N: ix(R.CONE, 4),
  h: ix(R.CONE, 6),
  p: ix(R.FUR, 6),
  r: ix(R.ROSE, 4),
};

const SQUIRREL_IDLE = [
  "...........K..K...",
  "...KKK....KDKKDK..",
  "..KtTTK..KDMMMMDK.",
  ".KtDDMTKKMLLLLLMK.",
  ".KTDMMDTKMLLcEWLoK",
  ".KTDMDDTKMLLLccooE",
  ".KTDMDDKKLLrccccK.",
  "..KTDMDKMLLOoooK..",
  "..KTDMKMLLKnhnpK..",
  "...KTDKMLOKhNhNK..",
  "...KTDKMLOpnhnhK..",
  "...KTDKMLOKNhNKo..",
  "..KTDMKMLOoKKKoK..",
  "..KTDDKMLLOoooK...",
  "...KKKKDMMLLLKK...",
  "......KKDKKKDK....",
];

/** Rows built from another frame's tail (columns 0 to 7) and head (8 on), the head moved down. */
function withHead(rows: readonly string[], headFrom: readonly string[], drop: number, upTo: number): string[] {
  return rows.map((row, y) => {
    if (y > upTo) return row;
    const src = headFrom[y - drop] ?? "..................";
    return row.slice(0, 8) + (y - drop < 0 ? ".........." : src.slice(8));
  });
}

/** Nibbling: the head dips onto the cone, the muzzle at its tip. */
const SQUIRREL_NIBBLE = withHead(SQUIRREL_IDLE, SQUIRREL_IDLE, 1, 7).map((row, y) =>
  y === 8 ? "..KTDMKMLLKncopK.." : row,
);

/** The tail flicked: its top curls further over the back. */
const FLICK_TAIL = ["....KKK.", "...KtTTK", "..KtTDMK", ".KtDDMTK"];
const SQUIRREL_FLICK = SQUIRREL_IDLE.map((row, y) =>
  y < FLICK_TAIL.length ? (FLICK_TAIL[y] ?? "") + row.slice(8) : row,
);

const blink = (rows: readonly string[]): string[] => rows.map((r) => r.replace("cEW", "cKK"));

export const SQUIRREL = {
  idle: fromRows(SQUIRREL_IDLE, SQ),
  blink: fromRows(blink(SQUIRREL_IDLE), SQ),
  nibble: fromRows(SQUIRREL_NIBBLE, SQ),
  flick: fromRows(SQUIRREL_FLICK, SQ),
};

/** The Chickaree as a spirit, just out of the cone: eyes happy-shut, paws clasped, no cone. */
const SPIRIT_CHEER = [
  "...........K..K...",
  "...KKK....KDKKDK..",
  "..KtTTK..KDMMMMDK.",
  ".KtDDMTKKMLLLKLMK.",
  ".KTDMMDTKMLLKLKLoK",
  ".KTDMDDTKMLLLccooE",
  ".KTDMDDKKLLrccccK.",
  "..KTDMDKMLLOoooK..",
  "..KTDMKMLLOoppoK..",
  "...KTDKMLOoooooK..",
  "...KTDKMLOoooooK..",
  "...KTDKMLOoooooK..",
  "..KTDMKMLOooooK...",
  "..KTDDKMLLOoooK...",
  "...KKKKDMMLLLKK...",
  "......KKDKKKDK....",
];

export const SPIRIT = fromRows(SPIRIT_CHEER, SQ);

// ---------------------------------------------------------------------------------------------
// The giant sequoia cone: small, egg-shaped, rhombic scales in two browns, lit from the fire.

const CO = {
  K: ix(R.CONE, 0),
  d: ix(R.CONE, 1),
  n: ix(R.CONE, 3),
  N: ix(R.CONE, 4),
  h: ix(R.CONE, 6),
  H: ix(R.CONE, 7),
  s: ix(R.WOOD, 3),
  // Rarity light leaking between the scales.
  x: ix(R.RARITY, 5),
  X: ix(R.RARITY, 7),
  y: ix(R.RARITY, 3),
};

export const CONE = {
  shut: fromRows(
    ["..KKK..", ".KhNnK.", "KhNdhNK", "KNdhNdK", "KdhNdhK", "KhNdhNK", "KNdhNdK", ".KdNdK.", "..KsK.."],
    CO,
  ),
  cracked: fromRows(
    ["..KKK..", ".KhxnK.", "KhNxhNK", "KxdhxdK", "KdhxdhK", "KhxdhxK", "KNdxNdK", ".KdxdK.", "..KsK.."],
    CO,
  ),
  parting: fromRows(
    [
      "...K.K...",
      "..KhxnK..",
      ".KhNXhNK.",
      "KNdxXxNdK",
      "KdhxXxdhK",
      "KhNxXxhNK",
      ".KNxXxNK.",
      "..KdxdK..",
      "...KsK...",
    ],
    CO,
  ),
  open: fromRows(
    [
      "K..K.K..K",
      "hK.xXx.Kh",
      ".hNxXxNh.",
      "KNyXXXyNK",
      "dhxXXXxhd",
      "KhyXXXyhK",
      ".KNxXxNK.",
      "..KdxdK..",
      "...KsK...",
    ],
    CO,
  ),
};
