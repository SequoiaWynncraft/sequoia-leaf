/**
 * For looking at a banner's member in a fight from outside (`window.standin`), beside the tours'
 * handle: the play server's members wear plain made-up skins, so `wear()` has the first banner's
 * member wear a mage's skin (`mage.ts`), and `seat()` plays a fight with everyone seated where the
 * tour says, so that whoever an ability picks can be put in the front row or the back.
 */
import { wear } from "@sequoia-leaf/figures/sprites.ts";
import { bake } from "@sequoia-leaf/kit/skin.ts";
import { LAST_ERA } from "@sequoia-leaf/raid";
import { isUnitKind } from "@sequoia-leaf/raid/content/figures.ts";

import { fightEvents, fightUnits, startFight } from "../src/screen/fightview.ts";
import { S } from "../src/screen/state.ts";
import { mageSheet } from "./mage.ts";

/** Where a figure of a kind sits: `seat` counts from the left of its own front row. */
type Seated = readonly [kind: string, seat: number];

const standin = {
  /**
   * The first banner's member is Hoodwick from now on, in the mage's skin; or, given a skin sheet as
   * a `data:` address, in that skin, as the game paints a member from their own (pictures stay out
   * of the repository, so whoever looks passes one in).
   */
  async wear(skin?: string): Promise<string> {
    const worn = skin === undefined ? mageSheet() : Object.assign(new Image(), { src: skin });
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
    startFight(
      { seed, era: LAST_ERA, sides: [party(ours), party(theirs)] },
      S.prefs.speed,
      S.looks.bases,
      () => undefined,
    );
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
