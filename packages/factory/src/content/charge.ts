/**
 * Things that do not keep (tier 8, `CHARGE`): a charger charges a cell to 3 bars, a charged cell with 3
 * bars being one thing, with 2 another and with 1 a third, so that no thing carries an age. On the
 * beat, every `beat` ticks in a yard that knows `known` (the research), every charged cell in the yard
 * loses a bar: each of `bars` becomes the one before it, and the first becomes `plain` again (`beat.ts`).
 * A charger takes `takes`, using the first it holds of them, and gives `gives` after `ticks` of work at
 * grade 1.
 */
import type { KindName } from "../kinds/list.ts";
import type { ItemName } from "./items.ts";

export interface ChargeInfo {
  readonly by: KindName;
  /** What it charges, in the order it uses them: a cell if it holds one, else 1 bar, else 2 bars. */
  readonly takes: readonly ItemName[];
  readonly ticks: number;
  readonly gives: ItemName;
  /** How many it holds at most, of all it takes together. */
  readonly holds: number;
  /** A cell with no charge. */
  readonly plain: ItemName;
  /** The charged cells, by their bars: 1, 2 and 3. */
  readonly bars: readonly ItemName[];
  /** Ticks between beats: 200, 20 seconds. */
  readonly beat: number;
  /** The research a yard knows before its charged cells lose bars: the charger's. */
  readonly known: string;
}

export const CHARGE: ChargeInfo = {
  by: "charger",
  takes: ["cell", "charged1", "charged2"],
  ticks: 10,
  gives: "charged3",
  holds: 4,
  plain: "cell",
  bars: ["charged1", "charged2", "charged3"],
  beat: 200,
  known: "charging",
};
