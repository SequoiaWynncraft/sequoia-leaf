/**
 * Yards holding each kind of tier 5 progress, alone, as play makes them: for the version rule's tests
 * (`later.test.ts`), and for proving a Leaf of version 10 leaves each as a newer Leaf's.
 */
import * as F from "../src/index.ts";
import { learn } from "./goals.ts";
import { bareLand } from "./land.ts";
import { must } from "./yards.ts";

/** A bare yard with tier 4 done (tunnels to 5 tiles), and the research named known. */
export function bare(research: readonly string[] = []): F.Yard {
  const y = F.create({ land: bareLand(40, 11, [], [36, 5]), tier: 5, seed: 1 });
  for (const id of research) learn(y, F.goal(id));
  y.history = [];
  return y;
}

/** A tunnel going in at (x, z) facing east under `span` tiles, as the page lays one. */
export const tunnel = (x: number, z: number, span: number): Record<string, unknown> =>
  F.writeAct({ do: "lay", legs: [{ tunnel: true, x, y: z, dir: 0, span, grade: 1 }] });

/**
 * The yard with every goal of tier 5 forgotten, after it was built with them: so that what it keeps
 * of tier 5 is its pieces alone, as no play leaves a yard, for the rule that reads each part alone.
 */
function alone(y: F.Yard): F.Yard {
  y.done = y.done.filter((g) => (F.GOALS[g]?.tier ?? 0) < 5);
  F.reopen(y);
  return y;
}

/** A yard with a tunnel of `span` tiles, laid with the deep culvert known, and tier 5 forgotten. */
function deep(span: number): F.Yard {
  const y = bare(["deepculvert"]);
  must(y, tunnel(2, 4, span));
  return alone(y);
}

/** Each kind of tier 5 progress, a yard of it alone. */
export const TIER5: Readonly<Record<string, () => F.Yard>> = {
  "research known": () => bare(["felling"]),
  "research in the line": () => {
    const y = bare();
    must(y, { do: "study", research: "felling" });
    return y;
  },
  "research given folios": () => {
    const y = bare();
    must(y, { do: "study", research: "felling" });
    F.giveGoal(y, F.goal("felling"), F.item("timber"), 10);
    return y;
  },
  "a 6-tile tunnel": () => deep(6),
  "a 12-tile tunnel": () => deep(12),
  "a 6-tile tunnel in a blueprint": () => {
    const y = deep(6);
    learn(y, F.goal("deepculvert"));
    must(y, { do: "saveBlueprint", slot: 0, tiles: [F.at(y, 2, 4), F.at(y, 9, 4)] });
    must(y, { do: "remove", x: 2, y: 4 });
    y.history = [];
    return alone(y);
  },
  "a 6-tile tunnel in a plan of the whole yard": () => {
    const y = F.create({ land: bareLand(40, 11, [], [36, 5]), tier: 6, seed: 1 });
    must(y, tunnel(2, 4, 6));
    must(y, { do: "saveYard", slot: 0 });
    must(y, { do: "remove", x: 2, y: 4 });
    y.history = [];
    return alone(y);
  },
  "a 6-tile tunnel Undo would stand again": () => {
    const y = bare(["deepculvert"]);
    must(y, tunnel(2, 4, 6));
    y.history = [];
    must(y, { do: "remove", x: 2, y: 4, id: "r-1" });
    return alone(y);
  },
};
