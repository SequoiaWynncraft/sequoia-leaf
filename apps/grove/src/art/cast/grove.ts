/**
 * The grove's background folk, who are never pulled from a cone: the grove cat who loafs by the
 * campfire and tells a dad joke when tapped, and the duck family who paddle on the Swamp, after the
 * welcome scenes' duck parade. Drawn small, in the cast's character ramps.
 */

import { C, ix } from "../../engine/palette.ts";
import { fromRows } from "../../engine/raster.ts";

const CA = {
  K: ix(C.FUR, 1),
  O: ix(C.FUR, 5),
  o: ix(C.FUR, 6),
  c: ix(C.FUR, 7),
  e: ix(C.INK, 0),
  n: ix(C.ROSE, 4),
};

/** The grove cat, a ginger loaf. */
export const CAT = {
  loaf: fromRows(
    ["K.K.......", "KoK.......", "KOOK......", "KeOeKKKK..", "KcncOOOOK.", ".KcOoOoOOK", ".KcOOOOOOK", "..KKKKKKKo"],
    CA,
  ),
  blink: fromRows(
    ["K.K.......", "KoK.......", "KOOK......", "KKOKKKKK..", "KcncOOOOK.", ".KcOoOoOOK", ".KcOOOOOOK", "..KKKKKKK."],
    CA,
  ),
};

const DU = {
  K: ix(C.INK, 3),
  W: ix(C.CREAM, 7),
  w: ix(C.CREAM, 4),
  o: ix(C.CRAB, 5),
  e: ix(C.INK, 0),
  y: ix(C.FUR, 7),
  Y: ix(C.SHROOM, 5),
};

export const DUCK = fromRows(
  [".....KK...", "....KWWK..", "....KWeWoo", "....KWWK..", "KK.KWWWK..", "KWKWWWWWK.", "KwWWWWwWK.", ".KwwwwwK.."],
  DU,
);

export const DUCKLING = fromRows(["..KK.", ".KyeYo", "KyyyK.", ".KYK.."], DU);
