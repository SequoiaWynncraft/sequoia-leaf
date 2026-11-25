/**
 * The version of each game's rules (`rules.ts`), as what imports it sees it: a project with no
 * Node or Bun types (a game's rules, which run on the page as on Leaf) imports the macro all the same.
 */
import type { GameId } from "../src/play.ts";

export declare const rulesVersions: () => Readonly<Record<GameId, string>>;
