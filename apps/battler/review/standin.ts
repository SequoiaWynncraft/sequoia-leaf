/**
 * For looking at a banner's member in a fight from outside (`window.standin`), beside the tours'
 * handle: the play server's members wear plain made-up skins, so `wear()` has the first banner's
 * member wear a mage's skin (teal hair, a crimson cloak and hood with purple trim, a gold collar), and `seat()` plays a fight with everyone seated where the tour says, so that whoever an
 * ability picks can be put in the front row or the back.
 */
import { wear } from "@sequoia-leaf/figures/sprites.ts";
import { bitmap } from "@sequoia-leaf/kit/pix.ts";
import { bake } from "@sequoia-leaf/kit/skin.ts";
import { makeCanvas } from "@sequoia-leaf/kit/util.ts";
import { isUnitKind } from "@sequoia-leaf/raid/content/figures.ts";

import { fightEvents, fightUnits, startFight } from "../src/screen/fightview.ts";
import { S } from "../src/screen/state.ts";

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
function sheet(): HTMLCanvasElement {
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

/** Where a figure of a kind sits: `seat` counts from the left of its own front row. */
type Seated = readonly [kind: string, seat: number];

const standin = {
  /**
   * The first banner's member is Hoodwick from now on, in the mage's skin; or, given a skin sheet as
   * a `data:` address, in that skin, as the game paints a member from their own (pictures stay out
   * of the repository, so whoever looks passes one in).
   */
  async wear(skin?: string): Promise<string> {
    const worn = skin === undefined ? sheet() : Object.assign(new Image(), { src: skin });
    if (worn instanceof HTMLImageElement) await worn.decode();
    wear("banner-1", "Hoodwick", bake(worn));
    return "Hoodwick";
  },
  /** Plays a fight on the table between two parties seated as said, at some stars, from a seed; the table must be planning. */
  seat(ours: readonly Seated[], theirs: readonly Seated[], stars: 1 | 2 | 3 = 1, seed = 1): string {
    if (S.screen.at !== "plan") return "not planning";
    const party = (seated: readonly Seated[]) => ({
      who: "watched",
      title: "",
      figures: seated.flatMap(([kind, seat]) => (isUnitKind(kind) ? [{ kind, stars, seat, items: [], fed: 0 }] : [])),
      boons: [],
      might: 100,
    });
    startFight({ seed, sides: [party(ours), party(theirs)] }, S.prefs.speed, S.looks.bases, () => undefined);
    // The page as it is in a fight: the plate naming who is across the table is out of the way.
    document.body.dataset.mode = "fight";
    return "watching";
  },
  /** Who a kind's last ability was for: their kind and the cell they stand on. */
  caught(kind: string): string {
    const cast = fightEvents().findLast((ev) => ev.t === "cast" && ev.kind === kind);
    const unit = cast?.t === "cast" ? fightUnits()[cast.targets[0] ?? -1] : undefined;
    return unit ? `${unit.kind} at ${unit.cell}` : "nobody";
  },
};

declare global {
  interface Window {
    standin?: typeof standin;
  }
}

export function openStandIn(): void {
  window.standin = standin;
}
