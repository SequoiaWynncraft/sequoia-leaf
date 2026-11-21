/**
 * What lasts between runs, as tables: what a run pays in Coins, and which few figures start out
 * locked away and what opens each. Nothing here is daily, timed or ranked, and nothing that opens
 * is stronger than what was there already: it is more to choose from.
 */
import type { BossId, FigureId } from "./figures.ts";

/** Coins for a run, before the trail's share: for every room won, for every boss beaten, and for winning. */
export const PAYOUT = {
  room: 8,
  boss: 25,
  win: 60,
} as const;

/** What has to have happened, on any trail, for a figure to be opened. */
export type Needs =
  | { kind: "boss"; boss: BossId }
  /** Any kin or calling switched on at its top step. */
  | { kind: "topped" }
  /** Any figure taken to three stars. */
  | { kind: "threeStars" };
export interface Milestone {
  readonly figure: FigureId;
  readonly needs: Needs;
  /** What to do, in plain words. */
  readonly text: string;
}
export const MILESTONES: readonly Milestone[] = [
  { figure: "kettle", needs: { kind: "boss", boss: "oldbramble" }, text: "Clear the first wing: see off Old Bramble." },
  {
    figure: "drizzlefrog",
    needs: { kind: "boss", boss: "hoardmagpie" },
    text: "Clear the second wing: get your things back from The Magpie With The Hoard.",
  },
  { figure: "bushgnome", needs: { kind: "topped" }, text: "Switch any kin or calling all the way on." },
  {
    figure: "crab40",
    needs: { kind: "boss", boss: "bigcrab" },
    text: "Finish a raid: count The Crab Nobody Counted.",
  },
];
