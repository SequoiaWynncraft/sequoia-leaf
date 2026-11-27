/**
 * The mage's skin the review's banner member wears (`standin.ts`), drawn by code: pictures stay out
 * of the repository. Like gaz's own today: teal hair, a crimson cloak and hood with purple trim, a
 * gold collar, a dark robe, brown boots.
 */
import { bitmap } from "@sequoia-leaf/kit/pix.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";

/** A mage's colours, as painted and not the palette's: teal hair, a crimson cloak and hood trimmed purple, a gold collar, a dark robe, brown boots. */
const INKS = {
  T: "#109e85",
  t: "#0a584a",
  L: "#02bfa8",
  K: "#ffa0b1",
  k: "#ffdde3",
  R: "#a90013",
  r: "#8a0010",
  V: "#5f02d5",
  v: "#4b03a7",
  Y: "#ffd800",
  D: "#0f0826",
  N: "#654234",
  n: "#27130c",
  B: "#b57b67",
};
const FACE = ["rRTRRRRt", "TTtVVLTt", "RVTTTTTT", "RVTkLLkT", "tTTLLLLt", "RVtLLLtR", "RtTKLKRR", "RRNTTNRR"];
const HOOD = ["rrRRRRRt", "rRRRRRVt", "rRRRRRVT", "rRRRRVTT", "rRRRRVTT", "rRRRRRVT", "rRRRRRVt", "rrRRRRVv"];
const BACK = ["rrRRRRrr", "rRRRRRRr", "RRRRRRRR", "RRRRRRRR", "RRRRRRRR", "RRRRRRRR", "rRRRRRRr", "rrVVVVrr"];
const ROBE = [
  "RVYDDYVR",
  "RVVYYVVR",
  "RRVDDVRR",
  "RRVDDVRR",
  "RRVDDVRR",
  "RRVDDVRR",
  "RRVDDVRR",
  "RRVDDVRR",
  "RRVVVVRR",
  "RRVDDVRR",
  "rRVDDVRr",
  "rRVDDVRr",
];
const SIDE = ["RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "rRRr", "VVVV", "rrrr"];
const ARM = ["RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "RRRR", "rRRr", "VVVV", "KKKK", "kKKk"];
const LEG = ["RnnR", "RnnR", "RnnR", "RnnR", "VnnV", "nnnn", "nnnn", "NNNN", "NNNN", "BBBB", "BBBB", "NNNN"];

/** A whole skin sheet laid out as a real one is: the head's faces, the body's, an arm and a leg. */
export function mageSheet(): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64);
  const put = (rows: readonly string[], x: number, y: number, mirrored = false): void => {
    g.drawImage(bitmap(mirrored ? rows.map((r) => r.split("").toReversed().join("")) : rows, INKS), x, y);
  };
  put(BACK, 8, 0);
  put(HOOD, 0, 8);
  put(FACE, 8, 8);
  put(HOOD, 16, 8, true);
  put(BACK, 24, 8);
  put(SIDE, 16, 20);
  put(ROBE, 20, 20);
  put(SIDE, 28, 20);
  put(ROBE, 32, 20);
  for (let x = 40; x < 56; x += 4) put(ARM, x, 20);
  for (let x = 0; x < 16; x += 4) put(LEG, x, 20);
  return c;
}
