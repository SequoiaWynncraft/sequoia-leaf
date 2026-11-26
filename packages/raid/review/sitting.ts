/**
 * Plays many whole sittings and prints how long they go, in rooms and in minutes of Leaf's clock,
 * how large a stored sitting gets, and how long bringing one to its end takes:
 *
 *     bun review/sitting.ts [sittings]
 *
 * Two kinds: eight regulars (nobody waits for anything, so the clock does not move), and eight
 * members who each plan as the sensible bot does (every wait is kept, so this is the clock a table
 * of people takes). Every sitting must end with one winner and every place given once.
 */
import { mix } from "@sequoia-leaf/core";
import { planRoom, SENSIBLE } from "@sequoia-leaf/raid/bot.ts";
import { advance, begin } from "@sequoia-leaf/raid/sitting/clock.ts";
import { encodeSitting } from "@sequoia-leaf/raid/sitting/keep.ts";
import { CHAIRS, type Member, seatsIn, type Sitting } from "@sequoia-leaf/raid/sitting/sitting.ts";

const count = Number(process.argv[2] ?? 1000);
const START = 1_000_000;

/** A sitting started at `START` with these members in its first seats and regulars in the rest. */
function started(seed: number, members: readonly Member[]): Sitting {
  const t: Sitting = {
    rng: mix(seed, 0x5171),
    by: "x",
    room: 0,
    stage: { at: "open", until: START, sat: [] },
    seats: [],
    pairs: [],
    odd: null,
    owed: [],
  };
  begin(t, members, START);
  return t;
}
const deadline = (t: Sitting): number => (t.stage.at === "over" ? t.stage.ended : t.stage.until);

/** Checks that a sitting is over with every place given once and one winner. */
function check(t: Sitting, seed: number): void {
  const places = t.seats.map((s) => s.place ?? 0).toSorted((a, b) => a - b);
  if (t.stage.at !== "over" || places.join() !== "1,2,3,4,5,6,7,8")
    throw new Error(`sitting ${seed} did not end right`);
  const won = t.seats.filter((s) => s.run.stage.phase === "over" && s.run.stage.ending === "won");
  if (won.length !== 1 || won[0]?.place !== 1) throw new Error(`sitting ${seed} has no one winner`);
}

const spread = (xs: number[]): string => {
  const s = xs.toSorted((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return `least ${at(0)}, 10% ${at(0.1)}, median ${at(0.5)}, mean ${mean.toFixed(1)}, 90% ${at(0.9)}, most ${at(1)}`;
};

// ---------- eight regulars ----------

const rooms: number[] = [];
const millis: number[] = [];
let biggest = 0;
for (let seed = 1; seed <= count; seed++) {
  const t = started(seed, []);
  const from = performance.now();
  const end = advance(t, START);
  millis.push(performance.now() - from);
  check(end, seed);
  rooms.push(end.room + 1);
  biggest = Math.max(biggest, encodeSitting(end).length);
}
console.log(`${count} sittings of eight regulars: all ended, one winner each, every place given once.`);
console.log(`  rooms fought: ${spread(rooms)}`);
console.log(`  to the end in one call, ms: ${spread(millis.map((m) => Math.round(m)))}`);
console.log(`  largest stored (at the end), bytes: ${biggest.toLocaleString("en-US")}`);

// ---------- eight members who plan as the bot does ----------

const members: Member[] = Array.from({ length: CHAIRS }, (_, n) => ({ id: `m${n}`, name: `Member ${n}` }));
const playedRooms: number[] = [];
const minutes: number[] = [];
let largest = 0;
for (let seed = 1; seed <= count; seed++) {
  let t = started(seed, members);
  for (let guard = 0; guard < 1000 && t.stage.at !== "over"; guard++) {
    if (t.stage.at === "plan") for (const { run } of seatsIn(t)) planRoom(run, SENSIBLE);
    largest = Math.max(largest, encodeSitting(t).length);
    t = advance(t, deadline(t));
  }
  largest = Math.max(largest, encodeSitting(t).length);
  check(t, seed);
  playedRooms.push(t.room + 1);
  minutes.push(Math.round((deadline(t) - START) / 6000) / 10);
}
console.log(`${count} sittings of eight members who plan as the sensible bot: all ended, one winner each.`);
console.log(`  rooms fought: ${spread(playedRooms)}`);
console.log(`  minutes of the clock: ${spread(minutes)}`);
console.log(`  largest stored (every stage), bytes: ${largest.toLocaleString("en-US")}`);
