/**
 * Plays many runs with the plain shopper from `sim.ts`, each with a taste for one way of building a
 * party, and prints how each fared against the forest: `bun review/balance.ts [runs]`. It is a
 * rough gauge for tuning the waves (a person plays better than the shopper does), and a check that
 * no one build walks through everything and none is hopeless.
 */
import { type SpiritKind, SPIRITS } from "../src/cast.ts";
import { autoTurn, outcome, ready, ROUNDS, settle, STANDS, start, type Taste } from "../src/sim.ts";

const none = (): Taste => Object.fromEntries(SPIRITS.map((k) => [k, 0.3]));
const BUILDS: Record<string, Taste> = {
  "anything going": {},
  "rock and embers": { ...none(), rock: 3, emberkit: 3, mossmote: 2, slug: 1.2 },
  "glorps and moths": { ...none(), glorp: 3, moth: 3, fox: 2, mossmote: 1.2 },
  "greg's feast": { ...none(), greg: 4, chickaree: 2.5, slug: 1.5, glorp: 1.2 },
  "leafling school": { ...none(), leafling: 3, worm: 2.5, fox: 2.5, slug: 1.2 },
  "owls and foxes": { ...none(), owl: 3, fox: 3, slug: 1.5, glorp: 1.5 },
  "slugs up front": { ...none(), slug: 3, emberkit: 2, owl: 2, mossmote: 1.5 },
};
/** The Leafling school stands its pupils in front of the teachers. */
const stands = (name: string): Record<SpiritKind, number> =>
  name === "leafling school" ? { ...STANDS, worm: 1, fox: 0, leafling: 4 } : STANDS;

const runs = Number(process.argv[2] ?? 300);
console.log(`${runs} runs each. Rounds won of ${ROUNDS}, by round; then how the runs ended.\n`);
for (const [name, taste] of Object.entries(BUILDS)) {
  const wonRound = Array.from({ length: ROUNDS }, () => 0);
  const played = Array.from({ length: ROUNDS }, () => 0);
  let won = 0;
  let reached = 0;
  let clashes = 0;
  let fights = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const run = start(seed * 7919);
    while (run.phase !== "over") {
      autoTurn(run, taste, stands(name));
      const out = ready(run);
      if (!out.ok) break;
      const r = run.round - 1;
      played[r] = (played[r] ?? 0) + 1;
      if (out.fight.result === "win") wonRound[r] = (wonRound[r] ?? 0) + 1;
      clashes += out.fight.clashes;
      fights++;
      settle(run);
    }
    if (outcome(run) === "won") won++;
    if (run.record.length === ROUNDS) reached++;
  }
  const rates = wonRound.map((w, i) => `${Math.round((w / Math.max(1, played[i] ?? 0)) * 100)}`.padStart(3)).join(" ");
  console.log(
    `${name.padEnd(18)} ${rates}   boss met ${Math.round((reached / runs) * 100)}%  beaten ${Math.round((won / runs) * 100)}%  clashes a fight ${(clashes / fights).toFixed(1)}`,
  );
}
