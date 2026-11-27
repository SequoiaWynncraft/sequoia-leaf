import { fondOf, type Habit, planRoom, SENSIBLE } from "@sequoia-leaf/raid/bot.ts";
import { catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";
import { ROOM_RULES } from "@sequoia-leaf/raid/content/rules.ts";
/**
 * The Wilds' rules against a plain wing, with bots of different habits:
 *
 *     bun review/wilds.ts [runs each] [only=<habit>,...] [deepest=<room>]
 *
 * Each run is played in the Wilds by its bot, which picks rules by its own plain rule (`bot.ts`),
 * until it ends or reaches `deepest`. Wherever a rule is to be picked, the wing after it is also
 * played six times more from that same moment, once under each rule, and once under none: rooms
 * won in a wing, each rule's against the plain wing's, is how much the rule helps or hurts that
 * bot (both parties are bound by it, so it should be near nothing). Then how often each rule is
 * offered and picked, and how often it was the better of the two offered; and fights with eleven
 * a side, under Early Dusk and without it: dusk, draws.
 */
import { CALLINGS, KINS } from "@sequoia-leaf/raid/content/traits.ts";
import { RULE_IDS, type RuleId, WILDS } from "@sequoia-leaf/raid/content/wilds.ts";
import { sparAt } from "@sequoia-leaf/raid/endless.ts";
import { resolveFight } from "@sequoia-leaf/raid/fight/engine.ts";
import type { FightSetup, FightSummary } from "@sequoia-leaf/raid/fight/types.ts";
import { regularAt } from "@sequoia-leaf/raid/foe.ts";
import {
  beginFight,
  choose,
  endingOf,
  fielded,
  picksOf,
  type Run,
  startRun,
  takeTakings,
} from "@sequoia-leaf/raid/run.ts";
import { wayOn } from "@sequoia-leaf/raid/way.ts";

const args = process.argv.slice(2);
const runs = Number(args[0] ?? 40);
const only = args
  .find((a) => a.startsWith("only="))
  ?.slice(5)
  .split(",");
const deepest = Number(args.find((a) => a.startsWith("deepest="))?.slice(8) ?? 40) - 1;

const EVERY: readonly Habit[] = [SENSIBLE, ...KINS.map(fondOf), ...CALLINGS.map(fondOf)];
const HABITS = EVERY.filter((h) => only === undefined || only.includes(h.name));

const pct = (n: number): string => `${Math.round(n * 100)}%`.padStart(4);
const pts = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 100)}`.padStart(4);

/** Fights with eleven or more fielded a side: how many, ended in dusk, ended drawn. */
interface Eleven {
  fights: number;
  dusk: number;
  draws: number;
}
const elevens: Record<"dusk" | "plain", Eleven> = {
  dusk: { fights: 0, dusk: 0, draws: 0 },
  plain: { fights: 0, dusk: 0, draws: 0 },
};
const countEleven = (into: Eleven, f: FightSummary): void => {
  into.fights++;
  if (f.dusk) into.dusk++;
  if (f.result === "draw") into.draws++;
};

/** Rooms won and fought in the wing a snapshot is at the start of, under a rule or none. */
function playWing(snap: Run, rule: RuleId | null, habit: Habit): { won: number; fought: number } {
  const run = structuredClone(snap);
  const pick = picksOf(run)[0];
  if (pick?.kind !== "rule" || run.stage.phase !== "plan") return { won: 0, fought: 0 };
  if (rule) {
    pick.options = [rule];
    choose(run, 0);
  } else run.stage.picks.shift();
  let won = 0;
  let fought = 0;
  for (let n = 0; n < WILDS.wing && endingOf(run) === null; n++) {
    planRoom(run, habit);
    const size = fielded(run);
    const begun = beginFight(run);
    if (!begun.ok) break;
    const taken = takeTakings(run);
    if (!taken.ok) break;
    fought++;
    if (taken.fight.result === "win") won++;
    const theirs = begun.setup.sides[1].figures.length;
    if (size >= 11 && theirs >= 11 && (rule === "dusk" || rule === null))
      countEleven(elevens[rule ? "dusk" : "plain"], taken.fight);
  }
  return { won, fought };
}

type Line = Record<RuleId | "plain", { won: number; fought: number }>;
const zero = (): { won: number; fought: number } => ({ won: 0, fought: 0 });
const emptyLine = (): Line => ({
  plain: zero(),
  stumps: zero(),
  narrow: zero(),
  long: zero(),
  fog: zero(),
  dusk: zero(),
  elbow: zero(),
});
const byHabit = new Map<string, Line>();
const offered = new Map<RuleId, { offered: number; picked: number; better: number; pairs: number }>(
  RULE_IDS.map((r) => [r, { offered: 0, picked: 0, better: 0, pairs: 0 }]),
);
let wings = 0;
const started = performance.now();
for (const habit of HABITS) {
  const line = emptyLine();
  byHabit.set(habit.name, line);
  for (let n = 0; n < runs; n++) {
    const run = startRun(n * 7919 + 13, { era: LAST_ERA, way: wayOn({ id: "wilds" }) });
    for (let guard = 0; guard < 400 && run.stage.phase !== "over" && run.room <= deepest; guard++) {
      const pick = picksOf(run)[0];
      if (pick?.kind === "rule") {
        wings++;
        const snap = structuredClone(run);
        const results = new Map<RuleId | "plain", number>();
        for (const rule of [null, ...RULE_IDS]) {
          const r = playWing(snap, rule, habit);
          const at = line[rule ?? "plain"];
          at.won += r.won;
          at.fought += r.fought;
          results.set(rule ?? "plain", r.fought === 0 ? 0 : r.won / r.fought);
        }
        const [a, b] = pick.options;
        if (a && b) {
          const ra = results.get(a) ?? 0;
          const rb = results.get(b) ?? 0;
          for (const [mine, theirs, id] of [[ra, rb, a] as const, [rb, ra, b] as const]) {
            const o = offered.get(id);
            if (!o) continue;
            o.offered++;
            o.pairs++;
            if (mine > theirs) o.better++;
            else if (mine === theirs) o.better += 0.5;
          }
        }
        planRoom(run, habit);
        const took = run.wing?.rule;
        const o = took ? offered.get(took) : undefined;
        if (o) o.picked++;
      } else planRoom(run, habit);
      const begun = beginFight(run);
      if (!begun.ok) break;
      if (!takeTakings(run).ok) break;
    }
  }
}
const took = (performance.now() - started) / 1000;

console.log(
  `The Wilds' rules: ${runs} runs for each of ${HABITS.length} habits to room ${deepest + 1} at most, ${wings} wings each played 7 ways, in ${took.toFixed(0)}s.\n`,
);
console.log("Rooms won in a wing: the plain wing, and each rule against it, in points (10 or more is marked *).");
console.log(`${"habit".padEnd(10)} plain ${RULE_IDS.map((r) => ROOM_RULES[r].name.padStart(13)).join("")}`);
for (const [name, line] of byHabit) {
  const plain = line.plain.fought === 0 ? 0 : line.plain.won / line.plain.fought;
  const cells = RULE_IDS.map((r) => {
    const at = line[r];
    const rate = at.fought === 0 ? 0 : at.won / at.fought;
    const d = rate - plain;
    return `${pts(d)}${Math.abs(d) >= 0.1 ? "*" : " "}`.padStart(13);
  });
  console.log(`${name.padEnd(10)} ${pct(plain)}  ${cells.join("")}   (${line.plain.fought} rooms plain)`);
}
console.log(
  "\nOffered, picked by the bots when offered, and the better of the two offered (rooms won in its wing; a tie is half):",
);
for (const [r, o] of offered) {
  console.log(
    `  ${ROOM_RULES[r].name.padEnd(13)} offered ${String(o.offered).padStart(5)}  picked ${pct(o.offered === 0 ? 0 : o.picked / o.offered)}  better ${pct(o.pairs === 0 ? 0 : o.better / o.pairs)}`,
  );
}

// Eleven a side: regulars as strong as the deep rooms make them, against each other, under Early Dusk and without.
const regulars: Record<"dusk" | "plain", Eleven> = {
  dusk: { fights: 0, dusk: 0, draws: 0 },
  plain: { fights: 0, dusk: 0, draws: 0 },
};
const DUSK: Pick<FightSetup, "rules" | "named"> = { rules: ROOM_RULES.dusk.sets([]), named: ["dusk"] };
for (let seed = 1; seed <= 400; seed++) {
  const room = 30 + (seed % 15);
  const ours = regularAt(catalogAt(LAST_ERA), seed * 2, room, 0, sparAt(room));
  const theirs = regularAt(catalogAt(LAST_ERA), seed * 2 + 1, room, 0, sparAt(room));
  if (ours.figures.length < 11 || theirs.figures.length < 11) continue;
  for (const rule of [DUSK, null]) {
    const f = resolveFight({ seed, era: LAST_ERA, sides: [ours, theirs], ...rule });
    countEleven(regulars[rule ? "dusk" : "plain"], f);
  }
}
console.log("\nEleven a side: fights, ended in dusk, drawn.");
for (const [name, e] of [
  ["bots' wings, Early Dusk", elevens.dusk],
  ["bots' wings, no rule", elevens.plain],
  ["regulars, Early Dusk", regulars.dusk],
  ["regulars, no rule", regulars.plain],
] as const) {
  const n = Math.max(1, e.fights);
  console.log(
    `  ${name.padEnd(24)} ${String(e.fights).padStart(5)}  dusk ${pct(e.dusk / n)}  draws ${pct(e.draws / n)}`,
  );
}
