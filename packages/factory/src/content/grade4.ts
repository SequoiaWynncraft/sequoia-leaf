/**
 * Grade 4, for gatherers and lines: its research, put on the end of `RESEARCH` (`research.ts`), after
 * tier 8's, in this order, since a yard keeps where each goal stands in the table. Both are tier 7's
 * and paid in Star folios, so both need the Star folio known. A grade 4 line carries 600 things in
 * a minute, twice a grade 3 one, and costs 40 times a grade 1 piece; a grade 4 gatherer works 2.5
 * times as fast as a grade 1 one. There are no grade 4 machines.
 */
import { perMinute } from "@sequoia-leaf/core";

import type { ResearchInfo } from "./research.ts";

export const GRADE_4_RESEARCH: readonly ResearchInfo[] = [
  {
    id: "gatherer4",
    tier: 7,
    name: "Fourth-grade gatherers",
    what: "Unlocks grade 4 gatherers.",
    cost: { star: 10000 },
    needs: ["starfolio"],
    unlocks: { grades: { gatherer: 4 } },
  },
  {
    id: "lines4",
    tier: 7,
    name: "Fourth-grade lines",
    what: `Unlocks grade 4 belts, tunnels, splitters, joiners and sorters: ${perMinute(600, "items")}.`,
    cost: { star: 20000 },
    needs: ["starfolio"],
    unlocks: { grades: { belt: 4, tunnel: 4, splitter: 4, joiner: 4, sorter: 4 } },
  },
];
