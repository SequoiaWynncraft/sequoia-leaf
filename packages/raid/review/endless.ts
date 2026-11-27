/**
 * Plays many endless runs with bots of different habits and prints where they end, how long fights
 * run with nine, ten and eleven a side, and whether one wide build runs away with it:
 *
 *     bun review/endless.ts [runs each] [way: wilds|deep] [only=<habit>,...]
 *
 * The Wilds: every sparring room a regular's. The Deep Woods: the runs are played one after
 * another, the habits taking turns, and every sparring room won is held by the board that won it,
 * which the next run to come to that room meets (a regular while nobody holds it); the first
 * quarter of the runs only fills the rooms, and is not counted.
 */
import type { Met } from "@sequoia-leaf/core";
import { CARELESS, fondOf, type Habit, planRoom, ROLLER, SAVER, SENSIBLE } from "@sequoia-leaf/raid/bot.ts";
import { ENDLESS, type EndlessWay } from "@sequoia-leaf/raid/content/endless.ts";
import { ROOM_COUNT } from "@sequoia-leaf/raid/content/rooms.ts";
import { CALLINGS, KINS } from "@sequoia-leaf/raid/content/traits.ts";
import { roomAt } from "@sequoia-leaf/raid/endless.ts";
import { type Party, partyWorth } from "@sequoia-leaf/raid/party.ts";
import { Tally } from "@sequoia-leaf/raid/rates.ts";
import {
  beginFight,
  fieldCap,
  fielded,
  foughtOf,
  startRun,
  takenTo,
  takeTakings,
  traitsNow,
} from "@sequoia-leaf/raid/run.ts";

const args = process.argv.slice(2);
const runs = Number(args[0] ?? 100);
const way: EndlessWay = args[1] === "deep" ? "deep" : "wilds";
const only = args
  .find((a) => a.startsWith("only="))
  ?.slice(5)
  .split(",");

// TUNE="spent,spentGrows,components,componentsEvery,grows,chairs" tries other numbers without editing the content.
const tune = process.env.TUNE?.split(",").map(Number);
if (tune) {
  const [spent, spentGrows, components, componentsEvery, grows, chairs] = tune;
  Object.assign(ENDLESS.spar, { spent, spentGrows, components, componentsEvery });
  Object.assign(ENDLESS, { grows, chairs });
}

const EVERY: readonly Habit[] = [SENSIBLE, SAVER, ROLLER, ...KINS.map(fondOf), ...CALLINGS.map(fondOf), CARELESS];
const HABITS = EVERY.filter((h) => (only === undefined ? !h.careless : only.includes(h.name)));

const pct = (n: number): string => `${Math.round(n * 100)}%`.padStart(4);
const spread = (xs: number[]): string => {
  const s = xs.toSorted((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  return `10% ${String(at(0.1)).padStart(2)}, median ${String(at(0.5)).padStart(2)}, mean ${mean.toFixed(1).padStart(4)}, 90% ${String(at(0.9)).padStart(2)}, most ${at(1)}`;
};

/**
 * The boards that hold the Deep Woods' sparring rooms, by room: the last `keep` to win each (one
 * met by the dice), from room `heldFrom` (counting from 1) on; all let go every `week` runs.
 */
const holders = new Map<number, { party: Party; by: string }[]>();
const option = (name: string, otherwise: number): number =>
  Number(args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? otherwise);
const keep = option("keep", 1);
const heldFrom = option("heldFrom", ENDLESS.heldFrom + 1) - 1;
const week = option("week", 1e9);

interface Side {
  fights: number;
  seconds: number;
  dusks: number;
  draws: number;
  won: number;
}
/** Fights after room 15, by how many the party fielded. */
const bySize = new Map<number, Side>();
/** Fights after room 15, by how many traits the party had switched on. */
const byBreadth = new Map<number, Tally>();
/** Fights after room 15 against a held board and against a regular. */
const heldTally = new Tally();
const regularTally = new Tally();
const deepRooms = new Map<number, Tally>();
/** By room after 15: what the bots' boards and the regulars across were worth in acorns, and the items they held. */
const worth = new Map<
  number,
  { ours: number; theirs: number; items: number; theirItems: number; n: number; m: number }
>();

interface Line {
  name: string;
  ends: number[];
  past15: number;
  chairs: number[];
}
const lines = new Map<string, Line>();
for (const h of HABITS) lines.set(h.name, { name: h.name, ends: [], past15: 0, chairs: [0, 0, 0, 0] });

const total = runs * HABITS.length;
const warm = way === "deep" ? Math.floor(total / 4) : 0;
const started = performance.now();
let fights = 0;
for (let n = 0; n < total; n++) {
  const habit = HABITS[n % HABITS.length] ?? SENSIBLE;
  if (n % week === 0) holders.clear();
  const counted = n >= warm;
  const run = startRun(n * 7919 + 13, { trail: 0, endless: way });
  for (let guard = 0; guard < 400 && run.stage.phase !== "over"; guard++) {
    planRoom(run, habit);
    const room = run.room;
    const size = fielded(run);
    const traits = traitsNow(run).filter((t) => t.step > 0).length;
    const begun = beginFight(run);
    if (!begun.ok) break;
    if (counted && room >= ROOM_COUNT - 3) {
      const [ours, theirs] = begun.setup.sides;
      const w = worth.get(room) ?? { ours: 0, theirs: 0, items: 0, theirItems: 0, n: 0, m: 0 };
      w.ours += partyWorth(ours);
      w.items += ours.figures.reduce((k, p) => k + p.items.length, 0);
      w.n++;
      if (roomAt(room)?.kind === "spar" && theirs.by === undefined) {
        w.theirs += partyWorth(theirs);
        w.theirItems += theirs.figures.reduce((k, p) => k + p.items.length, 0);
        w.m++;
      }
      worth.set(room, w);
    }
    const decided = foughtOf(run);
    const won = decided?.outcome.result === "win";
    if (decided && won && roomAt(room)?.kind === "spar" && way === "deep" && room >= heldFrom) {
      holders.set(room, [...(holders.get(room) ?? []), { party: decided.setup.sides[0], by: `bot${n}` }].slice(-keep));
    }
    const across = run.foe;
    const to = takenTo(run);
    const kept = to === null || roomAt(to)?.kind !== "spar" ? undefined : holders.get(to);
    const held = kept?.[(n * 31 + room) % kept.length];
    const met: Met | undefined = held && { player: held.by, name: held.by, data: held.party, of: 1 };
    const taken = takeTakings(run, met);
    if (!taken.ok) break;
    fights++;
    if (!counted || room < ROOM_COUNT) continue;
    const side = bySize.get(size) ?? { fights: 0, seconds: 0, dusks: 0, draws: 0, won: 0 };
    side.fights++;
    side.seconds += taken.fight.seconds;
    if (taken.fight.dusk) side.dusks++;
    if (taken.fight.result === "draw") side.draws++;
    if (won) side.won++;
    bySize.set(size, side);
    const breadth = byBreadth.get(traits) ?? new Tally();
    breadth.add(won, room);
    byBreadth.set(traits, breadth);
    if (roomAt(room)?.kind === "spar") (across.by === undefined ? regularTally : heldTally).add(won, room);
    const t = deepRooms.get(room) ?? new Tally();
    t.add(won, room);
    deepRooms.set(room, t);
  }
  if (!counted) continue;
  const line = lines.get(habit.name);
  if (!line) continue;
  const end = run.record.at(-1)?.room ?? 0;
  line.ends.push(end + 1);
  if (end >= ROOM_COUNT) line.past15++;
  const chairs = fieldCap(run) - run.level - (run.boons.includes("extrachair") ? 1 : 0);
  line.chairs[chairs] = (line.chairs[chairs] ?? 0) + 1;
}
const took = (performance.now() - started) / 1000;
const counted = total - warm;
console.log(
  `${way === "deep" ? "The Deep Woods" : "The Wilds"}: ${runs} runs a habit (${counted} counted), ${fights} fights in ${took.toFixed(0)}s. ` +
    `Forest +${ENDLESS.grows}% a room after 15; chairs at most ${ENDLESS.chairs}; regulars spend ${ENDLESS.spar.spent} + ${ENDLESS.spar.spentGrows} a room.\n`,
);
console.log(
  "habit         past 15   room the run ended in                           of those past 15                          chairs 0/1/2/3",
);
const all: number[] = [];
for (const l of lines.values()) {
  all.push(...l.ends);
  const n = Math.max(1, l.ends.length);
  console.log(
    `${l.name.padEnd(13)} ${pct(l.past15 / n).padStart(7)}   ${spread(l.ends).padEnd(47)} ${spread(l.ends.filter((e) => e > ROOM_COUNT)).padEnd(41)} ${l.chairs.map((c) => pct(c / n)).join(" ")}`,
  );
}
console.log(
  `${"everyone".padEnd(13)} ${"".padStart(7)}   ${spread(all).padEnd(47)} ${spread(all.filter((e) => e > ROOM_COUNT))}\n`,
);
console.log("Fights after room 15, by how many the party fielded: fights, seconds on average, dusk, draws, won.");
for (const [size, s] of [...bySize.entries()].toSorted((a, b) => a[0] - b[0])) {
  console.log(
    `  ${String(size).padStart(2)} a side  ${String(s.fights).padStart(6)}  ${(s.seconds / s.fights).toFixed(1).padStart(5)}s  ${pct(s.dusks / s.fights)}  ${pct(s.draws / s.fights)}  ${pct(s.won / s.fights)}`,
  );
}
console.log("\nFights after room 15, by traits switched on: won, and how often.");
for (const [n, t] of [...byBreadth.entries()].toSorted((a, b) => a[0] - b[0])) {
  console.log(`  ${String(n).padStart(2)} traits  ${pct(t.rate)}  ${String(t.tried).padStart(6)}`);
}
console.log(
  `\nSparring after room 15: against a held board ${pct(heldTally.rate)} won (${heldTally.tried}), against a regular ${pct(regularTally.rate)} (${regularTally.tried}).`,
);
console.log("\nRooms after 15, won and tried:");
console.log(
  [...deepRooms.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([room, t]) => {
      const w = worth.get(room);
      const theirs =
        w && w.m > 0
          ? `${(w.theirs / w.m).toFixed(0).padStart(4)} worth, ${(w.theirItems / w.m).toFixed(1)} items`
          : "";
      const ours = w
        ? `${(w.ours / w.n).toFixed(0).padStart(4)} worth, ${(w.items / w.n).toFixed(1).padStart(4)} items`
        : "";
      return `${String(room + 1).padStart(3)} ${(roomAt(room)?.kind ?? "").padEnd(7)} ${pct(t.rate)} (${String(t.tried).padStart(4)})   ours ${ours}   regular ${theirs}`;
    })
    .join("\n"),
);
for (let room = ROOM_COUNT - 3; room < ROOM_COUNT; room++) {
  const w = worth.get(room);
  if (!w) continue;
  const theirs = w.m > 0 ? `${(w.theirs / w.m).toFixed(0)} worth, ${(w.theirItems / w.m).toFixed(1)} items` : "";
  console.log(
    `  (room ${room + 1}: ours ${(w.ours / w.n).toFixed(0)} worth, ${(w.items / w.n).toFixed(1)} items; regular ${theirs})`,
  );
}
