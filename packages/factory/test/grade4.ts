/**
 * Yards for grade 4, lines and gatherers: a bare yard with it known, and yards holding a grade 4
 * piece in each place a yard keeps pieces, alone, for the version rule's tests (`later.test.ts`).
 */
import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

/** Where the bare yard's star crystal lies: three tiles west of the depot's west side, in its power. */
export const CRYSTAL_AT = [32, 5] as const;

/**
 * A bare yard 40 tiles by 11 with a tier open (8, so every goal of tier 7 done, grade 4's research
 * among them), the depot's middle at (36, 5), star crystal at `CRYSTAL_AT`, and the research named
 * known (with what it needs first); its Undo forgotten.
 */
export function bare4(research: readonly string[] = ["gatherer4", "lines4"], tier = 8): F.Yard {
  const [cx, cz] = CRYSTAL_AT;
  const y = F.create({ land: bareLand(40, 11, [[cx, cz, "crystal"]], [36, 5]), tier, seed: 1 });
  for (const id of research) learn(y, F.goal(id));
  y.history = [];
  return y;
}

/** A belt standing at (2, 4), facing east, at a grade. */
const belt = (grade: number): Record<string, unknown> => ({ do: "build", kind: "belt", x: 2, y: 4, dir: 0, grade });

/**
 * Each place a yard keeps a piece, holding one at `grade` (4, or 3 for the same yard without grade 4)
 * and nothing else past what the yard has besides: standing, a belt or a gatherer; in a blueprint;
 * in a plan of the whole yard; and in what Undo would stand again.
 */
export const GRADED: Readonly<Record<string, (grade: number) => F.Yard>> = {
  "a belt": (grade) => {
    const y = bare4();
    must(y, belt(grade));
    return y;
  },
  "a gatherer": (grade) => {
    const y = bare4();
    must(y, { do: "build", kind: "gatherer", x: CRYSTAL_AT[0], y: CRYSTAL_AT[1], dir: 0, grade });
    return y;
  },
  "a belt in a blueprint": (grade) => {
    const y = bare4(["gatherer4", "lines4", "planchest"]);
    must(y, belt(grade));
    must(y, { do: "saveBlueprint", slot: 0, tiles: [F.at(y, 2, 4)] });
    must(y, { do: "remove", x: 2, y: 4 });
    y.history = [];
    return y;
  },
  "a belt in a plan of the whole yard": (grade) => {
    const y = bare4(["gatherer4", "lines4", "wholeyard"]);
    must(y, belt(grade));
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "remove", x: 2, y: 4 });
    y.history = [];
    return y;
  },
  "a belt Undo would stand again": (grade) => {
    const y = bare4();
    must(y, belt(grade));
    y.history = [];
    must(y, { do: "remove", x: 2, y: 4, id: "r-1" });
    return y;
  },
};
