import { CARELESS, fondOf, type Habit, planRoom, ROLLER, SAVER, SENSIBLE } from "@sequoia-leaf/raid/bot.ts";
/**
 * Plays many whole runs with bots of different habits and prints how far each gets, room by room,
 * and which traits, figures and items do better or worse than the rest:
 *
 *     bun review/balance.ts [runs each] [trail 0-2] [section ...]
 *
 * Sections: habits, rooms, traits, figures, items, suits, fights (all of them if none is named). It
 * is a gauge for tuning the tables in `src/game/content`, not a verdict: the bots are rough players.
 * `suits` is each figure with the finished items it held, worst first, beside the three a card
 * recommends for it.
 */
import { GOOD_WITH } from "@sequoia-leaf/raid/content/advice.ts";
import { BOON_IDS, type BoonId, BOONS } from "@sequoia-leaf/raid/content/boons.ts";
import { FIGURE_IDS, type FigureId, FIGURES, isFigureId } from "@sequoia-leaf/raid/content/figures.ts";
import { FINISHED, FINISHED_IDS, type FinishedId, holdItem, isFinishedId } from "@sequoia-leaf/raid/content/items.ts";
import { ROOM_COUNT, ROOMS, TRAILS } from "@sequoia-leaf/raid/content/rooms.ts";
import { CALLINGS, KINS, TRAIT_IDS, type TraitId, TRAITS } from "@sequoia-leaf/raid/content/traits.ts";
import { resolveFight } from "@sequoia-leaf/raid/fight/engine.ts";
import type { FightSetup, FightSummary } from "@sequoia-leaf/raid/fight/types.ts";
import { beginFight, endingOf, startRun, takeTakings, traitsNow } from "@sequoia-leaf/raid/run.ts";

const args = process.argv.slice(2);
const runs = Number(args[0] ?? 200);
const trail = Number(args[1] ?? 0);
const only = args
  .find((a) => a.startsWith("only="))
  ?.slice(5)
  .split(",");
const sections = new Set(args.slice(2).filter((a) => !a.startsWith("only=")));
const shows = (name: string): boolean => sections.size === 0 || sections.has(name);

/** Wins and tries, as a rate, kept room by room so that late rooms are not held against what only turns up late. */
class Tally {
  won = 0;
  tried = 0;
  readonly rooms: { won: number; tried: number }[] = Array.from({ length: ROOM_COUNT }, () => ({ won: 0, tried: 0 }));
  add(win: boolean, room = 0): void {
    this.tried++;
    if (win) this.won++;
    const r = this.rooms[room];
    if (r) {
      r.tried++;
      if (win) r.won++;
    }
  }
  get rate(): number {
    return this.tried === 0 ? 0 : this.won / this.tried;
  }
  /** The rate these fights would have been won at if this made no difference: each room's own rate, weighted by how often it was seen there. */
  expected(rates: readonly number[]): number {
    if (this.tried === 0) return 0;
    let sum = 0;
    this.rooms.forEach((r, i) => (sum += r.tried * (rates[i] ?? 0)));
    return sum / this.tried;
  }
}
const pct = (n: number): string => `${Math.round(n * 100)}%`.padStart(4);
const tallies = <K extends string>(keys: readonly K[]): Map<K, Tally> => new Map(keys.map((k) => [k, new Tally()]));

const EVERY: readonly Habit[] = [SENSIBLE, SAVER, ROLLER, ...KINS.map(fondOf), ...CALLINGS.map(fondOf), CARELESS];
const HABITS = EVERY.filter((h) => only === undefined || only.includes(h.name));
/** The habits whose fights count toward the trait, figure and item tables: everyone who is trying. */
const trying = (habit: Habit): boolean => !habit.careless;

const byRoom = Array.from({ length: ROOM_COUNT }, () => new Tally());
const byPlan = new Map<string, Tally>();
const byTrait = new Map<string, Tally>();
const byFigure = tallies<FigureId>(FIGURE_IDS);
const byFigureStars = new Map<string, Tally>();
const byItem = tallies<FinishedId>(FINISHED_IDS);
/**
 * What a finished item does for a figure, keyed `figure item`: in a sample of real fights, the same
 * fight played again with that figure holding one more item, and how much better its side ends
 * (health left on its side minus health left on the other, as shares, so 1 is the whole party).
 */
const bySuit = new Map<string, { sum: number; n: number }>();
/** One fight in this many, among those trying, is played again for every figure and item. */
const SUIT_EVERY = 24;
let suitTrials = 0;
const left = (f: FightSummary, side: 0 | 1): number => {
  let hp = 0;
  let max = 0;
  for (const u of f.units) {
    if (u.side !== side || u.summoned) continue;
    hp += u.hp;
    max += u.maxHp;
  }
  return max > 0 ? hp / max : 0;
};
const margin = (f: FightSummary): number => left(f, 0) - left(f, 1);
function trySuits(setup: FightSetup, base: FightSummary): void {
  const [ours, theirs] = setup.sides;
  const was = margin(base);
  ours.figures.forEach((p, i) => {
    if (!isFigureId(p.kind)) return;
    for (const item of FINISHED_IDS) {
      const held = holdItem(p, item);
      if ("refused" in held) return;
      const figures = ours.figures.with(i, { ...p, items: held.held });
      const now = margin(resolveFight({ seed: setup.seed, sides: [{ ...ours, figures }, theirs] }));
      const key = `${p.kind} ${item}`;
      const t = bySuit.get(key) ?? { sum: 0, n: 0 };
      t.sum += now - was;
      t.n++;
      bySuit.set(key, t);
      suitTrials++;
    }
  });
}
const byBoon = tallies<BoonId>(BOON_IDS);
const share = new Map<FigureId, { dealt: number; fights: number }>();
const all = new Tally();
let seconds = 0;
let fights = 0;
let dusks = 0;
let draws = 0;

interface Line {
  name: string;
  wing1: number;
  wing2: number;
  met: number;
  beat: number;
  rooms: number;
  level: number;
  ends: number[];
}
const lines: Line[] = [];
const started = performance.now();

for (const habit of HABITS) {
  const line: Line = { name: habit.name, wing1: 0, wing2: 0, met: 0, beat: 0, rooms: 0, level: 0, ends: [] };
  for (let i = 0; i < ROOM_COUNT + 1; i++) line.ends.push(0);
  for (let n = 1; n <= runs; n++) {
    const run = startRun(n * 7919 + 13, { trail });
    for (let guard = 0; guard < 200 && run.stage.phase !== "over"; guard++) {
      planRoom(run, habit);
      const room = run.room;
      const traits = traitsNow(run).filter((t) => t.step > 0);
      const board = run.board.flatMap((p) => (p ? [p] : []));
      const boons = run.boons.slice();
      const plan = `${String(room + 1).padStart(2)} ${run.foe.who === "The forest" ? run.foe.title : "sparring"}`;
      const begun = beginFight(run);
      if (!begun.ok) break;
      const taken = takeTakings(run);
      if (!taken.ok) break;
      const win = taken.fight.result === "win";
      fights++;
      seconds += taken.fight.seconds;
      if (taken.fight.dusk) dusks++;
      if (taken.fight.result === "draw") draws++;
      if (!trying(habit)) continue;
      if (shows("suits") && all.tried % SUIT_EVERY === 0) trySuits(begun.setup, taken.fight);
      all.add(win, room);
      byRoom[room]?.add(win, room);
      const planTally = byPlan.get(plan) ?? new Tally();
      planTally.add(win, room);
      byPlan.set(plan, planTally);
      for (const t of traits) {
        const key = `${t.trait} ${t.step}`;
        const tally = byTrait.get(key) ?? new Tally();
        tally.add(win, room);
        byTrait.set(key, tally);
      }
      const total = taken.fight.units.reduce((sum, u) => sum + (u.side === 0 ? u.dealt : 0), 0);
      for (const p of board) {
        byFigure.get(p.kind)?.add(win, room);
        const key = `${p.kind} ${p.stars}`;
        const tally = byFigureStars.get(key) ?? new Tally();
        tally.add(win, room);
        byFigureStars.set(key, tally);
        for (const item of p.items) if (isFinishedId(item)) byItem.get(item)?.add(win, room);
      }
      for (const u of taken.fight.units) {
        if (u.side !== 0 || u.summoned || total <= 0) continue;
        const kind = FIGURE_IDS.find((id) => id === u.kind);
        if (!kind) continue;
        const s = share.get(kind) ?? { dealt: 0, fights: 0 };
        s.dealt += u.dealt / total;
        s.fights++;
        share.set(kind, s);
      }
      for (const boon of boons) byBoon.get(boon)?.add(win, room);
    }
    const cleared = new Set(run.record.filter((r) => r.result === "win").map((r) => r.room)).size;
    const furthest = run.record.reduce((most, r) => Math.max(most, r.room), 0);
    if (furthest >= 5) line.wing1++;
    if (furthest >= 10) line.wing2++;
    if (furthest >= ROOM_COUNT - 1) line.met++;
    if (endingOf(run) === "won") line.beat++;
    line.rooms += cleared;
    line.level += run.level;
    const end = endingOf(run) === "won" ? ROOM_COUNT : furthest;
    line.ends[end] = (line.ends[end] ?? 0) + 1;
  }
  lines.push(line);
}

const took = (performance.now() - started) / 1000;
console.log(
  `${TRAILS[trail]?.name ?? "?"}: ${runs} runs for each of ${HABITS.length} habits, ${fights} fights in ${took.toFixed(1)}s ` +
    `(${Math.round(fights / took)} fights a second, shopping included).\n`,
);

if (shows("habits")) {
  console.log(
    "habit         left wing 1  left wing 2  met last boss  beat it  rooms won  level   where it ended (room 1..15, then won)",
  );
  for (const l of lines) {
    console.log(
      `${l.name.padEnd(13)} ${pct(l.wing1 / runs).padStart(10)} ${pct(l.wing2 / runs).padStart(12)} ${pct(l.met / runs).padStart(14)} ${pct(
        l.beat / runs,
      ).padStart(8)} ${(l.rooms / runs).toFixed(1).padStart(10)} ${(l.level / runs).toFixed(1).padStart(6)}   ${l.ends
        .map((n) => String(Math.round((n / runs) * 100)).padStart(3))
        .join("")}`,
    );
  }
  console.log("");
}
if (shows("rooms")) {
  console.log("Rooms won, by room, for every habit that is trying:");
  console.log(
    byRoom
      .map((t, i) => `${String(i + 1).padStart(2)} ${(ROOMS[i]?.kind ?? "").padEnd(7)} ${pct(t.rate)}  (${t.tried})`)
      .join("\n"),
  );
  console.log("\nAnd by what was waiting:");
  for (const [plan, t] of [...byPlan.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${plan.padEnd(34)} ${pct(t.rate)}  (${t.tried})`);
  }
  console.log("");
}
if (shows("fights")) {
  console.log(
    `Fights: ${(seconds / Math.max(1, fights)).toFixed(1)}s long on average; dusk fell in ${pct(dusks / Math.max(1, fights))}; draws ${pct(
      draws / Math.max(1, fights),
    )}. Fights won by those trying: ${pct(all.rate)}.\n`,
  );
}
const roomRates = byRoom.map((t) => t.rate);
const signed = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 100)}`.padStart(4);
/**
 * Prints a table of how often fights were won with something, beside how often the same rooms are
 * won by everybody: the difference is how much it seems to help. Late rooms are harder, so the
 * plain rate alone would make everything dear look bad.
 */
function table(title: string, rows: [string, Tally, string][]): void {
  console.log(
    `${title}: fights won with it, how that differs from the same rooms without regard to it, and how often seen.`,
  );
  const lean = (t: Tally): number => t.rate - t.expected(roomRates);
  for (const [, t, label] of rows.toSorted((a, b) => lean(b[1]) - lean(a[1]))) {
    if (t.tried === 0) {
      console.log(`  ${label.padEnd(32)}    -         never seen`);
      continue;
    }
    const by = lean(t);
    const mark = t.tried < 80 ? "  (few)" : by > 0.08 ? "  strong" : by < -0.08 ? "  weak" : "";
    console.log(`  ${label.padEnd(32)} ${pct(t.rate)} ${signed(by)}  ${String(t.tried).padStart(6)} fights${mark}`);
  }
  console.log("");
}
if (shows("traits")) {
  const rows: [string, Tally, string][] = [];
  for (const trait of TRAIT_IDS) {
    for (let step = 1; step <= TRAITS[trait].steps.length; step++) {
      const key = `${trait} ${step}`;
      const id: TraitId = trait;
      rows.push([key, byTrait.get(key) ?? new Tally(), `${TRAITS[id].name} ${TRAITS[id].steps[step - 1] ?? ""}`]);
    }
  }
  table("Traits switched on", rows);
}
if (shows("figures")) {
  table(
    "Figures fielded",
    FIGURE_IDS.map((id): [FigureId, Tally, string] => {
      const s = share.get(id);
      const dealt = s && s.fights > 0 ? ` deals ${pct(s.dealt / s.fights).trim()}` : "";
      return [id, byFigure.get(id) ?? new Tally(), `${FIGURES[id].tier} ${FIGURES[id].name}${dealt}`];
    }),
  );
  if (sections.has("stars")) {
    table(
      "Figures by stars",
      [...byFigureStars.entries()].map(([key, t]): [string, Tally, string] => [key, t, key]),
    );
  }
}
if (shows("items")) {
  table(
    "Finished items held",
    FINISHED_IDS.map((id): [FinishedId, Tally, string] => [id, byItem.get(id) ?? new Tally(), FINISHED[id].name]),
  );
  table(
    "Boons held",
    BOON_IDS.map((id): [BoonId, Tally, string] => [id, byBoon.get(id) ?? new Tally(), BOONS[id].name]),
  );
}
/** A change in points of health left, signed, to one place. */
const points = (n: number): string => (Number.isNaN(n) ? "?" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}`);
if (shows("suits")) {
  console.log(
    `What one more finished item does for each figure, in ${suitTrials} fights played again (every ${SUIT_EVERY}th fight, ` +
      "each figure given each item): points of health left on the figure's side over the other, the same fight without it.",
  );
  console.log("The three a card recommends are named; * marks one among that figure's three worst.");
  const gain = (id: FigureId, item: FinishedId): number => {
    const t = bySuit.get(`${id} ${item}`);
    return t && t.n > 0 ? (t.sum / t.n) * 100 : Number.NaN;
  };
  let clashes = 0;
  for (const id of FIGURE_IDS) {
    const ranked = FINISHED_IDS.filter((item) => !Number.isNaN(gain(id, item))).toSorted(
      (a, b) => gain(id, a) - gain(id, b),
    );
    const worst = ranked.slice(0, 3);
    const best = ranked.slice(-3).toReversed();
    const n = bySuit.get(`${id} ${FINISHED_IDS[0]}`)?.n ?? 0;
    const named = GOOD_WITH[id].map((item) => {
      const clash = worst.includes(item);
      if (clash) clashes++;
      return `${FINISHED[item].name} ${points(gain(id, item))}${clash ? " *" : ""}`;
    });
    const list = (items: readonly FinishedId[]): string =>
      items.map((item) => `${FINISHED[item].name} ${points(gain(id, item))}`).join(", ");
    console.log(`  ${FIGURES[id].name} (${n} fights)`);
    console.log(`      good with: ${named.join(", ")}`);
    console.log(`      best: ${list(best)}; worst: ${list(worst)}`);
  }
  console.log(`\n${clashes} recommended item${clashes === 1 ? "" : "s"} among a figure's three worst.\n`);
}
