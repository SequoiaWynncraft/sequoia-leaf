/**
 * How good a five-acorn figure is, measured by putting each into the same boards:
 *
 *     bun review/swap.ts [runs each habit] [figure,...]
 *
 * The bots play whole runs on the first trail, and every fight from room 5 on is kept as it was
 * set up. Each is then fought again with the board's cheapest figure swapped for the one measured,
 * at one, two and three stars, holding nothing: a caster in a free back-row seat, anyone else in a
 * free front-row one. The seed and the party across stay the same, so the figures differ and
 * nothing else does. It prints, for each figure and star, how many of those fights are won and how
 * much damage the figure deals in one, beside the same fights as the bots set them out. Most of
 * those fights are won whoever is swapped in, so it also prints how many of the fights the bots
 * lost are won with the figure: that is where one figure differs from another.
 *
 * Three more tables: in a full party (the largest boards the bots fielded); beside a two-star
 * Orphion in the place of a board's two cheapest, from room 11 on; and the figure alone against
 * the fifteen rooms.
 *
 * A banner's member is one of the stall's five-acorn figures, measured with them. Like `balance.ts` it
 * is a gauge: the bots are rough players, and every board here was built without the figure.
 */
import { fondOf, type Habit, planRoom, ROLLER, SAVER, SENSIBLE } from "@sequoia-leaf/raid/bot.ts";
import { available, catalogAt } from "@sequoia-leaf/raid/content/catalog.ts";
import { type FigureId, figureIn, isFigureId, type Stars } from "@sequoia-leaf/raid/content/figures.ts";
import { LAST_ERA } from "@sequoia-leaf/raid/content/releases.ts";
import { ROOM_COUNT, worth } from "@sequoia-leaf/raid/content/rooms.ts";
import { CALLINGS, KINS } from "@sequoia-leaf/raid/content/traits.ts";
import { openFight, resolveFight } from "@sequoia-leaf/raid/fight/engine.ts";
import type { FightSetup, FightSummary } from "@sequoia-leaf/raid/fight/types.ts";
import { opposition } from "@sequoia-leaf/raid/foe.ts";
import { COLS, HOME_ROWS } from "@sequoia-leaf/raid/hex.ts";
import type { Party, Placed } from "@sequoia-leaf/raid/party.ts";
import { beginFight, startRun, takeTakings } from "@sequoia-leaf/raid/run.ts";
import { onTrail } from "@sequoia-leaf/raid/way.ts";

/** The catalogue with every release open: what these sims play. */
const NOW = catalogAt(LAST_ERA);

const args = process.argv.slice(2);
const runs = Number(args[0] ?? 60);
const FIVES: readonly FigureId[] = available(catalogAt(LAST_ERA), { for: "stall", figures: { pool: "fair" }, tier: 5 });
const measured: readonly FigureId[] = args[1] ? args[1].split(",").filter(isFigureId) : FIVES;
const STARS: readonly Stars[] = [1, 2, 3];
/** The first room whose fights are kept: room 5, where a five-acorn figure can first be on a stall. */
const FROM_ROOM = 4;
const HABITS: readonly Habit[] = [SENSIBLE, SAVER, ROLLER, ...KINS.map(fondOf), ...CALLINGS.map(fondOf)];
const MIDDLE_OUT = [3, 2, 4, 1, 5, 0, 6] as const;

/** A free seat for a figure: the back row for a caster, the front row for anyone else, the next row along when that one is full. */
function freeSeat(kind: FigureId, taken: ReadonlySet<number>): number {
  const far = figureIn(NOW, kind).range > 1;
  for (let n = 0; n < HOME_ROWS; n++) {
    const row = far ? HOME_ROWS - 1 - n : n;
    for (const col of MIDDLE_OUT) if (!taken.has(row * COLS + col)) return row * COLS + col;
  }
  return 0;
}
/** A party with its cheapest figures swapped for others, one for each given, holding nothing. */
function swapped(party: Party, put: readonly (readonly [FigureId, Stars])[]): Party {
  const cheapest = party.figures
    .map((p, i) => ({
      i,
      worth: isFigureId(p.kind) ? worth(figureIn(NOW, p.kind).tier, p.stars) + p.items.length / 10 : 99,
    }))
    .toSorted((a, b) => a.worth - b.worth || a.i - b.i)
    .slice(0, put.length)
    .map((c) => c.i);
  const out = new Set(cheapest);
  const figures = party.figures.filter((_, i) => !out.has(i));
  for (const [kind, stars] of put) {
    const seat = freeSeat(kind, new Set(figures.map((p) => p.seat)));
    figures.push({ kind, stars, seat, items: [], fed: 0 } satisfies Placed);
  }
  return { ...party, figures };
}

/** The id a fight gives our figure at `seat`, as it seats everyone (`openFight`). */
const seated = (setup: FightSetup, seat: number | undefined): number | undefined =>
  seat === undefined ? undefined : openFight(setup).units.find((u) => u.side === 0 && u.seat === seat)?.id;

class Score {
  fights = 0;
  won = 0;
  dealt = 0;
  /** A fight, and the damage of the figure measured (`id`, as `seated` finds it), never another of its kind on the board. */
  add(fight: FightSummary, id?: number): void {
    this.fights++;
    if (fight.result === "win") this.won++;
    if (id !== undefined) this.dealt += fight.units.find((u) => u.id === id)?.dealt ?? 0;
  }
  get say(): string {
    return String(Math.round(this.dealt / Math.max(1, this.fights))).padStart(6);
  }
}
const pct = (n: number, of: number): string => `${Math.round((n / Math.max(1, of)) * 100)}%`.padStart(4);

// ---------- the boards ----------

interface Kept {
  room: number;
  setup: FightSetup;
  /** Whether the bots won it as they set it out. */
  won: boolean;
}
const kept: Kept[] = [];
for (const habit of HABITS) {
  for (let n = 1; n <= runs; n++) {
    const run = startRun(n * 7919 + 13, { era: LAST_ERA, way: onTrail(0) });
    for (let guard = 0; guard < 200 && run.stage.phase !== "over"; guard++) {
      planRoom(run, habit);
      const room = run.room;
      const begun = beginFight(run);
      if (!begun.ok) break;
      const taken = takeTakings(run);
      if (!taken.ok) break;
      if (room >= FROM_ROOM && begun.setup.sides[0].figures.length >= 3) {
        kept.push({ room, setup: begun.setup, won: taken.fight.result === "win" });
      }
    }
  }
}

const HEAD = "  figure            1 star: won  lost  dealt   2 stars: won  lost  dealt   3 stars: won  lost  dealt";
function table(title: string, fights: readonly Kept[], put: (kind: FigureId, stars: Stars) => [FigureId, Stars][]) {
  const won = fights.filter((k) => k.won).length;
  console.log(`${title}: ${fights.length} fights, ${pct(won, fights.length).trim()} won as the bots set them out.`);
  console.log("  won: of them all; lost: of the ones the bots lost; dealt: the figure's damage a fight.");
  console.log(HEAD);
  for (const kind of measured) {
    const cells = STARS.map((stars) => {
      const all = new Score();
      const hard = new Score();
      for (const { setup, won: wonBefore } of fights) {
        const [ours, theirs] = setup.sides;
        const given = put(kind, stars);
        const party = swapped(ours, given);
        // The measured figure is the first put in, so the first of those added at the end.
        const seat = party.figures[party.figures.length - given.length]?.seat;
        const match: FightSetup = { seed: setup.seed, era: setup.era, sides: [party, theirs] };
        const fight = resolveFight(match);
        all.add(fight, seated(match, seat));
        if (!wonBefore) hard.add(fight);
      }
      return `${pct(all.won, all.fights)} ${pct(hard.won, hard.fights).padStart(5)} ${all.say}`;
    });
    console.log(`  ${figureIn(NOW, kind).name.padEnd(16)} ${cells.map((c) => c.padStart(26)).join("")}`);
  }
  console.log("");
}

const most = kept.reduce((n, k) => Math.max(n, k.setup.sides[0].figures.length), 0);
table("Swapped for the cheapest figure, room 5 on", kept, (kind, stars) => [[kind, stars]]);
table(
  `The same, in a full party of ${most}`,
  kept.filter((k) => k.setup.sides[0].figures.length === most),
  (kind, stars) => [[kind, stars]],
);
table(
  "With a two-star Orphion, for the two cheapest, room 11 on (Orphion's own row: two Orphions)",
  kept.filter((k) => k.room >= 10),
  (kind, stars) => [
    [kind, stars],
    ["whitefox", 2],
  ],
);

// ---------- alone ----------

console.log("Alone against the fifteen rooms, 40 seeds a room: rooms won, and damage dealt a fight.");
console.log("  figure            1 star: won  dealt   2 stars: won  dealt   3 stars: won  dealt");
for (const kind of measured) {
  const cells = STARS.map((stars) => {
    const score = new Score();
    for (let room = 0; room < ROOM_COUNT; room++) {
      for (let seed = 1; seed <= 40; seed++) {
        const seat = freeSeat(kind, new Set());
        const ours: Party = {
          who: "alone",
          title: "",
          boons: [],
          might: 100,
          figures: [{ kind, stars, seat, items: [], fed: 0 }],
        };
        const match: FightSetup = {
          seed: seed * 31 + room,
          era: LAST_ERA,
          sides: [ours, opposition(catalogAt(LAST_ERA), seed * 977 + room, room, 0)],
        };
        score.add(resolveFight(match), seated(match, seat));
      }
    }
    return `${pct(score.won, score.fights)} ${score.say}`;
  });
  console.log(`  ${figureIn(NOW, kind).name.padEnd(16)} ${cells.map((c) => c.padStart(20)).join("")}`);
}
